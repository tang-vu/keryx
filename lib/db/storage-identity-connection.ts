import { DatabaseSync, type StatementSync } from "node:sqlite";
import { StorageIdentityRefused, refuseStorage, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, registerStorageCapability, restrictStorageApplicationSql, storageFenceStatements, STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { assertSqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";

const verifiedConnections = new WeakMap<DatabaseSync, { identity: Readonly<StorageIdentity>; assert(): void }>();

/** Internal composition verifies native connection provenance; an ordinary DB cannot qualify. */
export function assertVerifiedSqliteConnection(db: DatabaseSync): Readonly<StorageIdentity> {
  const record = verifiedConnections.get(db);
  if (!record) return refuseStorage("storage_unavailable");
  record.assert();
  return record.identity;
}

/** Guarded application SQL access, not provisioning, migration, or a read-only provenance inspector. */
export function openVerifiedSqliteStorage(file: string, expected: StorageIdentity, options: { readOnly?: boolean; runtimeGuard?: () => void; applicationProfiles?: readonly string[] } = {}): { db: DatabaseSync; close(): void } {
  const runtimeGuard = options.runtimeGuard;
  const suppliedProfiles = options.applicationProfiles;
  if (suppliedProfiles !== undefined && (!Array.isArray(suppliedProfiles) || suppliedProfiles.length < 1
    || suppliedProfiles.length > 2)) return refuseStorage("storage_unavailable");
  let profiles: readonly string[] | undefined;
  if (suppliedProfiles !== undefined) {
    const captured: string[] = [];
    for (let index = 0; index < suppliedProfiles.length; index++) {
      const profile = suppliedProfiles[index];
      if (typeof profile !== "string" || Buffer.byteLength(profile) > 2 * 1024 * 1024)
        return refuseStorage("storage_unavailable");
      captured.push(profile);
    }
    profiles = Object.freeze(captured);
  }
  const identity = validateStorageIdentity(expected), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined, closed = false;
  let excluded: Set<string> | undefined;
  try {
    runtimeGuard?.();
    db = new DatabaseSync(file, { readOnly: options.readOnly ?? false, allowExtension: false });
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    if (profiles) {
      excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
        "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]);
      assertSqliteApplicationSchemaProfile(db, excluded, profiles);
    }
    // Connection settings follow identity admission and precede SQL restriction. They are not schema repair.
    db.exec("PRAGMA busy_timeout=5000");
    if (!options.readOnly) db.exec("PRAGMA synchronous=FULL");
    registerStorageCapability(db, identity, () => !closed);
    restrictStorageApplicationSql(db);
  } catch (error) {
    closed = true;
    try { db?.close(); } catch { /* preserve fixed admission refusal */ }
    try { held.close(); } catch { /* preserve fixed admission refusal */ }
    if(error instanceof StorageIdentityRefused) throw error;
    return refuseStorage("storage_unavailable");
  }
  const native = db;
  const assert = () => {
    if (closed) throw new Error("Verified storage connection closed");
    runtimeGuard?.();
    const ownTransaction = !native.isTransaction;
    if (ownTransaction) native.exec("BEGIN");
    try {
      held.verify(); assertStorageIdentity(native, identity); assertStorageFences(native, identity);
      if (profiles && excluded) assertSqliteApplicationSchemaProfile(native, excluded, profiles);
      held.verify();
      if (ownTransaction) native.exec("COMMIT");
    } catch (error) {
      if (ownTransaction) native.exec("ROLLBACK");
      throw error;
    }
  };
  const close = () => { if (!closed) { closed = true; try { native.close(); } finally { held.close(); } } };
  function guardStatement(statement: StatementSync): StatementSync {
    return new Proxy(statement, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (["run", "get", "all"].includes(String(property)) && typeof value === "function") {
        return (...args: unknown[]) => { assert(); return Reflect.apply(value, target, args); };
      }
      if (property === "iterate") return function* (...args: unknown[]) {
        assert(); const iterator = Reflect.apply(target.iterate, target, args);
        try {
          for (;;) { assert(); const item = iterator.next(); if (item.done) return; yield item.value; }
        } finally { iterator.return?.(); }
      };
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }
  const wrapped = new Proxy(native, { get(target, property) {
    if (property === "close") return close;
    if (property === "prepare") return (sql: string) => { assert(); return guardStatement(target.prepare(sql)); };
    if (property === "exec") return (sql: string) => { assert(); target.exec(sql); };
    if (property === "isTransaction") { assert(); return target.isTransaction; }
    // Do not expose registration/extension/changeset entrypoints as an app capability.
    throw new Error("Unsupported verified storage operation");
  } });
  verifiedConnections.set(wrapped, { identity, assert });
  return { db: wrapped, close };
}
