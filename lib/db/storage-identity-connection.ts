import { DatabaseSync, type StatementSync } from "node:sqlite";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, assertStorageIdentity, holdStorageTarget, registerStorageCapability, restrictStorageApplicationSql } from "./storage-identity-sqlite";

/** Guarded application SQL access, not provisioning, migration, or a read-only provenance inspector. */
export function openVerifiedSqliteStorage(file: string, expected: StorageIdentity, options: { readOnly?: boolean } = {}): { db: DatabaseSync; close(): void } {
  const identity = validateStorageIdentity(expected), held = holdStorageTarget(file);
  let db: DatabaseSync | undefined, closed = false;
  try {
    db = new DatabaseSync(file, { readOnly: options.readOnly ?? false, allowExtension: false });
    held.verify(); assertStorageIdentity(db, identity); assertStorageFences(db, identity); held.verify();
    // Connection settings follow identity admission and precede SQL restriction. They are not schema repair.
    db.exec("PRAGMA busy_timeout=5000");
    if (!options.readOnly) db.exec("PRAGMA synchronous=FULL");
  } catch (error) { try { db?.close(); } finally { held.close(); } throw error; }
  const native = db;
  const assert = () => {
    if (closed) throw new Error("Verified storage connection closed");
    held.verify(); assertStorageIdentity(native, identity); assertStorageFences(native, identity);
  };
  registerStorageCapability(native, identity, () => !closed);
  restrictStorageApplicationSql(native);
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
    // Do not expose registration/extension/changeset entrypoints as an app capability.
    throw new Error("Unsupported verified storage operation");
  } });
  return { db: wrapped, close };
}
