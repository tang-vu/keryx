import { DatabaseSync, constants } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema, NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema";
import { snapshotPublicArchiveStorage } from "./public-reference-archive-migration";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

let expectedMigrationProfiles: readonly (readonly [string, string])[] | undefined;

/** Two exact mainnet pairs: archive absent/present, each moving from the
 * original whole schema to the fixed complete native-user bundle. */
export function privateProfilesMigrationProfiles(): readonly (readonly [string, string])[] {
  if (expectedMigrationProfiles) return expectedMigrationProfiles;
  const profiles = Object.freeze([false, true].map(publicReferenceArchive => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("BEGIN");
      installMainnetApplicationSchema(db, { publicReferenceArchive });
      const before = sqliteApplicationSchemaProfile(db, new Set());
      installNativeUserDomainSchema(db);
      const after = sqliteApplicationSchemaProfile(db, new Set());
      db.exec("COMMIT");
      return Object.freeze([before, after] as const);
    } finally { db.close(); }
  }));
  // Only immutable source-reference strings; publish after both variants succeed.
  expectedMigrationProfiles = profiles;
  return profiles;
}
function excluded(db: DatabaseSync, identity: StorageIdentity) {
  return new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
    "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]);
}

/** Same bounded typed original/backup snapshots as the public archive migration.
 * Raw TEXT bytes, integer/real/blob/null types and rowids remain part of the proof. */
export const snapshotPrivateProfilesStorage = snapshotPublicArchiveStorage;

function restrictBackupAdmission(db: DatabaseSync) {
  const read = new Set([constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE]);
  db.setAuthorizer((action, first, second) => {
    if (action === constants.SQLITE_PRAGMA) return ["integrity_check", "foreign_key_check", "page_count", "page_size", "table_info"].includes(first ?? "")
      ? constants.SQLITE_OK : constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION && second?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
    return read.has(action) ? constants.SQLITE_OK : constants.SQLITE_DENY;
  });
}

/** Explicit stopped-writer migration, never application startup. The mandatory
 * admission callback verifies the flushed no-replace backup and manifest while
 * this connection holds BEGIN EXCLUSIVE. ROOT must hold the deployment lease and
 * actually stop all writers; this helper does not discover or stop processes. */
export function migratePrivateProfilesStorage(file: string, value: StorageIdentity, beforeMigrate: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (identity.authorityMode !== "mainnet-real") throw new Error("Private profile migration mainnet source required");
  if (typeof beforeMigrate !== "function") throw new Error("Private profile migration backup admission required");
  const pairs = privateProfilesMigrationProfiles(), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const before = sqliteApplicationSchemaProfile(db, excluded(db, identity));
    const pair = pairs.find(([previous, current]) => before === previous || before === current);
    if (!pair) throw new Error("Private profile migration source profile differs");
    const originals = snapshotPrivateProfilesStorage(db, identity, pair);
    const changes = db.prepare("SELECT total_changes() AS n").get()!.n;
    restrictBackupAdmission(db);
    beforeMigrate(db);
    db.setAuthorizer(null);
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    if (!db.isTransaction || sqliteApplicationSchemaProfile(db, excluded(db, identity)) !== before
      || db.prepare("SELECT total_changes() AS n").get()!.n !== changes
      || canonicalJson(snapshotPrivateProfilesStorage(db, identity, pair)) !== canonicalJson(originals))
      throw new Error("Private profile migration admission changed");
    if (before === pair[0]) {
      installNativeUserDomainSchema(db);
      // Existing fences are compared, never replaced. Only the fixed new
      // domain fences are absent from this known complete source schema.
      installStorageFences(db, identity);
    }
    assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    const after = snapshotPrivateProfilesStorage(db, identity, [pair[1]]), retained = { ...after.tables };
    for (const table of NATIVE_USER_DOMAIN_TABLES) if (!(table in originals.tables)) {
      const expectedRows = table === "deliverable_acceptance_store" ? 1 : 0;
      if (after.tables[table]?.rows !== expectedRows) throw new Error("Native user-domain migration unexpected new rows");
      delete retained[table];
    }
    if (canonicalJson(retained) !== canonicalJson(originals.tables)) throw new Error("Private profile migration original rows differ");
    db.exec("COMMIT");
    // A failure after COMMIT is acknowledgement uncertainty. Preserve the store,
    // backup and stopped writers; never automatically restore or delete either.
    db.exec("BEGIN"); held.verify();
    if (canonicalJson(snapshotPrivateProfilesStorage(db, identity, [pair[1]])) !== canonicalJson(after))
      throw new Error("Private profile migration acknowledgement incomplete");
    held.verify(); db.exec("COMMIT");
    return { format: "keryx-private-profile-storage-migration-v1", status: before === pair[1] ? "already-current" : "migrated",
      beforeSchemaDigest: originals.schemaDigest, afterSchemaDigest: after.schemaDigest,
      originalRowsPreserved: true, signingResumeAuthorized: false };
  } catch (error) {
    try { db?.setAuthorizer(null); db?.exec("ROLLBACK"); } catch { /* Preserve the original error and writer-stop evidence. */ }
    throw error;
  } finally { try { db?.close(); } finally { held.close(); } }
}
