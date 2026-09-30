import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupSizeLimits, decryptSnapshot, fileDigest } from "./backup-encryption";
import { writePrivateExclusive } from "./backup-files";

/** Offline drill only. Never opens live DB, starts an app, resets grants, or resumes signing. */
export async function restoreBackup(envelopePath: string, destination: string, key: Buffer) {
  const input = fs.lstatSync(envelopePath);
  if (!input.isFile() || input.isSymbolicLink() || input.size > backupSizeLimits.envelopeBytes) {
    throw new Error("Backup input must be a bounded regular file.");
  }
  // Exclusive directory creation prevents replacing a live or previously restored database.
  const directory = path.resolve(destination);
  fs.mkdirSync(directory, { mode: 0o700 });
  const target = path.join(directory, "keryx.sqlite");
  await decryptSnapshot(envelopePath, target, key);
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Restored SQLite integrity check failed.");
  } finally { db.close(); }
  const manifest = { format: "keryx-db-restore-drill-v1", verifiedAt: new Date().toISOString(),
    databaseSha256: await fileDigest(target), authenticationVerified: true, integrityVerified: true,
    signingResumeAuthorized: false, fullServiceRecoveryVerified: false };
  writePrivateExclusive(path.join(directory, "restore-receipt.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
