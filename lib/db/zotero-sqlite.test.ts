import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createSqliteZotero, ZOTERO_SQL } from "./zotero-sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { encryptContent } from "../ipfs/content-crypto";
import { ZoteroError } from "../references/zotero-contract";
import { createZoteroService } from "../references/zotero-service";
const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`, connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [];
afterEach(() => { vi.restoreAllMocks(); connections.splice(0).forEach(db => db.close()); adapters.splice(0).forEach(adapter => adapter.close()); vi.unstubAllEnvs(); });
function fixture() { const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); db.exec(ZOTERO_SQL); return { db, store: createSqliteZotero(db) }; }
function unavailable(action: () => unknown) {
  let error; try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ZoteroError); expect(error).toMatchObject({ code: "zotero_unavailable" });
}
it("keeps absent tables and port absent even when enabled, admitting only explicitly installed memory storage", async () => {
  vi.stubEnv("KERYX_ZOTERO_ENABLED", ""); vi.stubEnv("CONTENT_MASTER_KEY", "");
  const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); await adapter.init();
  expect(adapter.zotero).toBeUndefined(); const db = Reflect.get(adapter, "db") as DatabaseSync;
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()).toBeUndefined();
  vi.stubEnv("KERYX_ZOTERO_ENABLED", "1"); await adapter.init(); expect(adapter.zotero).toBeUndefined();
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()).toBeUndefined();
  expect(await adapter.listSources()).toEqual([]); expect(await adapter.listPayments(5)).toEqual([]);
  db.exec(ZOTERO_SQL); const before = JSON.stringify(db.prepare("SELECT * FROM sqlite_schema ORDER BY type,name").all());
  await adapter.init(); expect(adapter.zotero).toBeDefined(); expect(Object.keys(adapter)).not.toContain("zotero");
  expect(JSON.stringify(db.prepare("SELECT * FROM sqlite_schema ORDER BY type,name").all())).toBe(before);
  const transport = vi.fn<typeof fetch>();
  await expect(createZoteroService(adapter.zotero!, transport).connect(owner, "SYNTHETICKEY000000000001")).rejects.toMatchObject({ code: "zotero_unavailable" });
  expect(transport).not.toHaveBeenCalled(); expect(db.prepare("SELECT count(*) AS n FROM zotero_connections").get()?.n).toBe(0);
  expect(await adapter.listSources()).toEqual([]); expect(await adapter.listPayments(5)).toEqual([]);
});
it("preserves unknown optional schema and ordinary research instead of repairing it", async () => {
  vi.stubEnv("KERYX_ZOTERO_ENABLED", "1"); vi.stubEnv("CONTENT_MASTER_KEY", ""); const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter);
  const db = Reflect.get(adapter, "db") as DatabaseSync; db.exec("CREATE TABLE zotero_connections(unknown TEXT); INSERT INTO zotero_connections VALUES('retained')");
  await adapter.init(); expect(adapter.zotero).toBeUndefined(); expect(await adapter.listSources()).toEqual([]);
  expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='zotero_connections'").get()?.sql).toBe("CREATE TABLE zotero_connections(unknown TEXT)");
  expect(db.prepare("SELECT * FROM zotero_connections").all()).toEqual([{ unknown: "retained" }]);
  expect(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()?.n).toBe(1);
  expect(await adapter.listPayments(5)).toEqual([]);
});
it("refuses enrolled storage before installing any integration table", () => {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); db.exec("CREATE TABLE keryx_storage_identity(identity TEXT)");
  unavailable(() => createSqliteZotero(db)); expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'zotero_%'").get()).toBeUndefined();
});
it("admits exact installed storage without any target SQL write and types later BEGIN failures", async () => {
  const f = fixture(); f.db.prepare("INSERT INTO zotero_provider_state VALUES(1,0)").run();
  const before = JSON.stringify(f.db.prepare("SELECT * FROM zotero_provider_state").all());
  const exec = vi.spyOn(f.db, "exec").mockImplementation(() => { throw new Error("synthetic begin/write refusal"); });
  const store = createSqliteZotero(f.db); expect(exec).not.toHaveBeenCalled();
  await expect(store.acquire(owner, false)).rejects.toMatchObject({ code: "zotero_unavailable" });
  expect(exec).toHaveBeenCalledExactlyOnceWith("BEGIN IMMEDIATE");
  expect(JSON.stringify(f.db.prepare("SELECT * FROM zotero_provider_state").all())).toBe(before);
  expect(f.db.prepare("SELECT count(*) AS n FROM zotero_connections").get()?.n).toBe(0);
});
it.each(["authority", "shape"])("types %s read refusal without writing or taking ordinary reads offline", async point => {
  vi.stubEnv("KERYX_ZOTERO_ENABLED", "1"); vi.stubEnv("CONTENT_MASTER_KEY", "");
  const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); await adapter.init();
  const db = Reflect.get(adapter, "db") as DatabaseSync; db.exec(ZOTERO_SQL);
  db.prepare("INSERT INTO sources(id,name,url) VALUES('readiness-source','Synthetic research','https://source.example')").run();
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, "prepare").mockImplementation(sql => {
    if (point === "authority" ? sql === "SELECT 1 FROM sqlite_schema WHERE name='keryx_storage_identity'" : sql.includes("tbl_name IN ('zotero_connections'"))
      throw new Error("synthetic metadata read refusal");
    return prepare(sql);
  });
  const exec = vi.spyOn(db, "exec"); unavailable(() => createSqliteZotero(db)); expect(exec).not.toHaveBeenCalled();
  // Authority failure is injected only at the optional factory for this direct
  // check; shape failure can also pass through the real ordinary init catch.
  if (point === "shape") { await adapter.init(); expect(adapter.zotero).toBeUndefined(); }
  expect(await adapter.getSource("readiness-source")).toMatchObject({ id: "readiness-source", name: "Synthetic research" });
  expect(await adapter.listPayments(5)).toEqual([]);
  expect(db.prepare("SELECT count(*) AS n FROM zotero_connections").get()?.n).toBe(0);
});
it("types a closed unreadable store before any capability can be returned", () => {
  const db = new DatabaseSync(":memory:"); db.close(); unavailable(() => createSqliteZotero(db));
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
