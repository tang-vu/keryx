import { DatabaseSync, constants } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";
import { snapshotPublicArchiveStorage } from "./public-reference-archive-migration";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, installStorageFences,
  STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

export const HISTORICAL_NATIVE_USER_DOMAIN_TABLES = Object.freeze(["private_profiles", "profile_verified_identities", "profile_identity_challenges",
  "private_bibliographies", "deliverable_acceptance_store", "deliverable_acceptance_entries", "run_privacy",
  "run_privacy_defaults", "run_privacy_audit", "anonymous_run_claims", "public_researcher_profiles", "decision_review_records",
  "decision_review_verdicts", "account267_accounts", "account267_members", "account267_credentials", "account267_sessions",
  "account267_challenges", "account267_events"]);

/** Migration-only references, never additional runtime admission. The optional
 * chat pair is admitted only when both are actually in the compiled source.
 * Each changed compiled target still needs the release owner's acceptance.
 * The known topic-only full20 predecessor is migration-only when the compiled
 * source also contains the complete chat pair. It is never runtime admission.
 * pending_job_owners and arbitrary partial/unknown families are not admitted. */
function topicWatchesMigrationPlans() {
  const sourceTables: readonly string[] = NATIVE_USER_DOMAIN_TABLES;
  const added = sourceTables.filter(table => !HISTORICAL_NATIVE_USER_DOMAIN_TABLES.includes(table));
  const known = [["topic_watches"], ["chat263_links", "chat263_tokens", "topic_watches"]];
  if (new Set(NATIVE_USER_DOMAIN_TABLES).size !== NATIVE_USER_DOMAIN_TABLES.length ||
    HISTORICAL_NATIVE_USER_DOMAIN_TABLES.some(table => !sourceTables.includes(table)) ||
    !known.some(tables => canonicalJson([...tables].sort()) === canonicalJson([...added].sort())))
    throw new Error("ROOT must qualify the full19-to-complete-bundle migration reference");
  const missingFamilies = added.includes("chat263_links")
    ? [added, ["chat263_links", "chat263_tokens"]] : [added];
  return Object.freeze([false, true].flatMap(publicReferenceArchive => missingFamilies.map(missing => {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec("BEGIN"); installMainnetApplicationSchema(reference, { publicReferenceArchive });
      installNativeUserDomainSchema(reference);
      const after = sqliteApplicationSchemaProfile(reference, new Set());
      // DDL is taken ONLY from the isolated, trusted source installer, never
      // target metadata, a caller table list, an environment value or a file.
      const objects = reference.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid`).all().filter(row => missing.includes(String(row.tbl_name)));
      if (objects.filter(row => row.type === "table").length !== missing.length ||
        objects.some(row => !["table", "index", "trigger"].includes(String(row.type)) || typeof row.sql !== "string"))
        throw new Error("Metadata migration source DDL differs");
      for (const table of [...missing].reverse()) reference.exec(`DROP TABLE "${table}"`); // isolated reference only
      const before = sqliteApplicationSchemaProfile(reference, new Set());
      const oldSchema = JSON.parse(before) as unknown[], newSchema = JSON.parse(after) as unknown[];
      const delta = newSchema.filter(row => !oldSchema.some(old => canonicalJson(old) === canonicalJson(row)));
      if (oldSchema.some(row => !newSchema.some(next => canonicalJson(next) === canonicalJson(row))) ||
        canonicalJson(delta.map(canonicalJson).sort()) !== canonicalJson(objects.map(canonicalJson).sort()))
        throw new Error("Metadata migration changes historical schema");
      reference.exec("ROLLBACK");
      return Object.freeze({ pair: Object.freeze([before, after] as const),
        added: Object.freeze([...missing]), ddl: Object.freeze(objects.map(row => String(row.sql))) });
    } finally { reference.close(); }
  })));
}
export function topicWatchesMigrationProfiles(): readonly (readonly [string, string])[] {
  return Object.freeze(topicWatchesMigrationPlans().map(plan => plan.pair));
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
/** Explicit operator helper only. ROOT stops all writers and owns the exclusive lease.
 * Callback admits a flushed no-replace typed backup+manifest under EXCLUSIVE;
 * snapshot comparison includes raw TEXT, rowids, blobs, integer/real/null cells.
 * No startup caller or signing-resume authority is supplied. */
export function migrateTopicWatchesStorage(file: string, value: StorageIdentity, admitBackup: (db: DatabaseSync) => void) {
  const identity = validateStorageIdentity(value);
  if (identity.authorityMode !== "mainnet-real" || typeof admitBackup !== "function") throw new Error("Watch migration admission required");
  const plans = topicWatchesMigrationPlans(), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const before = sqliteApplicationSchemaProfile(db, excluded(db, identity));
    const plan = plans.find(({ pair: [old, current] }) => before === old || before === current);
    if (!plan) throw new Error("Watch migration full19/current source differs");
    const pair = plan.pair;
    const original = snapshotTopicWatchesStorage(db, identity, pair), changes = db.prepare("SELECT total_changes() AS n").get()!.n;
    backupAdmissionOnly(db); admitBackup(db); db.setAuthorizer(null);
    held.verify();
    if (!db.isTransaction || db.prepare("SELECT total_changes() AS n").get()!.n !== changes ||
      canonicalJson(snapshotTopicWatchesStorage(db, identity, pair)) !== canonicalJson(original)) throw new Error("Watch backup admission changed source");
    if (before === pair[0]) { for (const sql of plan.ddl) db.exec(sql); installStorageFences(db, identity); }
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const after = snapshotTopicWatchesStorage(db, identity, [pair[1]]), retained = { ...after.tables };
    for (const table of plan.added) if (!(table in original.tables)) {
      if (retained[table]?.rows !== 0) throw new Error("Watch migration unexpected seed");
      delete retained[table];
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
