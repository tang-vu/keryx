import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { canonicalJson } from "../canonical-json";
import { syncStateSnapshot } from "./sync-state-snapshot";
import type { SqliteAdapter } from "./sqlite-adapter";

let folder: string, file: string, manifest: string;
let api: typeof import("./enrolled-sqlite-adapter");
const adapters: SqliteAdapter[] = [];
const keys = ["lastSyncedBlock", "registryParity", "dispatchHealth", "settlementParity", "pendingPaymentReconciliation", "a2aWorker"];

beforeEach(async () => {
  vi.resetModules();
  folder = mkdtempSync(join(tmpdir(), "health-state-enrolled-"));
  file = join(folder, "synthetic.sqlite"); manifest = join(folder, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"),
    format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const native = new DatabaseSync(file);
  try {
    native.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(native);
    insertStorageIdentity(native, identity); installStorageFences(native, identity); native.exec("COMMIT");
  } finally { native.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  api = await import("./enrolled-sqlite-adapter");
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const adapter of adapters.splice(0)) adapter.close();
  rmSync(folder, { recursive: true, force: true }); vi.unstubAllEnvs();
});
async function open(readonly = false) {
  const adapter = await (readonly ? api.createReadonlyEnrolledSqliteAdapter() : api.createEnrolledSqliteAdapter());
  adapters.push(adapter); return adapter;
}

it("reduces six real enrolled state SELECTs to one, preserving identical values and fresh guards", async () => {
  const adapter = await open();
  await adapter.setSyncState(keys[0], "123"); await adapter.setSyncState(keys[5], "idle");
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const scalarStarted = performance.now();
  const scalar = await Promise.all(keys.map(async key => [key, await adapter.getSyncState(key)] as const));
  const scalarMs = performance.now() - scalarStarted;
  const scalarCalls = prepare.mock.calls.map(([sql]) => sql);
  expect(scalarCalls.filter(sql => /^SELECT value FROM sync_state WHERE/.test(sql))).toHaveLength(6);
  prepare.mockClear();
  const batchStarted = performance.now();
  const batch = await adapter.getSyncStates(keys);
  const batchMs = performance.now() - batchStarted;
  const batchCalls = prepare.mock.calls.map(([sql]) => sql);
  expect([...batch]).toEqual(scalar);
  expect(batchCalls.filter(sql => /^SELECT key, value FROM sync_state WHERE/.test(sql))).toHaveLength(1);
  // Native identity/schema guard SQL still executes; only repeated operations disappear.
  expect(batchCalls.some(sql => sql.includes("sqlite_master") || sql.includes("sqlite_schema"))).toBe(true);
  expect(batchCalls.length).toBeLessThan(scalarCalls.length);
  console.info(JSON.stringify({ healthStateControlledMeasurement: { scalarMs, batchMs,
    scalarNativePrepares: scalarCalls.length, batchNativePrepares: batchCalls.length,
    scope: "Synthetic mainnet schema and genuine enrolled facade; not production endpoint latency" } }));
});

it("works through the readonly facade, binds literal keys, and sees later committed changes", async () => {
  const writer = await open(); const reader = await open(true);
  const literal = "x') OR 1=1 --";
  await writer.setSyncState("a2aWorker", "first"); await writer.setSyncState(literal, "literal");
  const before = readFileSync(file);
  const first = await reader.getSyncStates(["a2aWorker", literal, "missing", literal]);
  expect([...first]).toEqual([["a2aWorker", "first"], [literal, "literal"], ["missing", null]]);
  expect(readFileSync(file)).toEqual(before);
  await writer.setSyncState("a2aWorker", "second");
  expect((await reader.getSyncStates(["a2aWorker"])).get("a2aWorker")).toBe("second");
  expect(first.get("a2aWorker")).toBe("first");
  expect([...await reader.getSyncStates([])]).toEqual([]);
  for (const invalid of [Array(33).fill("a"), [""], ["a".repeat(257)]])
    await expect(reader.getSyncStates(invalid)).rejects.toThrow("Invalid sync-state keys");
});

it("refuses changed deployment on the next request instead of reusing a prior successful snapshot", async () => {
  const reader = await open(true);
  expect(await syncStateSnapshot(reader, keys)("a2aWorker")).toBeNull();
  writeFileSync(manifest, "{}");
  await expect(syncStateSnapshot(reader, keys)("a2aWorker")).rejects.toThrow();
});

it("refuses application schema drift and closes the facade rather than falling back around guards", async () => {
  const reader = await open(true);
  await reader.getSyncStates(keys);
  const native = new DatabaseSync(file);
  try { native.exec("CREATE TABLE unexpected_health_drift(value TEXT)"); } finally { native.close(); }
  await expect(syncStateSnapshot(reader, keys)("a2aWorker")).rejects.toThrow();
  await expect(async () => reader.getSyncState("a2aWorker")).rejects.toThrow();
});
