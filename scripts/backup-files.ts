import fs from "node:fs";
import path from "node:path";

/** Never steal a stale lock automatically: an interrupted process requires operator inspection. */
export async function withBackupLock<T>(directory: string, run: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Backup directory rejected.");
  fs.chmodSync(directory, 0o700);
  const lock = path.join(directory, ".backup.lock");
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.fsyncSync(fd);
    return await run();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function writePrivateExclusive(destination: string, bytes: Buffer | string): void {
  const fd = fs.openSync(destination, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

export function backupKeep(value: string | undefined): number {
  if (value === undefined) return 48;
  const keep = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(keep) || keep > 168) {
    throw new Error("KERYX_BACKUP_KEEP must be an integer from 1 to 168.");
  }
  return keep;
}
