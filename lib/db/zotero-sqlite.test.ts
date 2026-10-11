import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createSqliteZotero } from "./zotero-sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { encryptContent } from "../ipfs/content-crypto";
const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`, connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [];
afterEach(() => { connections.splice(0).forEach(db => db.close()); adapters.splice(0).forEach(adapter => adapter.close()); vi.unstubAllEnvs(); });
function fixture() { const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); return { db, store: createSqliteZotero(db) }; }
it("keeps the capability and additive tables absent by default, exposing only an opt-in ordinary port", async () => {
  vi.stubEnv("KERYX_ZOTERO_ENABLED", ""); const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); await adapter.init();
  expect(adapter.zotero).toBeUndefined(); const db = Reflect.get(adapter, "db") as DatabaseSync;
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()).toBeUndefined();
  vi.stubEnv("KERYX_ZOTERO_ENABLED", "1"); await adapter.init(); expect(adapter.zotero).toBeDefined(); expect(Object.keys(adapter)).not.toContain("zotero");
});
it("preserves unknown optional schema and ordinary research instead of repairing it", async () => {
  vi.stubEnv("KERYX_ZOTERO_ENABLED", "1"); const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter);
  const db = Reflect.get(adapter, "db") as DatabaseSync; db.exec("CREATE TABLE zotero_connections(unknown TEXT)");
  await adapter.init(); expect(adapter.zotero).toBeUndefined(); expect(await adapter.listSources()).toEqual([]);
  expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='zotero_connections'").get()?.sql).toBe("CREATE TABLE zotero_connections(unknown TEXT)");
});
it("refuses enrolled storage before installing any integration table", () => {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); db.exec("CREATE TABLE keryx_storage_identity(identity TEXT)");
  expect(() => createSqliteZotero(db)).toThrow(); expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()).toBeUndefined();
});
it("enforces atomic owner leases, revocation generations, bounds and exact schema on every action", async () => {
  const f = fixture(), lease = await f.store.acquire(owner, false);
  await expect(f.store.acquire(owner, false)).rejects.toThrow("zotero_busy");
  await f.store.revoke(owner); await expect(f.store.check(lease)).rejects.toThrow("zotero_disconnected");
  const fresh = await f.store.acquire(owner, false); await f.store.release(lease); await f.store.check(fresh); await f.store.release(fresh);
  expect(await f.store.status(other)).toEqual({ connected: false, userId: null });
  f.db.exec("CREATE TRIGGER unknown_zotero AFTER DELETE ON zotero_connections BEGIN SELECT 1; END");
  await expect(f.store.status(owner)).rejects.toThrow("zotero_unavailable");
});
it("persists keys across store instances and reserves them before any provider write", async () => {
  vi.stubEnv("CONTENT_MASTER_KEY", "22".repeat(32)); const f = fixture(), lease = await f.store.acquire(owner, false);
  await f.store.connect(lease, "1234", encryptContent("synthetic")); await f.store.release(lease);
  const sending = await f.store.acquire(owner, true), key = await f.store.key(sending, "1234", "1".repeat(64));
  expect(key).toMatch(/^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/); await f.store.release(sending);
  const second = createSqliteZotero(f.db), next = await second.acquire(owner, true);
  expect(await second.key(next, "1234", "1".repeat(64))).toBe(key);
  await expect(second.key(next, "1234", "2".repeat(64), key)).rejects.toThrow("zotero_conflict");
  await expect(second.key(next, "9999", "1".repeat(64))).rejects.toThrow("zotero_unavailable");
});
it("binds a personal library atomically to one wallet and retains ownership through revocation", async () => {
  vi.stubEnv("CONTENT_MASTER_KEY", "22".repeat(32)); const f = fixture(), second = createSqliteZotero(f.db);
  const firstLease = await f.store.acquire(owner, false), otherLease = await second.acquire(other, false);
  await f.store.connect(firstLease, "1234", encryptContent("synthetic"));
  await expect(second.connect(otherLease, "1234", encryptContent("synthetic"))).rejects.toThrow("zotero_library_bound");
  expect(await second.status(other)).toEqual({ connected: false, userId: null });
  await f.store.revoke(owner); await expect(f.store.check(firstLease)).rejects.toThrow("zotero_disconnected");
  await expect(second.connect(otherLease, "1234", encryptContent("synthetic"))).rejects.toThrow("zotero_library_bound");
  const reconnect = await second.acquire(owner, false); await second.connect(reconnect, "1234", encryptContent("synthetic"));
  await f.store.release(firstLease); await second.check(reconnect);
  expect(f.db.prepare("SELECT * FROM zotero_library_owners").all()).toEqual([{ user_id: "1234", wallet: owner }]);
});
it("limits provider operations across owners and store instances to four durable leases", async () => {
  const f = fixture(), second = createSqliteZotero(f.db), leases = [];
  for (const digit of ["a", "b", "c", "d"]) leases.push(await f.store.acquire(`0x${digit.repeat(40)}`, false));
  await expect(second.acquire(`0x${"e".repeat(40)}`, false)).rejects.toThrow("zotero_busy");
  await second.release(leases[0]); expect(await second.acquire(`0x${"e".repeat(40)}`, false)).toMatchObject({ owner: `0x${"e".repeat(40)}` });
});
