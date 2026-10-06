import fs from "node:fs";
import path from "node:path";

export const BACKUP_LIMITS = Object.freeze({ reserveBytes: 2 * 1024 ** 3,
  retainedBytes: 512 * 1024 ** 2, auditBytes: 1024 * 1024, directoryEntries: 4096 });
export const SNAPSHOT_NAME = /^keryx-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite\.(gz|enc)$/;
export class BackupHeld extends Error {
  constructor(readonly reason: "capacity" | "retention" | "source-size" | "interrupted" | "unsafe-file" | "selection" | "failed") {
    super(`Backup held: ${reason}`);
  }
}
export function retainedByteBudget(value: string | undefined): number {
  if (value === undefined) return BACKUP_LIMITS.retainedBytes;
  const bytes = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(bytes) || bytes > BACKUP_LIMITS.retainedBytes) throw new BackupHeld("retention");
  return bytes;
}
/** Use available blocks, never root-reserved bfree. No environment reserve waiver. */
export function usableBytes(directory: string): bigint {
  const stat = fs.statfsSync(directory, { bigint: true });
  if (stat.bavail < BigInt(0) || stat.bsize <= BigInt(0)) throw new BackupHeld("capacity");
  return stat.bavail * stat.bsize;
}
export function stagingBounds(plainBytes: number, encrypted: boolean) {
  if (!Number.isSafeInteger(plainBytes) || plainBytes < 1 || plainBytes > 256 * 1024 ** 2) throw new BackupHeld("source-size");
  // Conservative gzip expansion plus framing. Include a second plaintext-sized
  // SQLite journal allowance, both encoded files, and bounded audit metadata.
  const gzipBytes = plainBytes + Math.ceil(plainBytes / 16383) * 5 + 65536;
  return { finalBytes: gzipBytes + (encrypted ? gzipBytes + 36 : 0) + BACKUP_LIMITS.auditBytes,
    peakBytes: 2 * plainBytes + gzipBytes + (encrypted ? gzipBytes + 36 : 0) + BACKUP_LIMITS.auditBytes };
}
export function assertCapacity(available: bigint, needed = 0): void {
  if (!Number.isSafeInteger(needed) || needed < 0 || available < BigInt(BACKUP_LIMITS.reserveBytes) + BigInt(needed)) throw new BackupHeld("capacity");
}
export function snapshotInventory(directory: string) {
  let bytes = 0, gzip = 0, encrypted = 0, entries = 0;
  const walk = (current: string, depth: number) => {
    if (depth > 8) throw new BackupHeld("retention");
    const before = fs.lstatSync(current, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) throw new BackupHeld("unsafe-file");
    const names = fs.readdirSync(current).sort();
    for (const name of names) {
      if (++entries > BACKUP_LIMITS.directoryEntries) throw new BackupHeld("retention");
      const file = path.join(current, name), stat = fs.lstatSync(file, { bigint: true });
      if (stat.isSymbolicLink()) throw new BackupHeld("unsafe-file");
      if (stat.isDirectory()) { walk(file, depth + 1); continue; }
      if (!stat.isFile() || stat.size < BigInt(0) || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new BackupHeld("unsafe-file");
      // Charge all retained regular bytes, including plain/monthly snapshots,
      // failed staging, drill downloads and unknown financial artifacts. Never
      // traverse a link or infer cleanup permission from classification.
      bytes += Number(stat.size);
      if (!Number.isSafeInteger(bytes)) throw new BackupHeld("retention");
      if (depth === 0 && SNAPSHOT_NAME.test(name)) {
        if (stat.nlink !== BigInt(1) || process.platform !== "win32" &&
            (stat.uid !== BigInt(process.getuid!()) || (stat.mode & BigInt(0o077)) !== BigInt(0))) throw new BackupHeld("unsafe-file");
        if (name.endsWith(".gz")) gzip++; else encrypted++;
      }
      const after = fs.lstatSync(file, { bigint: true });
      if (stat.dev !== after.dev || stat.ino !== after.ino || stat.birthtimeNs !== after.birthtimeNs ||
          stat.size !== after.size || stat.mtimeNs !== after.mtimeNs) throw new BackupHeld("unsafe-file");
    }
    const after = fs.lstatSync(current, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs ||
        before.mtimeNs !== after.mtimeNs || names.join("\0") !== fs.readdirSync(current).sort().join("\0")) throw new BackupHeld("unsafe-file");
  };
  walk(directory, 0);
  return { bytes, gzip, encrypted };
}
export function admitCapture(inventory: ReturnType<typeof snapshotInventory>, plainBytes: number, encrypted: boolean,
  keep: number, budget: number, available: bigint) {
  const bound = stagingBounds(plainBytes, encrypted);
  if (inventory.gzip + 1 > keep || encrypted && inventory.encrypted + 1 > keep || inventory.bytes + bound.peakBytes > budget) throw new BackupHeld("retention");
  assertCapacity(available, bound.peakBytes);
  return bound;
}
