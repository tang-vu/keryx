import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import { STORAGE_TESTNET_PROFILE_DIGEST } from "./storage-identity";
const calls = vi.hoisted(() => ({ construct: vi.fn(), init: vi.fn(), close: vi.fn(), data: vi.fn(), grant: vi.fn(), offline: vi.fn(), signer: vi.fn() }));
vi.mock("./sqlite-adapter", () => ({ SqliteAdapter: class {
  private identity;
  getStorageIdentity() { return this.identity; }
  init = calls.init; listPayments = calls.data;
  close = calls.close;
  constructor(...args: unknown[]) { this.identity = (args[1] as { expectedIdentity: unknown }).expectedIdentity; calls.construct(...args); }
} }));
vi.mock("./supabase-adapter", () => ({ SupabaseAdapter: class { constructor() { throw new Error("Unexpected backend switch"); } } }));
vi.mock("../payments/session-grants", () => ({ getGrant: calls.grant }));
vi.mock("../payments/offline-gateway", () => ({ OfflineGateway: class { constructor() { calls.offline(); } } }));
vi.mock("../payments/browser-cosign-gateway", () => ({ BrowserCoSignGateway: class { constructor() { calls.signer(); } } }));
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of directories.splice(0)) rmSync(path, { force: true, recursive: true }); });
it.each(["mode", "store", "backend"])("refuses live %s replacement before cached DB/gateway/cache authority", async change => {
  vi.resetModules(); vi.resetAllMocks(); calls.init.mockResolvedValue(undefined);
  const folder = mkdtempSync(join(tmpdir(), "keryx-runtime-lifecycle-")); directories.push(folder);
  const store = join(folder, "store.sqlite"), other = join(folder, "other.sqlite"), manifest = join(folder, "manifest.json");
  writeFileSync(store, "synthetic-placeholder"); writeFileSync(other, "synthetic-placeholder");
  const identity = { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
    storageId: "22222222-2222-4222-8222-222222222222", enrollmentId: "33333333-3333-4333-8333-333333333333",
    network: "eip155:5042002", authorityMode: "testnet-real", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
    provenanceDigest: "aa".repeat(32), enrolledAt: "2026-10-01T00:00:00.000Z" };
  const original = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: store } };
  writeFileSync(manifest, canonicalJson(original));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("KERYX_SQLITE_PATH", store);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic");
  const { getDb } = await import("./index"); const db = await getDb();
  expect(calls.construct).toHaveBeenCalledWith(store, { expectedIdentity: identity });
  const replacement = { ...original,
    ...(change === "mode" ? { identity: { ...identity, authorityMode: "testnet-offline" } } : {}),
    ...(change === "store" ? { backend: { kind: "sqlite", databasePath: other } } : {}),
    ...(change === "backend" ? { backend: { kind: "supabase", url: "https://synthetic.supabase.co" } } : {}) };
  writeFileSync(manifest, canonicalJson(replacement)); if (change === "store") vi.stubEnv("KERYX_SQLITE_PATH", other);
  await expect((async () => (await getDb()).listPayments(1))()).rejects.toThrow("Storage deployment configuration unavailable");
  const { getPaymentGateway } = await import("../payments/payment-gateway");
  await expect(getPaymentGateway(db, { sessionId: "original-owner", requestSignature: vi.fn() })).rejects.toThrow("Storage deployment configuration unavailable");
  const { sealCacheText } = await import("../sources/content-cache");
  expect(() => sealCacheText("retained-private-output")).toThrow("Storage deployment configuration unavailable");
  expect(calls.construct).toHaveBeenCalledTimes(1); expect(calls.init).toHaveBeenCalledTimes(1);
  for (const call of [calls.data, calls.grant, calls.offline, calls.signer]) expect(call).not.toHaveBeenCalled();
});
it("refuses a manifest replacement during deferred initialization and cleans the unreturned adapter", async () => {
  vi.resetModules(); vi.resetAllMocks();
  const folder = mkdtempSync(join(tmpdir(), "keryx-runtime-lifecycle-")); directories.push(folder);
  const store = join(folder, "store.sqlite"), manifest = join(folder, "manifest.json"); writeFileSync(store, "synthetic-placeholder");
  const { syntheticStorageIdentity } = await import("./storage-identity-fixture");
  const identity = syntheticStorageIdentity("testnet-real");
  const original = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: store } };
  writeFileSync(manifest, canonicalJson(original));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", store); vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  let begin!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  calls.init.mockImplementationOnce(() => { begin(); return gate; });
  const { getDb } = await import("./index");
  const pending = getDb(); await started;
  writeFileSync(manifest, canonicalJson({ ...original, identity: { ...identity, authorityMode: "testnet-offline" } }));
  const refusal = expect(pending).rejects.toThrow("Storage deployment configuration unavailable"); finish(); await refusal;
  expect(calls.close).toHaveBeenCalledOnce(); expect(calls.data).not.toHaveBeenCalled();
  await expect(getDb()).rejects.toThrow("Storage deployment configuration unavailable");
  expect(calls.construct).toHaveBeenCalledOnce();
});
