import { readBackupKey } from "./backup-encryption.ts";
import { restoreBackup } from "./restore-backup.ts";
import fs from "node:fs";
import path from "node:path";
import { withBackupLock } from "./backup-files.ts";
import { downloadR2Backup, r2Config } from "./backup-r2.ts";

try {
  const args = process.argv.slice(2);
  const remote = args[0] === "--r2";
  if (remote) args.shift();
  const [input, destination, ...extra] = args;
  if (!input || !destination || extra.length) throw new Error("Invalid restore arguments.");
  const key = readBackupKey(process.env.KERYX_BACKUP_ENCRYPTION_KEY);
  let source = input;
  if (remote) {
    const dbPath = path.resolve(process.env.KERYX_SQLITE_PATH ?? "data/keryx.sqlite");
    const directory = path.join(path.dirname(dbPath), "backups");
    await withBackupLock(directory, async () => {
      const downloadDir = fs.mkdtempSync(path.join(directory, "restore-download-"));
      fs.chmodSync(downloadDir, 0o700);
      source = path.join(downloadDir, input);
      await downloadR2Backup(input, source, directory, r2Config());
    });
  }
  const receipt = await restoreBackup(source, destination, key);
  console.log(`[restore] authenticated SQLite drill verified (${receipt.databaseSha256}); signing remains unauthorized.`);
} catch {
  console.error("[restore] drill failed; retain artifacts for inspection. No service or signing was started.");
  process.exitCode = 1;
}
