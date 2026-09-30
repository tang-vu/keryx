import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { DatabaseSync, constants as sqliteConstants } from "node:sqlite";
import { refuseStorage, storageIdentityDigest, validateStorageIdentity, StorageIdentityRefused, type StorageIdentity } from "./storage-identity";

export const STORAGE_IDENTITY_TABLE = "keryx_storage_identity";
export const STORAGE_APPLICATION_TABLES = Object.freeze([
  "sources", "source_meta", "source_notify", "source_notify_email", "source_items", "article_offers", "gap_intents", "cache_items",
  "payment_events", "browser_authorization_intents", "browser_journal_bindings", "browser_journal_control", "browser_journal_writer",
  "browser_retained_grants", "browser_signer_capacity", "query_runs", "a2a_orders", "activation_events", "withdrawals", "api_keys",
  "api_key_usage", "users", "answer_feedback", "query_memories", "session_grants", "rate_limit_counters", "reasoning_circuits",
  "auth_challenges", "web_sessions", "private_research_intents", "private_treasury_pools", "private_treasury_reservations",
  "private_research_payment_attempts", "private_research_executions", "private_research_results", "private_creator_submissions",
  "private_creator_confirmations", "private_treasury_releases", "private_research_interruptions", "creator_withdrawal_requests",
  "creator_withdrawal_transfer_attempts", "creator_withdrawal_attestations", "public_references", "sync_state",
]);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface HeldStorageTarget {
  target: string; descriptor: number; identity: string;
  verify(): void;
  close(): void;
}
/** Trusted protected directory required: Node SQLite reopens by pathname, not this descriptor. */
export function assertStorageCreationParent(target: string): void {
  try {
    if (!isAbsolute(target) || target !== resolve(target) || target.includes("\0")) refuseStorage("absolute_target_required");
    const parent = dirname(target), root = parse(parent).root;
    let current = root;
    for (const part of relative(root, parent).split(sep)) {
      current = resolve(current, part);
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) refuseStorage("unsafe_target");
    }
    if (process.platform === "win32" ? realpathSync(parent).toLowerCase() !== parent.toLowerCase() : realpathSync(parent) !== parent) refuseStorage("unsafe_target");
  } catch (error) { if (error instanceof StorageIdentityRefused) throw error; refuseStorage("target_unavailable"); }
}
function holdStorageTargetUnchecked(target: string): HeldStorageTarget {
  if (!isAbsolute(target) || target !== resolve(target) || target.includes("\0")) refuseStorage("absolute_target_required");
  let current = parse(target).root;
  for (const part of relative(current, target).split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) refuseStorage("unsafe_target");
  }
  const identity = () => {
    const stat = lstatSync(target, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform === "win32" ? realpathSync(target).toLowerCase() !== target.toLowerCase() : realpathSync(target) !== target)) refuseStorage("unsafe_target");
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  };
  const original = identity();
  const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` !== original || identity() !== original) refuseStorage("target_replaced");
  } catch (error) { closeSync(descriptor); throw error; }
  let closed = false;
  return { target, descriptor, identity: createHash("sha256").update(JSON.stringify([target, original])).digest("hex"),
    verify() {
      try { if (closed || identity() !== original) refuseStorage("target_replaced"); }
      catch (error) { if (error instanceof StorageIdentityRefused) throw error; refuseStorage("target_unavailable"); }
    },
    close() { if (!closed) { closed = true; closeSync(descriptor); } } };
}
export function holdStorageTarget(target: string): HeldStorageTarget {
  try { return holdStorageTargetUnchecked(target); }
  catch (error) { if (error instanceof StorageIdentityRefused) throw error; return refuseStorage("target_unavailable"); }
}
export function readStorageIdentity(db: DatabaseSync): Readonly<StorageIdentity> {
  try {
  const schema = db.prepare("SELECT type FROM sqlite_schema WHERE name=?").get(STORAGE_IDENTITY_TABLE);
  if (!schema) refuseStorage("enrollment_required");
  if (schema.type !== "table") refuseStorage("malformed_marker");
  const rows = db.prepare(`SELECT id,length(CAST(identity AS BLOB)) AS bytes,CASE WHEN length(CAST(identity AS BLOB))<=2048 THEN identity ELSE NULL END AS identity FROM ${STORAGE_IDENTITY_TABLE} LIMIT 2`).all();
  if (rows.length !== 1 || rows[0].id !== 1 || typeof rows[0].identity !== "string" || rows[0].identity.length > 2048) refuseStorage("malformed_marker");
  let identity: unknown;
  try { identity = JSON.parse(rows[0].identity); } catch { refuseStorage("malformed_marker"); }
  const canonical = validateStorageIdentity(identity);
  if (rows[0].identity !== JSON.stringify(canonical)) refuseStorage("malformed_marker");
  return canonical;
  } catch (error) {
    if (error instanceof StorageIdentityRefused) throw error;
    return refuseStorage("malformed_marker");
  }
}
export function assertStorageIdentity(db: DatabaseSync, expected: Readonly<StorageIdentity>): void {
  if (storageIdentityDigest(readStorageIdentity(db)) !== storageIdentityDigest(expected)) refuseStorage("identity_mismatch");
}
const MARKER_GUARDS: Record<string, string> = {
  storage_identity_no_update: `CREATE TRIGGER storage_identity_no_update BEFORE UPDATE ON ${STORAGE_IDENTITY_TABLE} BEGIN SELECT RAISE(ABORT,'storage identity immutable'); END`,
  storage_identity_no_delete: `CREATE TRIGGER storage_identity_no_delete BEFORE DELETE ON ${STORAGE_IDENTITY_TABLE} BEGIN SELECT RAISE(ABORT,'storage identity immutable'); END`,
  storage_identity_no_insert: `CREATE TRIGGER storage_identity_no_insert BEFORE INSERT ON ${STORAGE_IDENTITY_TABLE} WHEN EXISTS(SELECT 1 FROM ${STORAGE_IDENTITY_TABLE}) BEGIN SELECT RAISE(ABORT,'storage identity immutable'); END`,
};
export function insertStorageIdentity(db: DatabaseSync, identity: Readonly<StorageIdentity>): void {
  db.exec(`CREATE TABLE ${STORAGE_IDENTITY_TABLE}(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL CHECK(json_valid(identity)))`);
  for (const sql of Object.values(MARKER_GUARDS)) db.exec(sql);
  db.prepare(`INSERT INTO ${STORAGE_IDENTITY_TABLE} VALUES(1,?)`).run(JSON.stringify(identity));
}
/** Compatible application SQL may mutate fenced rows, never attach, rewrite schema or load extensions. */
export function restrictStorageApplicationSql(db: DatabaseSync): void {
  if (typeof db.setAuthorizer !== "function") refuseStorage("sqlite_authorizer_unavailable");
  const allowed = new Set([sqliteConstants.SQLITE_READ, sqliteConstants.SQLITE_SELECT, sqliteConstants.SQLITE_INSERT,
    sqliteConstants.SQLITE_UPDATE, sqliteConstants.SQLITE_DELETE, sqliteConstants.SQLITE_TRANSACTION,
    sqliteConstants.SQLITE_SAVEPOINT, sqliteConstants.SQLITE_FUNCTION, sqliteConstants.SQLITE_RECURSIVE]);
  db.setAuthorizer((action, first, second) => {
    if (action === sqliteConstants.SQLITE_PRAGMA) return ["schema_version", "table_xinfo", "table_info"].includes(first ?? "")
      ? sqliteConstants.SQLITE_OK : sqliteConstants.SQLITE_DENY;
    if (action === sqliteConstants.SQLITE_FUNCTION && second?.toLowerCase() === "load_extension") return sqliteConstants.SQLITE_DENY;
    return allowed.has(action) ? sqliteConstants.SQLITE_OK : sqliteConstants.SQLITE_DENY;
  });
}
export function registerStorageCapability(db: DatabaseSync, identity: Readonly<StorageIdentity>, active: () => boolean): void {
  const digest = storageIdentityDigest(identity);
  db.function("keryx_storage_capability", { deterministic: false }, (requested, mode) =>
    active() && requested === digest && mode === identity.authorityMode ? 1 : 0);
}
function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map(row => row.name).filter(name => name !== STORAGE_IDENTITY_TABLE);
}
/** All application DML is fenced, including temporary browser journal writer-row operations. */
export function storageFenceStatements(db: DatabaseSync, identity: Readonly<StorageIdentity>): Record<string, string> {
  const result: Record<string, string> = {};
  const digest = storageIdentityDigest(identity);
  for (const table of tableNames(db)) {
    if (!STORAGE_APPLICATION_TABLES.includes(table)) refuseStorage("unsupported_table");
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      const name = `storage_fence_${createHash("sha256").update(table).digest("hex").slice(0, 16)}_${operation.toLowerCase()}`;
      result[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON ${quote(table)} WHEN keryx_storage_capability('${digest}','${identity.authorityMode}') IS NOT 1 BEGIN SELECT RAISE(ABORT,'storage writer identity required'); END`;
    }
    if (["payment_events", "withdrawals", "browser_authorization_intents"].includes(table)) {
      for (const operation of ["INSERT", "UPDATE"]) {
        const name = `storage_profile_${table}_${operation.toLowerCase()}`;
        const extra = table === "browser_authorization_intents" ? " OR lower(NEW.token) IS NOT '0x3600000000000000000000000000000000000000' OR lower(NEW.gateway_contract) IS NOT '0x0077777d7eba4688bdef3e311b846f25870a19b9'" : "";
        result[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON ${quote(table)} WHEN NEW.network IS NOT 'eip155:5042002'${extra} BEGIN SELECT RAISE(ABORT,'storage authority profile mismatch'); END`;
      }
    }
    if (table === "payment_events") {
      for (const operation of ["INSERT", "UPDATE"]) {
        const name = `storage_mode_payment_${operation.toLowerCase()}`;
        const denied = identity.authorityMode === "testnet-real" ? "NEW.settlement_status IS NULL OR NEW.settlement_status='simulated'" : "NEW.settlement_status IS NOT 'simulated' OR NEW.settled IS NOT 0 OR NEW.authorization_id IS NOT NULL OR NEW.grant_epoch IS NOT NULL";
        result[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON payment_events WHEN ${denied} BEGIN SELECT RAISE(ABORT,'storage payment mode mismatch'); END`;
      }
    }
    if (identity.authorityMode === "testnet-offline" && (table.startsWith("browser_") && !["browser_journal_control", "browser_journal_writer"].includes(table) ||
        ["session_grants", "withdrawals", "creator_withdrawal_requests", "creator_withdrawal_transfer_attempts", "creator_withdrawal_attestations", "a2a_orders"].includes(table) || table.startsWith("private_"))) {
      for (const operation of ["INSERT", "UPDATE"]) {
        const name = `storage_offline_${table}_${operation.toLowerCase()}`;
        result[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON ${quote(table)} BEGIN SELECT RAISE(ABORT,'offline storage denies financial authorization'); END`;
      }
    }
    if (identity.authorityMode === "testnet-offline" && table === "browser_journal_control") {
      for (const operation of ["INSERT", "UPDATE"]) {
        const name = `storage_offline_journal_${operation.toLowerCase()}`;
        result[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON browser_journal_control WHEN NEW.active IS NOT 0 BEGIN SELECT RAISE(ABORT,'offline storage denies journal activation'); END`;
      }
    }
  }
  return result;
}
export function installStorageFences(db: DatabaseSync, identity: Readonly<StorageIdentity>): void {
  for (const [name, sql] of Object.entries(storageFenceStatements(db, identity))) {
    const existing = db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name);
    if (existing && existing.sql !== sql) refuseStorage("fence_mismatch");
    if (!existing) db.exec(sql);
  }
}
export function assertStorageFences(db: DatabaseSync, identity: Readonly<StorageIdentity>): void {
  for (const [name, sql] of Object.entries(storageFenceStatements(db, identity))) {
    if (db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)?.sql !== sql) refuseStorage("fence_missing_or_changed");
  }
  for (const [name, sql] of Object.entries(MARKER_GUARDS)) {
    if (db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)?.sql !== sql) refuseStorage("marker_guard_missing_or_changed");
  }
}
