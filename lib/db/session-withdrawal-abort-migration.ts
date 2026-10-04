import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { SESSION_WITHDRAWAL_ABORT_SQL } from "./session-withdrawal-abort";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";

function reference(publicationAbort: boolean) {
  const db = new DatabaseSync(":memory:");
  try { installMainnetApplicationSchema(db, { publicationAbort }); return sqliteApplicationSchemaProfile(db, new Set()); }
  finally { db.close(); }
}
/** Explicit stopped-writer migration only. Back up the original mainnet store and
 * verify that backup before calling; startup never runs this or admits the old schema.
 * Identity, custody, grants, payment originals and exposed withdrawals are unchanged. */
export function migrateSessionWithdrawalAbortStorage(file: string, value: StorageIdentity, beforeMigrate?: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (identity.authorityMode !== "mainnet-real") throw new Error("Mainnet withdrawal migration identity refused");
  const previous = reference(false), current = reference(true), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok") throw new Error("Mainnet withdrawal migration integrity refused");
    const excluded = () => new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
      "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db!, identity))]);
    const before = sqliteApplicationSchemaProfile(db, excluded());
    if (before !== previous && before !== current) throw new Error("Mainnet withdrawal migration source profile differs");
    // The operational wrapper binds its verified backup and manifest here, under
    // the same exclusive transaction as DDL, rather than across a reopened snapshot.
    beforeMigrate?.(db);
    if (before === previous) {
      db.exec(SESSION_WITHDRAWAL_ABORT_SQL);
      installStorageFences(db, identity);
    }
    assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    const after = sqliteApplicationSchemaProfile(db, excluded());
    if (after !== current || db.prepare("PRAGMA foreign_key_check").get()) throw new Error("Mainnet withdrawal migration verification refused");
    db.exec("COMMIT");
    return { format: "keryx-session-withdrawal-abort-migration-v1", status: before === current ? "already-current" : "migrated",
      beforeSchemaDigest: createHash("sha256").update(before).digest("hex"),
      afterSchemaDigest: createHash("sha256").update(after).digest("hex") };
  } catch (error) { try { db?.exec("ROLLBACK"); } catch { /* Preserve the original transaction result. */ } throw error; }
  finally { try { db?.close(); } finally { held.close(); } }
}
