import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { BackupHeld } from "./backup-capacity";

export const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function identity(stat: fs.BigIntStats) { return [stat.dev, stat.ino, stat.birthtimeNs].join(":"); }
export function holdPrivateFile(file: string, writable = false) {
  const before = fs.lstatSync(file, { bigint: true });
  const fd = fs.openSync(file, (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  const check = (stat: fs.BigIntStats, links = BigInt(1)) => {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== links ||
        process.platform !== "win32" && (stat.uid !== BigInt(process.getuid!()) || (stat.mode & BigInt(0o077)) !== BigInt(0))) throw new BackupHeld("unsafe-file");
  };
  try { check(before); check(fs.fstatSync(fd, { bigint: true })); if (identity(before) !== identity(fs.fstatSync(fd, { bigint: true }))) throw new BackupHeld("unsafe-file"); }
  catch (error) { fs.closeSync(fd); throw error; }
  return { fd, verify(links = BigInt(1), target = file) {
    const opened = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(target, { bigint: true });
    check(opened, links); check(current, links);
    if (identity(opened) !== identity(before) || identity(current) !== identity(before)) throw new BackupHeld("unsafe-file");
  }, close() { fs.closeSync(fd); } };
}
export function assertPrivateDirectory(directory: string): void {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== path.resolve(directory) ||
      process.platform !== "win32" && (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)) throw new BackupHeld("unsafe-file");
}
export function assertProtectedAncestors(file: string): void {
  for (let current = path.dirname(file); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== "win32" &&
        (![0, process.getuid!()].includes(stat.uid) || (stat.mode & 0o022) !== 0)) throw new BackupHeld("unsafe-file");
    if (current === path.dirname(current)) break;
  }
}
export function syncDirectory(directory: string): boolean {
  if (process.platform === "win32") return false; // Offline fixtures only; no POSIX durability claim.
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } return true;
}
export function readPrivate(file: string, maximum = 16384): Buffer {
  const held = holdPrivateFile(file);
  try {
    const before = fs.fstatSync(held.fd, { bigint: true });
    if (before.size < BigInt(1) || before.size > BigInt(maximum)) throw new BackupHeld("unsafe-file");
    const buffer = Buffer.alloc(maximum + 1); let count = 0;
    while (count < buffer.length) { const read = fs.readSync(held.fd, buffer, count, buffer.length - count, count); if (!read) break; count += read; }
    const bytes = buffer.subarray(0, count); held.verify();
    const after = fs.fstatSync(held.fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || bytes.length !== Number(before.size)) throw new BackupHeld("unsafe-file");
    return bytes;
  } finally { held.close(); }
}
export function exclusivePrivate(file: string, bytes: Buffer | string): void {
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
  if (!readPrivate(file, Buffer.byteLength(bytes)).equals(Buffer.from(bytes))) throw new BackupHeld("unsafe-file");
}
/** Exact no-replace publication. A partial link/rename remains inspection-only. */
export function publishPrivate(staged: string, target: string): void {
  const held = holdPrivateFile(staged, true);
  try {
    held.verify(); fs.fsyncSync(held.fd); fs.linkSync(staged, target); syncDirectory(path.dirname(target));
    held.verify(BigInt(2), target); held.verify(BigInt(2)); fs.unlinkSync(staged); syncDirectory(path.dirname(staged)); held.verify(BigInt(1), target);
  } finally { held.close(); }
}
export function removeOwned(file: string): void {
  const held = holdPrivateFile(file);
  try { held.verify(); fs.unlinkSync(file); syncDirectory(path.dirname(file)); } finally { held.close(); }
}
