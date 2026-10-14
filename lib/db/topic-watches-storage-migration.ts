import { DatabaseSync, constants } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";
import { TOPIC_WATCHES_SQL } from "./topic-watches-schema";
import { snapshotPublicArchiveStorage } from "./public-reference-archive-migration";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

const legacyFull19 = Object.freeze(["private_profiles", "profile_verified_identities", "profile_identity_challenges",
  "private_bibliographies", "deliverable_acceptance_store", "deliverable_acceptance_entries", "run_privacy",
  "run_privacy_defaults", "run_privacy_audit", "anonymous_run_claims", "public_researcher_profiles", "decision_review_records",
  "decision_review_verdicts", "account267_accounts", "account267_members", "account267_credentials", "account267_sessions",
  "account267_challenges", "account267_events"]);

/** Explicit full19 -> full20 source reference; NOT extra runtime profiles. ROOT
 * must compose the sibling-domain additions here before the combined migration.
 * Refuse that uncomposed source instead of silently treating full19 as BEFORE. */
export function topicWatchesMigrationProfiles(): readonly (readonly [string, string])[] {
  if (canonicalJson([...NATIVE_USER_DOMAIN_TABLES].sort()) !== canonicalJson([...legacyFull19, "topic_watches"].sort()))
    throw new Error("ROOT must compose the full19-to-complete-bundle migration reference");
  return Object.freeze([false, true].map(publicReferenceArchive => {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec("BEGIN"); installMainnetApplicationSchema(reference, { publicReferenceArchive });
      installNativeUserDomainSchema(reference);
      const after = sqliteApplicationSchemaProfile(reference, new Set());
      reference.exec("DROP TABLE topic_watches"); // isolated reference only; never the target
      const before = sqliteApplicationSchemaProfile(reference, new Set());
      reference.exec("ROLLBACK");
      return Object.freeze([before, after] as const);
    } finally { reference.close(); }
  }));
}
export const snapshotTopicWatchesStorage = snapshotPublicArchiveStorage;
function excluded(db: DatabaseSync, identity: StorageIdentity) {
  return new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
    "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]);
}
function backupAdmissionOnly(db: DatabaseSync) {
  const read = new Set([constants.SQLITE_READ, constants.SQLITE_SELECT, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE]);
  db.setAuthorizer((action, first, second) => {
    if (action === constants.SQLITE_PRAGMA) return ["integrity_check", "foreign_key_check", "page_count", "page_size", "table_info"].includes(first ?? "")
      ? constants.SQLITE_OK : constants.SQLITE_DENY;
    if (action === constants.SQLITE_FUNCTION && second?.toLowerCase() === "load_extension") return constants.SQLITE_DENY;
    return read.has(action) ? constants.SQLITE_OK : constants.SQLITE_DENY;
  });
}
/** Reference helper only. ROOT stops all writers and owns the exclusive lease.
 * Callback admits a flushed no-replace typed backup+manifest under EXCLUSIVE;
 * snapshot comparison includes raw TEXT, rowids, blobs, integer/real/null cells.
 * No startup caller, target execution or signing-resume authority is supplied. */
export function migrateTopicWatchesStorage(file: string, value: StorageIdentity, admitBackup: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (identity.authorityMode !== "mainnet-real" || typeof admitBackup !== "function") throw new Error("Watch migration admission required");
  const pairs = topicWatchesMigrationProfiles(), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const before = sqliteApplicationSchemaProfile(db, excluded(db, identity));
    const pair = pairs.find(([old, current]) => before === old || before === current);
    if (!pair) throw new Error("Watch migration full19/current source differs");
    const original = snapshotTopicWatchesStorage(db, identity, pair), changes = db.prepare("SELECT total_changes() AS n").get()!.n;
    backupAdmissionOnly(db); admitBackup(db); db.setAuthorizer(null);
    held.verify();
    if (!db.isTransaction || db.prepare("SELECT total_changes() AS n").get()!.n !== changes ||
      canonicalJson(snapshotTopicWatchesStorage(db, identity, pair)) !== canonicalJson(original)) throw new Error("Watch backup admission changed source");
    if (before === pair[0]) { db.exec(TOPIC_WATCHES_SQL); installStorageFences(db, identity); }
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const after = snapshotTopicWatchesStorage(db, identity, [pair[1]]), retained = { ...after.tables };
    if (!("topic_watches" in original.tables)) {
      if (retained.topic_watches?.rows !== 0) throw new Error("Watch migration unexpected seed");
      delete retained.topic_watches;
    }
    if (canonicalJson(retained) !== canonicalJson(original.tables)) throw new Error("Watch migration original rows changed");
    const oldSchema = JSON.parse(before) as unknown[];
    const newSchema = JSON.parse(pair[1]) as unknown[];
    if (oldSchema.some(entry => !newSchema.some(candidate => canonicalJson(candidate) === canonicalJson(entry))))
      throw new Error("Watch migration original schema changed");
    db.exec("COMMIT");
    // Uncertain acknowledgement preserves backup and stopped writers, never restores.
    db.exec("BEGIN"); held.verify();
    if (canonicalJson(snapshotTopicWatchesStorage(db, identity, [pair[1]])) !== canonicalJson(after)) throw new Error("Watch migration acknowledgement uncertain");
    held.verify(); db.exec("COMMIT");
    return { format: "keryx-topic-watch-storage-migration-v1", status: before === pair[1] ? "already-current" : "migrated",
      beforeSchemaDigest: original.schemaDigest, afterSchemaDigest: after.schemaDigest, originalRowsPreserved: true, signingResumeAuthorized: false };
  } catch (error) {
    try { db?.setAuthorizer(null); db?.exec("ROLLBACK"); } catch { /* keep original error, backup and writer stop */ }
    throw error;
  } finally { try { db?.close(); } finally { held.close(); } }
}
