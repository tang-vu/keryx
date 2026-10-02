import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { createGzip, createGunzip } from "node:zlib";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const magic = Buffer.from("KERYXDB1");
const maxDatabaseBytes = 256 * 1024 * 1024;
const maxEnvelopeBytes = maxDatabaseBytes + 1024 * 1024;
const headerBytes = magic.length + 12 + 16;

/** Dedicated random encryption key; never reuse a wallet private key. */
export function readBackupKey(value: string | undefined): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("KERYX_BACKUP_ENCRYPTION_KEY must be a dedicated 32-byte hex key.");
  }
  return Buffer.from(value, "hex");
}

export function encryptBackup(database: Buffer, key: Buffer): Buffer {
  if (key.length !== 32 || database.length > maxDatabaseBytes) throw new Error("Backup size or key rejected.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const payload = Buffer.concat([cipher.update(gzipSync(database)), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), payload]);
}

/** Authenticate before decompression; cap expansion of even an authenticated envelope. */
export function decryptBackup(envelope: Buffer, key: Buffer): Buffer {
  if (key.length !== 32 || envelope.length <= headerBytes || envelope.length > maxEnvelopeBytes ||
      !envelope.subarray(0, magic.length).equals(magic)) throw new Error("Backup envelope rejected.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(8, 20));
    decipher.setAAD(magic);
    decipher.setAuthTag(envelope.subarray(20, 36));
    const compressed = Buffer.concat([decipher.update(envelope.subarray(headerBytes)), decipher.final()]);
    return gunzipSync(compressed, { maxOutputLength: maxDatabaseBytes });
  } catch {
    throw new Error("Backup authentication or decompression failed.");
  }
}

export function backupDigest(database: Buffer): string {
  return createHash("sha256").update(database).digest("hex");
}

export const backupSizeLimits = { databaseBytes: maxDatabaseBytes, envelopeBytes: maxEnvelopeBytes };

export async function fileDigest(source: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
  return hash.digest("hex");
}

function boundedStream(limit: number) {
  let size = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > limit ? new Error("Backup size limit exceeded.") : null, chunk);
  } });
}

export async function compressSnapshot(source: string, destination: string): Promise<void> {
  await pipeline(fs.createReadStream(source), boundedStream(maxDatabaseBytes), createGzip(),
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
}

export async function encryptSnapshot(source: string, destination: string, key: Buffer): Promise<void> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(magic);
  const fd = fs.openSync(destination, "wx", 0o600);
  try {
    fs.writeSync(fd, Buffer.concat([magic, nonce, Buffer.alloc(16)]));
    await pipeline(fs.createReadStream(source), boundedStream(maxDatabaseBytes), createGzip(), cipher,
      boundedStream(maxEnvelopeBytes - headerBytes), fs.createWriteStream(destination, { fd, start: headerBytes, autoClose: false }));
    fs.writeSync(fd, cipher.getAuthTag(), 0, 16, 20);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

/** Decrypt into private temporary compressed data. Only authenticated data is decompressed. */
export async function decryptSnapshot(source: string, destination: string, key: Buffer): Promise<void> {
  const fd = fs.openSync(source, "r");
  const compressed = `${destination}.authenticated.gz`;
  try {
    const header = Buffer.alloc(headerBytes);
    if (fs.fstatSync(fd).size > maxEnvelopeBytes || fs.readSync(fd, header, 0, headerBytes, 0) !== headerBytes ||
        !header.subarray(0, 8).equals(magic)) throw new Error("Backup envelope rejected.");
    const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8, 20));
    decipher.setAAD(magic);
    decipher.setAuthTag(header.subarray(20, 36));
    await pipeline(fs.createReadStream(source, { fd, start: headerBytes, autoClose: false }), decipher,
      fs.createWriteStream(compressed, { flags: "wx", mode: 0o600 }));
    await pipeline(fs.createReadStream(compressed), createGunzip(), boundedStream(maxDatabaseBytes),
      fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  } catch {
    throw new Error("Backup authentication or decompression failed.");
  } finally {
    fs.closeSync(fd);
    if (fs.existsSync(compressed)) fs.unlinkSync(compressed);
  }
}
