import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { A2A_FULFILLMENT_SQL } from "./a2a-fulfillment-schema";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";

export function originalFulfillmentSchemaProfiles(): readonly [string, string] {
  return [false, true].map(originalFulfillment => {
    const db = new DatabaseSync(":memory:");
    try { installMainnetApplicationSchema(db, { originalFulfillment }); return sqliteApplicationSchemaProfile(db, new Set()); }
    finally { db.close(); }
  }) as [string, string];
}
/** Explicit stopped-writer DDL only. The caller must prove a no-replace, flushed,
 * identical backup and manifest under beforeMigrate's same exclusive transaction.
 * Never enrolls, rewrites historical data, resumes work, or changes custody. */
export function migrateFailedOriginalFulfillmentStorage(file: string, value: StorageIdentity,
  beforeMigrate: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (identity.authorityMode !== "mainnet-real" || typeof beforeMigrate !== "function")
    throw new Error("Original fulfillment migration authority refused");
  const [previous, current] = originalFulfillmentSchemaProfiles(), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok")
      throw new Error("Original fulfillment migration integrity refused");
    const excluded = () => new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
      "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db!, identity))]);
    const before = sqliteApplicationSchemaProfile(db, excluded());
    if (before !== previous && before !== current) throw new Error("Original fulfillment migration source profile differs");
    beforeMigrate(db); held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (sqliteApplicationSchemaProfile(db, excluded()) !== before)
      throw new Error("Original fulfillment migration admission changed");
    if (before === previous) { db.exec(A2A_FULFILLMENT_SQL); installStorageFences(db, identity); }
    assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    const after = sqliteApplicationSchemaProfile(db, excluded());
    if (after !== current || db.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Original fulfillment migration verification refused");
    db.exec("COMMIT");
    return { format: "keryx-original-fulfillment-storage-migration-v1",
      status: before === current ? "already-current" : "migrated",
      beforeSchemaDigest: createHash("sha256").update(before).digest("hex"),
      afterSchemaDigest: createHash("sha256").update(after).digest("hex") };
  } catch (error) { try { db?.exec("ROLLBACK"); } catch { /* Preserve original failure. */ } throw error; }
  finally { try { db?.close(); } finally { held.close(); } }
}
