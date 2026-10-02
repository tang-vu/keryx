/** Consistent local snapshots; optional encrypted daily R2 upload with bounded job limits. */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { prunable } from "./backup-rotation.ts";
import { backupKeep, withBackupLock } from "./backup-files.ts";
import { backupSizeLimits, compressSnapshot, encryptSnapshot, readBackupKey } from "./backup-encryption.ts";
import { downloadR2Backup, initializeR2Budget, r2Config, uploadR2Backup } from "./backup-r2.ts";

async function main(): Promise<void> {
  const dbPath = path.resolve(process.env.KERYX_SQLITE_PATH ?? "data/keryx.sqlite");
  const directory = path.join(path.dirname(dbPath), "backups");
  const keep = backupKeep(process.env.KERYX_BACKUP_KEEP);
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === "--init-r2") &&
      !(args.length === 3 && args[0] === "--download-r2")) throw new Error("Invalid backup arguments.");
  await withBackupLock(directory, async () => {
    if (args[0] === "--init-r2") {
      await initializeR2Budget(directory, r2Config());
      console.log("[backup] initialized job ledger for empty dedicated R2 bucket; never reset it during the month.");
      return;
    }
    if (args[0] === "--download-r2") {
      await downloadR2Backup(args[1], path.resolve(args[2]), directory, r2Config());
      console.log("[backup] encrypted off-host retrieval complete; authenticate in separate offline restore drill.");
      return;
    }
    if (!fs.existsSync(dbPath)) throw new Error("Database missing.");
    const base = `keryx-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
    const snapshot = path.join(directory, base);
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        db.exec("PRAGMA busy_timeout = 10000;");
        db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
      } finally { db.close(); }
      fs.chmodSync(snapshot, 0o600);
      if (fs.statSync(snapshot).size > backupSizeLimits.databaseBytes) throw new Error("Snapshot exceeds 256 MiB safety limit.");
      const check = new DatabaseSync(snapshot, { readOnly: true });
      try {
        const integrity = check.prepare("PRAGMA integrity_check").all();
        if (integrity.length !== 1 || integrity[0].integrity_check !== "ok" ||
            check.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Snapshot integrity failed.");
      } finally { check.close(); }
      await compressSnapshot(snapshot, `${snapshot}.gz.partial`);
      fs.renameSync(`${snapshot}.gz.partial`, `${snapshot}.gz`);
      console.log(`[backup] consistent local snapshot ${base}.gz`);
      // Preserve local continuity even when remote/encryption configuration fails.
      for (const stale of prunable(fs.readdirSync(directory).filter((f) => f.endsWith(".gz")), keep)) fs.unlinkSync(path.join(directory, stale));
      let encrypted: string | undefined;
      if (process.env.KERYX_BACKUP_ENCRYPTION_KEY !== undefined) {
        encrypted = `${snapshot}.enc`;
        await encryptSnapshot(snapshot, `${encrypted}.partial`, readBackupKey(process.env.KERYX_BACKUP_ENCRYPTION_KEY));
        fs.renameSync(`${encrypted}.partial`, encrypted);
        for (const stale of prunable(fs.readdirSync(directory).filter((f) => f.endsWith(".enc")), keep)) fs.unlinkSync(path.join(directory, stale));
        console.log(`[backup] encrypted staging ${base}.enc`);
      }
      if ((process.env.KERYX_BACKUP_REMOTE ?? "").trim()) throw new Error("Legacy remote refused. Migrate to scoped KERYX_R2_* configuration; local snapshot retained.");
      if (process.env.KERYX_R2_UPLOAD !== undefined && !["0", "1"].includes(process.env.KERYX_R2_UPLOAD)) throw new Error("Invalid R2 upload switch.");
      if (process.env.KERYX_R2_UPLOAD === "1") {
        if (!encrypted) throw new Error("Encrypted backup key required for R2; local snapshot retained.");
        const result = await uploadR2Backup(encrypted, directory, r2Config());
        console.log(result === "uploaded" ? "[backup] encrypted off-host upload succeeded." : "[backup] daily remote attempt already reserved; local snapshot retained.");
      } else console.log("[backup] local-only; off-host upload disabled.");
    } finally {
      for (const temporary of [snapshot, `${snapshot}.gz.partial`, `${snapshot}.enc.partial`]) {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
  });
}

try { await main(); }
catch {
  console.error("[backup] failed. Existing local snapshots retained. Inspect exclusive lock, integrity, encryption/R2 configuration and job budget; never reset the ledger to retry. Legacy KERYX_BACKUP_REMOTE is refused.");
  process.exitCode = 1;
}
