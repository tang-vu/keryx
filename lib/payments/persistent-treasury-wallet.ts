import fs from "node:fs";
import { isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAX_BYTES = 4096;
const RECOVERY_ERROR = "Persistent treasury wallet unavailable; owner recovery required";

function refuse(): never { throw new Error(RECOVERY_ERROR); }

function sameFile(a: fs.BigIntStats, b: fs.BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.nlink === BigInt(1) && b.nlink === BigInt(1)
    && a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** Load only an existing legacy wallet. Never create, repair, replace or log it.
 * Host ACLs and protection from a malicious local owner remain deployment duties. */
export function loadPersistentTreasuryWallet(file: string): Readonly<{ privateKey: Hex; address: Hex }> {
  return loadExistingWallet(file, false);
}

/** The web CLI historically recorded one ISO rotatedAt metadata field. Preserve
 * that exact legacy variant without granting rotation or relaxing treasury files. */
export function loadPersistentWebClientWallet(file: string): Readonly<{ privateKey: Hex; address: Hex; rotatedAt?: string }> {
  return loadExistingWallet(file, true);
}

function loadExistingWallet(file: string, allowRotatedAt: boolean): Readonly<{ privateKey: Hex; address: Hex; rotatedAt?: string }> {
  let descriptor: number | undefined;
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  try {
    const original = fs.lstatSync(file, { bigint: true });
    if (!original.isFile() || original.nlink !== BigInt(1) || original.size < BigInt(1) || original.size > BigInt(MAX_BYTES)) refuse();
    // lstat rejects ordinary symlinks/FIFOs. NOFOLLOW/NONBLOCK also bound their
    // replacement races on POSIX; Windows relies on the subsequent handle check.
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFile(original, opened)) refuse();
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (BigInt(length) !== original.size || length > MAX_BYTES
      || !sameFile(opened, fs.fstatSync(descriptor, { bigint: true }))
      || !sameFile(opened, fs.lstatSync(file, { bigint: true }))) refuse();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    // Literal bounded legacy fields only. JSON.parse alone permits duplicates.
    // Escaped keys/values and foreign metadata never extend custody implicitly.
    const shape = /^\s*\{\s*"(?:privateKey|address|rotatedAt)"\s*:\s*"[^"\\\u0000-\u001f]*"\s*(?:,\s*"(?:privateKey|address|rotatedAt)"\s*:\s*"[^"\\\u0000-\u001f]*"\s*){1,2}\}\s*$/.test(text);
    const fields = Array.from(text.matchAll(/"(privateKey|address|rotatedAt)"\s*:/g), match => match[1]);
    if (!shape || new Set(fields).size !== fields.length
      || !fields.includes("privateKey") || !fields.includes("address")
      || (!allowRotatedAt && fields.includes("rotatedAt"))) refuse();
    const value = JSON.parse(text) as { privateKey: unknown; address: unknown; rotatedAt?: unknown };
    if (typeof value.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.privateKey)
      || typeof value.address !== "string" || !isAddress(value.address)) refuse();
    const privateKey = value.privateKey as Hex;
    const address = privateKeyToAccount(privateKey).address;
    if (address.toLowerCase() !== value.address.toLowerCase()) refuse();
    if (value.rotatedAt !== undefined && (typeof value.rotatedAt !== "string"
      || new Date(value.rotatedAt).toISOString() !== value.rotatedAt)) refuse();
    return Object.freeze({ privateKey, address, ...(typeof value.rotatedAt === "string" ? { rotatedAt: value.rotatedAt } : {}) });
  } catch { return refuse(); }
  finally {
    bytes.fill(0);
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { refuse(); }
    }
  }
}
