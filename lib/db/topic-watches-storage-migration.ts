import { DatabaseSync, constants } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";
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

/** Exact pre-269 full20, distinct from the older pre-watch full19. These are
 * migration-only names; no old/partial family becomes a runtime profile. */
export const PRE_OWNER_NATIVE_USER_DOMAIN_TABLES = Object.freeze([...HISTORICAL_NATIVE_USER_DOMAIN_TABLES, "topic_watches"]);
const OWNER269_TABLES = Object.freeze(["owner269_operations", "owner269_associations"]);

type SourceMigrationPlan = Readonly<{
  pair: readonly [string, string];
  added: readonly string[];
  ddl: readonly string[];
}>;
let historical19Plans: readonly SourceMigrationPlan[] | undefined;
let preOwner20Plans: readonly SourceMigrationPlan[] | undefined;

/** One compiled fixed22 target, two archive variants, separate old19/old20
 * references. Never infer a family from its count or accept future chat/pending
 * additions. The parent must qualify any later combined source separately. */
function topicWatchesMigrationPlans(historical19: boolean) {
  const sourceTables: readonly string[] = NATIVE_USER_DOMAIN_TABLES;
  const expected = [...PRE_OWNER_NATIVE_USER_DOMAIN_TABLES, ...OWNER269_TABLES];
  const added = historical19 ? ["topic_watches", ...OWNER269_TABLES] : [...OWNER269_TABLES];
  const guardNames = OWNER269_OCCUPANCY_PROPOSAL.map(entry => entry.name);
  const expectedGuards = ["owner269_ticket_occupancy", "owner269_original_insert", "owner269_original_update",
    "owner269_original_delete", "owner269_a2a_insert", "owner269_a2a_update"];
  if (new Set(NATIVE_USER_DOMAIN_TABLES).size !== NATIVE_USER_DOMAIN_TABLES.length ||
    canonicalJson([...sourceTables].sort()) !== canonicalJson(expected.sort()) ||
    canonicalJson([...guardNames].sort()) !== canonicalJson(expectedGuards.sort()))
    throw new Error("ROOT must qualify the exact full19/full20-to-owner269 full22 source reference");
  const cached = historical19 ? historical19Plans : preOwner20Plans;
  if (cached) return cached;
  const plans = Object.freeze([false, true].map(publicReferenceArchive => {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec("BEGIN"); installMainnetApplicationSchema(reference, { publicReferenceArchive });
      installNativeUserDomainSchema(reference);
      const after = sqliteApplicationSchemaProfile(reference, new Set());
      // DDL is taken ONLY from the isolated, trusted source installer, never
      // target metadata, a caller table list, an environment value or a file.
      const objects = reference.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%' ORDER BY rowid`).all().filter(row => added.includes(String(row.tbl_name)) || guardNames.includes(String(row.name)));
      if (objects.filter(row => row.type === "table").length !== added.length ||
        objects.some(row => !["table", "index", "trigger"].includes(String(row.type)) || typeof row.sql !== "string") ||
        OWNER269_OCCUPANCY_PROPOSAL.some(guard => !objects.some(row => row.type === "trigger" && row.name === guard.name && row.sql === guard.sql)))
        throw new Error("Metadata migration source DDL differs");
      // Shared-table triggers are the ONLY delta outside the fixed added tables.
      // Drop them before the isolated-reference tables they read. No target DDL
      // or supplied table/SQL list can enter this source-built plan.
      for (const name of guardNames) reference.exec(`DROP TRIGGER "${name}"`);
      for (const table of [...added].reverse()) reference.exec(`DROP TABLE "${table}"`); // isolated reference only
      const before = sqliteApplicationSchemaProfile(reference, new Set());
      const oldSchema = JSON.parse(before) as unknown[], newSchema = JSON.parse(after) as unknown[];
      const delta = newSchema.filter(row => !oldSchema.some(old => canonicalJson(old) === canonicalJson(row)));
      if (oldSchema.some(row => !newSchema.some(next => canonicalJson(next) === canonicalJson(row))) ||
        canonicalJson(delta.map(canonicalJson).sort()) !== canonicalJson(objects.map(canonicalJson).sort()))
        throw new Error("Metadata migration changes historical schema");
      reference.exec("ROLLBACK");
      return Object.freeze({ pair: Object.freeze([before, after] as const),
        added: Object.freeze([...added]), ddl: Object.freeze(objects.map(row => String(row.sql))) });
    } finally { reference.close(); }
  }));
  // Frozen plans contain only compiled source profiles/DDL, never target state.
  // A failed assembly is not published and can be attempted again normally.
  if (historical19) historical19Plans = plans;
  else preOwner20Plans = plans;
  return plans;
}
export function topicWatchesMigrationProfiles(): readonly (readonly [string, string])[] {
  return Object.freeze(topicWatchesMigrationPlans(true).map(plan => plan.pair));
}
export function ownerRunAssignmentsMigrationProfiles(): readonly (readonly [string, string])[] {
  return Object.freeze(topicWatchesMigrationPlans(false).map(plan => plan.pair));
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
  const plans = [...topicWatchesMigrationPlans(true), ...topicWatchesMigrationPlans(false)], held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { allowExtension: false });
    db.exec("PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE");
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity);
    const before = sqliteApplicationSchemaProfile(db, excluded(db, identity));
    const plan = plans.find(({ pair: [old, current] }) => before === old || before === current);
    if (!plan) throw new Error("Watch migration full19/full20/current owner269 source differs");
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
