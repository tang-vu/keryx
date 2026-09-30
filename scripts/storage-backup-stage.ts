import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { backupVerifiedSqliteStorage } from "../lib/db/storage-identity-provision";
import type { StorageIdentity } from "../lib/db/storage-identity";

/** No retry after an uncertain copy: retain the original protected output and require operator review. */
export async function createVerifiedBackupSnapshot(source: string, identity: StorageIdentity, snapshot: string,
  reviewMarker: string, copy: typeof backupVerifiedSqliteStorage = backupVerifiedSqliteStorage) {
  if (existsSync(reviewMarker)) throw new Error("A prior uncertain snapshot requires operator inspection.");
  try { return await copy(source, identity, snapshot); }
  catch {
    writeFileSync(reviewMarker, JSON.stringify({ format: "keryx-backup-review-required-v1",
      snapshot: basename(snapshot), signingResumeAuthorized: false }), { flag: "wx", mode: 0o600 });
    throw new Error("Snapshot outcome requires inspection; original copy retained.");
  }
}
