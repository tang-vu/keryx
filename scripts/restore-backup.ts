import fs from "node:fs";
import path from "node:path";
import { backupVerifiedSqliteStorage } from "../lib/db/storage-identity-provision";
import { validateStorageIdentity, type StorageIdentity } from "../lib/db/storage-identity";
import { backupSizeLimits, decryptSnapshot, fileDigest } from "./backup-encryption";
import { writePrivateExclusive } from "./backup-files";

/** Offline drill only. Never opens live DB, starts an app, resets grants, or resumes signing. */
export async function restoreBackup(envelopePath: string, destination: string, key: Buffer, expectedIdentity: StorageIdentity) {
  const identity = validateStorageIdentity(expectedIdentity);
  const input = fs.lstatSync(envelopePath);
  if (!input.isFile() || input.isSymbolicLink() || input.size > backupSizeLimits.envelopeBytes) {
    throw new Error("Backup input must be a bounded regular file.");
  }
  // Exclusive directory creation prevents replacing a live or previously restored database.
  const directory = path.resolve(destination);
  fs.mkdirSync(directory, { mode: 0o700 });
  const target = path.join(directory, "keryx.sqlite");
  const quarantine = path.join(directory, "authenticated-quarantine.sqlite");
  await decryptSnapshot(envelopePath, quarantine, key);
  const lineage = await backupVerifiedSqliteStorage(quarantine, identity, target);
  const manifest = { format: "keryx-db-restore-drill-v1", verifiedAt: new Date().toISOString(),
    databaseSha256: await fileDigest(target), authenticationVerified: true, integrityVerified: true,
    lineage, signingResumeAuthorized: false, fullServiceRecoveryVerified: false };
  writePrivateExclusive(path.join(directory, "restore-receipt.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}
