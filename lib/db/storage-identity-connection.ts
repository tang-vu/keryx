import { DatabaseSync, type StatementSync } from "node:sqlite";
import { StorageIdentityRefused, refuseStorage, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, registerStorageCapability, restrictStorageApplicationSql, storageFenceStatements, STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { assertSqliteApplicationSchemaProfile, sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { installRunOwnershipFunctions } from "./run-ownership-functions";
import { installPublicProfileFunctions } from "./public-profile-functions";

const verifiedConnections = new WeakMap<DatabaseSync, { identity: Readonly<StorageIdentity>; readOnly: boolean;
  readonly foreignKeys: true; readonly busyTimeout: 5000; readonly nativeUserDomainProfile?: string;
  readonly selectedApplicationProfile?: string;
  closed: boolean; assert(): void; allocatedBytes(): number }>();

/** Dispatch metadata only. Closed/revoked wrappers remain verified and must
 * never fall back to an ordinary connection after their guard refuses. */
export function isVerifiedSqliteConnection(db: DatabaseSync): boolean {
  return verifiedConnections.has(db);
}

/** Fixed allocation metadata, including uncommitted pages. No SQL, callbacks,
 * native handles or caller-controlled limits leave the verified connection. */
export function readVerifiedSqliteAllocatedBytes(db: DatabaseSync): number {
  const record = verifiedConnections.get(db);
  if (arguments.length !== 1 || !record) return refuseStorage("storage_unavailable");
  record.assert();
  const bytes = record.allocatedBytes();
  record.assert();
  return bytes;
}

/** Internal composition verifies native connection provenance; an ordinary DB cannot qualify. */
export function assertVerifiedSqliteConnection(db: DatabaseSync, access: "read" | "write" = "read"): Readonly<StorageIdentity> {
  const record = verifiedConnections.get(db);
  if (arguments.length > 2 || !record || !["read", "write"].includes(access)
    || access === "write" && record.readOnly) return refuseStorage("storage_unavailable");
  record.assert();
  return record.identity;
}

/** Metadata-only native write policy; callers must still run the full runtime guard. */
export function assertVerifiedSqliteWritePolicy(db: DatabaseSync): void {
  const record = verifiedConnections.get(db);
  if (arguments.length !== 1 || !record || record.readOnly) return refuseStorage("storage_unavailable");
}

/** Fixed positive connection policy only. Domain callers also run the runtime
 * guard; this exposes no PRAGMA, raw connection or caller-provided callback. */
export function assertVerifiedSqliteForeignKeys(db: DatabaseSync): void {
  const record = verifiedConnections.get(db);
  if (arguments.length !== 1 || !record || record.closed || record.foreignKeys !== true) return refuseStorage("storage_unavailable");
}

/** Source-known complete user bundle and fixed connection policy captured at
 * trusted opening. No SQL, reference database, callback or configuration here;
 * callers must still run the full runtime guard before each operation. */
export function assertVerifiedSqliteNativeUserDomainPolicy(db: DatabaseSync): void {
  const record = verifiedConnections.get(db);
  if (arguments.length !== 1 || !record || record.closed || record.foreignKeys !== true
    || record.busyTimeout !== 5000 || !record.nativeUserDomainProfile) return refuseStorage("storage_unavailable");
}

/** Source-known mainnet BEFORE or complete user bundle, with the captured runtime
 * guard. Metadata only: operation callers still assert the full connection. */
export function assertVerifiedSqliteSelectedApplicationPolicy(db: DatabaseSync): void {
  const record = verifiedConnections.get(db);
  if (arguments.length !== 1 || !record || record.closed || record.identity.authorityMode !== "mainnet-real"
    || record.foreignKeys !== true || record.busyTimeout !== 5000 || !record.selectedApplicationProfile)
    return refuseStorage("storage_unavailable");
}

/** Guarded application SQL access, not provisioning, migration, or a read-only provenance inspector. */
export function openVerifiedSqliteStorage(file: string, expected: StorageIdentity, options: { readOnly?: boolean; runtimeGuard?: () => void; applicationProfiles?: readonly string[] } = {}): { db: DatabaseSync; close(): void } {
  const runtimeGuard = options.runtimeGuard;
  const readOnly = options.readOnly ?? false;
  const suppliedProfiles = options.applicationProfiles;
  if (suppliedProfiles !== undefined && (!Array.isArray(suppliedProfiles) || suppliedProfiles.length < 1
    || suppliedProfiles.length > 4)) return refuseStorage("storage_unavailable");
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
  let nativeUserDomainProfile: string | undefined;
  let selectedApplicationProfile: string | undefined;
  let allocatedBytes: (() => number) | undefined;
  try {
    runtimeGuard?.();
    db = new DatabaseSync(file, { readOnly, allowExtension: false });
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    if (profiles) {
      excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
        "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, identity))]);
      assertSqliteApplicationSchemaProfile(db, excluded, profiles);
      if (identity.authorityMode === "mainnet-real") {
        const actual = sqliteApplicationSchemaProfile(db, excluded);
        const source = supportedSqliteApplicationProfiles(true);
        if (actual === source[1] || actual === source[3]) nativeUserDomainProfile = actual;
        if (typeof runtimeGuard === "function" && source.includes(actual)) selectedApplicationProfile = actual;
      }
    }
    // Connection settings follow identity admission and precede SQL restriction. They are not schema repair.
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA foreign_keys=ON");
    if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) return refuseStorage("storage_unavailable");
    if (identity.authorityMode === "mainnet-real") installRunOwnershipFunctions(db);
    if (identity.authorityMode === "mainnet-real") installPublicProfileFunctions(db);
    if (!readOnly) db.exec("PRAGMA synchronous=FULL");
    registerStorageCapability(db, identity, () => !closed);
    allocatedBytes = restrictStorageApplicationSql(db);
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
      const fixedProfile = nativeUserDomainProfile ?? selectedApplicationProfile;
      if (profiles && excluded) assertSqliteApplicationSchemaProfile(native, excluded,
        fixedProfile ? [fixedProfile] : profiles);
      held.verify();
      if (ownTransaction) native.exec("COMMIT");
    } catch (error) {
      if (ownTransaction) native.exec("ROLLBACK");
      throw error;
    }
  };
  const close = () => { if (!closed) { closed = true; record.closed = true; try { native.close(); } finally { held.close(); } } };
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
  const record = { identity, readOnly, foreignKeys: true as const, busyTimeout: 5000 as const,
    nativeUserDomainProfile, selectedApplicationProfile, closed: false, assert, allocatedBytes: allocatedBytes! };
  verifiedConnections.set(wrapped, record);
  return { db: wrapped, close };
}
