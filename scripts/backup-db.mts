/** Consistent local snapshots; optional encrypted daily R2 upload with bounded job limits. */
import path from "node:path";
import { withBackupLock } from "./backup-files.ts";
import { downloadR2Backup, initializeR2Budget, r2Config } from "./backup-r2.ts";
import { captureBackup } from "./backup-capture.ts";
import { prepareBackupSource } from "./backup-source.ts";
import { assertPrivateDirectory } from "./backup-persistence.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === "--init-r2") &&
      !(args.length === 3 && args[0] === "--download-r2")) throw new Error("Invalid backup arguments.");
  if (!args.length) {
    const status = await captureBackup(process.env);
    console.log(`[backup] local capture verified; remote=${status.remote}; offhost verification=false; automatic pruning=false.`);
    return;
  }
  if (args[0] === "--download-r2") {
    // Transfer-only recovery uses the retained request ledger even when the live
    // DB is unavailable. This does not inspect, initialize or authorize a store.
    const directory = path.join(path.dirname(path.resolve(process.env.KERYX_SQLITE_PATH ?? "data/keryx.sqlite")), "backups");
    assertPrivateDirectory(directory);
    await withBackupLock(directory, async () => {
      await downloadR2Backup(args[1], path.resolve(args[2]), directory, r2Config());
    });
    console.log("[backup] encrypted off-host retrieval complete; authenticate in separate offline restore drill.");
    return;
  }
  const selected = prepareBackupSource(process.env);
  const directory = path.join(path.dirname(selected.file), "backups");
  // Administrative selection does not capture; release even a legacy read
  // transaction before acquiring the job lock or making network requests.
  selected.close();
  await withBackupLock(directory, async () => {
    if (args[0] === "--init-r2") {
      await initializeR2Budget(directory, r2Config());
      console.log("[backup] initialized job ledger for empty dedicated R2 bucket; never reset it during the month.");
      return;
    }
  });
}

try { await main(); }
catch {
  console.error("[backup] held or uncertain. Inspect private backup-status.json and retained intents; do not reset locks, partials or request accounting. No prior snapshot was pruned; offhost durability is not claimed.");
  process.exitCode = 1;
}
