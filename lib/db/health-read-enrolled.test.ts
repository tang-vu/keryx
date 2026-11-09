import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "./storage-identity";
import { publicHealthSyncKeys } from "./public-health-snapshot";
import type { SqliteAdapter } from "./sqlite-adapter";
import type { KeryxDB } from "./keryx-db";

let folder: string, file: string, manifest: string;
let api: typeof import("./enrolled-sqlite-adapter");
const opened: SqliteAdapter[] = [];
const now = Date.parse("2026-11-10T00:00:00.000Z");
const combinedSql = (sql: string) => sql.startsWith("SELECT 0 AS metric_group") && sql.includes("UNION ALL SELECT 4,status");
const network = vi.fn(async () => { throw new Error("Synthetic health guard tests deny network"); });
beforeEach(async () => {
  vi.resetModules(); network.mockClear(); vi.stubGlobal("fetch", network);
  folder = mkdtempSync(join(tmpdir(), "health-read-enrolled-")); file = join(folder, "synthetic.sqlite"); manifest = join(folder, "deployment.json");
  const identity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
    authorityMode: "mainnet-real" as const, network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const native = new DatabaseSync(file);
  try {
    native.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(native);
    insertStorageIdentity(native, identity); installStorageFences(native, identity); native.exec("COMMIT");
  } finally { native.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  api = await import("./enrolled-sqlite-adapter");
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); vi.restoreAllMocks();
  for (const adapter of opened.splice(0)) adapter.close();
  rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function open(readonly = true): Promise<KeryxDB> {
  const adapter = await (readonly ? api.createReadonlyEnrolledSqliteAdapter() : api.createEnrolledSqliteAdapter());
  opened.push(adapter); return adapter;
}
function read(reader: KeryxDB, registry = true) {
  expect(typeof reader.readPublicHealthSnapshot).toBe("function");
  return reader.readPublicHealthSnapshot!(now, registry);
}
function edit(action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(file); try { action(db); } finally { db.close(); }
}

it("combines actual enrolled reads with equal outputs, fewer native prepares and unchanged database bytes", async () => {
  const reader = await open(), before = readFileSync(file);
  const spy = vi.spyOn(DatabaseSync.prototype, "prepare");
  const expected = { metrics: await reader.metrics(), jobs: await reader.a2aOperationsSnapshot(now), syncState: await reader.getSyncStates!(publicHealthSyncKeys(true)) };
  const legacy = spy.mock.calls.map(([sql]) => sql); spy.mockClear();
  expect(await read(reader)).toEqual(expected);
  const merged = spy.mock.calls.map(([sql]) => sql);
  expect(merged.filter(combinedSql)).toHaveLength(1);
  expect(merged.filter(sql => sql.startsWith("SELECT status,created_at,updated_at,started_at,execution_journal_version"))).toHaveLength(0);
  expect(merged.filter(sql => sql.startsWith("SELECT key, value FROM sync_state WHERE"))).toHaveLength(0);
  expect(merged.filter(sql => sql.includes("sqlite_schema") || sql.includes("sqlite_master")).length).toBeGreaterThan(0);
  expect(merged.length).toBeLessThan(legacy.length);
  expect(api.ENROLLED_SQLITE_METHOD_ACCESS.readPublicHealthSnapshot).toBe("read");
  expect(Object.keys(reader).sort()).toEqual(Object.keys(api.ENROLLED_SQLITE_METHOD_ACCESS).sort());
  expect(Object.isFrozen(reader)).toBe(true); expect(readFileSync(file)).toEqual(before);
});

it("refreshes committed values through readonly and writable facades, preserving registry selection", async () => {
  const writer = await open(false), reader = await open();
  await writer.setSyncState("a2aWorker", "first"); await writer.setSyncState("lastSyncedBlock", "123");
  const first = await read(reader); expect(first?.syncState.get("a2aWorker")).toBe("first");
  await writer.setSyncState("a2aWorker", "second");
  expect((await read(reader))?.syncState.get("a2aWorker")).toBe("second");
  expect(first?.syncState.get("a2aWorker")).toBe("first");
  expect([...(await read(writer, false))!.syncState.keys()]).toEqual(publicHealthSyncKeys(false));
  expect((await read(reader, false))?.syncState.has("lastSyncedBlock")).toBe(false);
});

it("refuses arbitrary arguments instead of exposing a generic native batch or callback", async () => {
  const reader = await open();
  for (const args of [[now], [now, "true"], [NaN, true], [Infinity, true], [0.5, true], [Number.MAX_SAFE_INTEGER, true], [now, true, () => 1]]) {
    expect(() => Reflect.apply(reader.readPublicHealthSnapshot!, reader, args)).toThrow("Invalid public-health read inputs");
  }
  expect(await read(reader)).toBeDefined();
});

it("never reuses admission after manifest replacement, including restoration of old bytes", async () => {
  const reader = await open(), original = readFileSync(manifest); await read(reader);
  writeFileSync(manifest, "{}"); await expect(async () => read(reader)).rejects.toThrow();
  writeFileSync(manifest, original);
  await expect(async () => read(reader)).rejects.toThrow(); await expect(async () => reader.metrics()).rejects.toThrow();
});

it.each(["schema", "fence"])("refuses fresh%s drift and retires the genuine facade", async kind => {
  const reader = await open(); await read(reader);
  edit(db => {
    if (kind === "schema") db.exec("CREATE TABLE unexpected_health_read(value TEXT)");
    else {
      const row = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_fence_%' LIMIT 1").get()!;
      db.exec('DROP TRIGGER "' + String(row.name).replaceAll('"', '""') + '"');
    }
  });
  await expect(async () => read(reader)).rejects.toThrow(); await expect(async () => reader.getSyncState("a2aWorker")).rejects.toThrow();
});

it("keeps the native statement guard after preparation instead of trusting a prior successful check", async () => {
  const reader = await open(), original = DatabaseSync.prototype.prepare; let reached = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
    if (combinedSql(sql)) { reached = true; writeFileSync(manifest, "{}"); }
    return original.call(this, sql);
  });
  await expect(async () => read(reader)).rejects.toThrow(); expect(reached).toBe(true);
});

it("checks admission after the awaited read before exposing its result", async () => {
  const reader = await open(); const pending = read(reader);
  writeFileSync(manifest, "{}");
  await expect(pending).rejects.toThrow(); await expect(async () => reader.metrics()).rejects.toThrow();
});

it("permits legacy data fallback only when full current admission still succeeds", async () => {
  const reader = await open(), original = DatabaseSync.prototype.prepare; let reached = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
    if (combinedSql(sql)) { reached = true; throw new Error("Synthetic composition unavailable"); }
    return original.call(this, sql);
  });
  expect(await read(reader)).toBeUndefined(); expect(reached).toBe(true);
  expect((await reader.metrics()).totalQueries).toBe(0); expect((await reader.a2aOperationsSnapshot(now)).degraded).toBe(false);
  expect([...await reader.getSyncStates!(publicHealthSyncKeys(true))]).toEqual(publicHealthSyncKeys(true).map(key => [key, null]));
});

it("does not turn a data error plus revoked admission into unavailable composition", async () => {
  const reader = await open(), original = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
    if (combinedSql(sql)) { writeFileSync(manifest, "{}"); throw new Error("Synthetic data read refused"); }
    return original.call(this, sql);
  });
  await expect(async () => read(reader)).rejects.toThrow(); await expect(async () => reader.metrics()).rejects.toThrow();
});

it("keeps optional account-index errors independent from the valid health read", async () => {
  const reader = await open(), original = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql.startsWith("SELECT COUNT(DISTINCT LOWER(wallet_address))")) throw new Error("Synthetic account index unavailable");
    return original.call(this, sql);
  });
  const snapshot = await read(reader); expect(snapshot).toBeDefined();
  expect(snapshot!.metrics.recordedAccounts).toBeNull(); expect(snapshot!.metrics).toEqual(await reader.metrics());
});
