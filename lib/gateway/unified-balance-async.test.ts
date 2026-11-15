/** Genuine synthetic selected-SQLite observations. No native positive/funding
 * authority, custody keys, actual vendor HTTP or transferred funds. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
const state = vi.hoisted(() => ({ balance: vi.fn(), kit: vi.fn() }));
vi.mock("./gateway-balance", () => ({ getGatewayAvailableAtomic: state.balance }));
vi.mock("@circle-fin/unified-balance-kit", () => ({ getBalances: state.kit, createUnifiedBalanceKitContext: state.kit }));
const folders: string[] = [], readers: KeryxDB[] = [];
function isolatedEnvironment() {
  for (const [key, value] of Object.entries({ KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
    BASE_URL: "https://keryx.cc", CONTENT_MASTER_KEY: "ab".repeat(32), KERYX_STORAGE_MANIFEST: "", KERYX_SQLITE_PATH: "",
    KERYX_REGISTRY_ADDRESS: "0x" + "55".repeat(20), NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: "0x" + "55".repeat(20),
    KERYX_REGISTRY_READ_ADDRESS: "0x" + "55".repeat(20), NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: "0x" + "55".repeat(20),
    KERYX_MAINNET_TREASURY_PRIVATE_KEY: "", KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY: "", AGENT_FUNDER_PRIVATE_KEY: "",
    KERYX_PRIVATE_TREASURY_PRIVATE_KEY: "", KERYX_REGISTRATION_SPONSOR_PRIVATE_KEY: "", DEPLOYER_PRIVATE_KEY: "", REGISTRY_OPERATOR_KEY: "",
    KERYX_REGISTRY_ORIGINS: "", NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS: "",
    BUYER_PRIVATE_KEY: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No external HTTP"); }));
}
beforeAll(async () => {
  // Transform the genuine Source graph separately from each bounded fixture.
  // No facade, selected identity, observation or funding authority is created.
  isolatedEnvironment();
  await import("../db/application-storage"); await import("../db/storage-identity-provision"); await import("../db/sqlite-adapter");
}, 20000);
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); state.balance.mockResolvedValue(BigInt(5000000)); isolatedEnvironment();
});
afterEach(async () => {
  const app = await import("../db/application-storage");
  for (const reader of readers.splice(0)) try { await app.closeReadonlyApplicationStorage(reader); } catch { /* Already disposed by observation. */ }
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    for (const file of readdirSync(folder)) unlinkSync(join(folder, file)); rmdirSync(folder);
  }
  expect(fetch).not.toHaveBeenCalled(); expect(state.kit).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function fixture(kind: "sqlite" | "supabase" | "postgres" = "sqlite") {
  const { canonicalJson } = await import("../canonical-json");
  const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
  const { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest } = await import("../db/storage-identity");
  const identity = { format: "keryx-mainnet-storage-identity-v1" as const, authorityMode: "mainnet-real" as const,
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(),
    storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  const folder = mkdtempSync(join(tmpdir(), "keryx-unified-balance-async-")); folders.push(folder);
  const file = join(folder, "source.sqlite"), manifestPath = join(folder, "storage.json");
  if (kind === "sqlite") await (await import("../db/storage-identity-provision")).createSqliteStorage(file, identity);
  const backend = kind === "sqlite" ? { kind, databasePath: file } : kind === "supabase" ? { kind, url: "https://synthetic.invalid" }
    : { kind, database: "synthetic_closed", sourceDigest: "ab".repeat(32), endpoint: { kind: "loopback", port: 5432 },
      credentialPaths: { application: join(folder, "writer.json"), reader: join(folder, "reader.json") } };
  if (kind === "supabase") {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-network");
  }
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); if (kind === "sqlite") vi.stubEnv("KERYX_SQLITE_PATH", file);
  const policy = { format: "keryx-hosted-treasury-policy-v1" as const, network: ARC_MAINNET_PROFILE.networkId,
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://keryx.cc", signer: "0x" + "33".repeat(20),
    lifetimeCapMicroUsdc: "5000000", queryCapMicroUsdc: "500000", expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 };
  const { hostedTreasuryPolicyDigest } = await import("../payments/hosted-treasury-policy");
  const configure = (next: typeof policy) => {
    vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", canonicalJson(next));
    vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST", hostedTreasuryPolicyDigest(next));
  }; configure(policy);
  const app = await import("../db/application-storage");
  const create = app.createReadonlyApplicationStorage;
  vi.spyOn(app, "createReadonlyApplicationStorage").mockImplementation(async () => {
    const reader = await create(); if (reader) readers.push(reader); return reader;
  });
  return { app, policy, configure, manifestPath, observe: (await import("./unified-balance")).getMainnetTreasuryObservation };
}
it("awaits genuine enrolled SQLite read provenance, explicit public role and canonical disposal", async () => {
  const f = await fixture(), identity = vi.spyOn(f.app, "applicationStorageIdentity"), close = vi.spyOn(f.app, "closeReadonlyApplicationStorage");
  expect(await f.observe()).toMatchObject({ availableUsdc: "5", address: f.policy.signer,
    storageIdentityDigest: f.policy.storageIdentityDigest, paymentReadiness: "not-probed" });
  expect(identity).toHaveBeenCalledTimes(4); expect(identity).toHaveBeenCalledWith(readers[0], "read");
  expect(close).toHaveBeenCalledExactlyOnceWith(readers[0]);
  await expect(f.app.applicationStorageIdentity(readers[0], "read")).rejects.toThrow();
  expect(state.balance).toHaveBeenCalledWith(f.policy.signer, (await import("../arc-network-profile")).ARC_MAINNET_PROFILE);
}, 20000);
it("waits for an outstanding genuine identity observation before vendor access", async () => {
  const f = await fixture(), original = f.app.applicationStorageIdentity;
  let release!: () => void, reached!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(f.app, "applicationStorageIdentity").mockImplementationOnce(async (db, access) => {
    const identity = await original(db, access); reached(); await gate; return identity;
  });
  const pending = f.observe(); await entered; expect(state.balance).not.toHaveBeenCalled();
  release(); expect((await pending).availableUsdc).toBe("5");
});
it.each(["expiry", "policy", "profile", "origin", "selection"])("refuses %s changed during final role await", async reason => {
  const f = await fixture(), { SqliteAdapter } = await import("../db/sqlite-adapter");
  const original = SqliteAdapter.prototype.hostedTreasuryAccounting; let calls = 0;
  vi.spyOn(SqliteAdapter.prototype, "hostedTreasuryAccounting").mockImplementation(async function (this: import("../db/sqlite-adapter").SqliteAdapter, signer, role) {
    const result = await original.call(this, signer, role);
    if (++calls === 2) {
      if (reason === "expiry") f.configure({ ...f.policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
      if (reason === "policy") f.configure({ ...f.policy, queryCapMicroUsdc: "1000" });
      if (reason === "profile") Object.assign((await import("../config")).config, { profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE });
      if (reason === "origin") Object.assign((await import("../config")).config, { baseUrl: "https://changed.invalid" });
      if (reason === "selection") writeFileSync(f.manifestPath, "{}");
    } return result;
  });
  await expect(f.observe()).rejects.toThrow(); expect(calls).toBe(2); expect(state.balance).toHaveBeenCalledOnce();
});
it("checks authority again when the final provenance await changes protected policy", async () => {
  const f = await fixture(), original = f.app.applicationStorageIdentity; let calls = 0;
  vi.spyOn(f.app, "applicationStorageIdentity").mockImplementation(async (db, access) => {
    const identity = await original(db, access);
    if (++calls === 4) f.configure({ ...f.policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
    return identity;
  }); await expect(f.observe()).rejects.toThrow(); expect(calls).toBe(4);
});
it("awaits canonical close and propagates disposal failure instead of probing db.close", async () => {
  const f = await fixture(), original = f.app.closeReadonlyApplicationStorage;
  let release!: () => void, entered!: () => void, published = false;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(f.app, "closeReadonlyApplicationStorage").mockImplementationOnce(async db => { entered(); await gate; await original(db); });
  const pending = f.observe().then(value => { published = true; return value; }); await reached;
  expect(published).toBe(false); release(); await pending;
  vi.spyOn(f.app, "closeReadonlyApplicationStorage").mockImplementationOnce(async db => { await original(db); throw Error("synthetic disposal refusal"); });
  await expect(f.observe()).rejects.toThrow("synthetic disposal refusal");
});
it.each(["forged", "proxy", "closed"])("refuses a %s facade before vendor access and still invokes canonical disposal", async reason => {
  const f = await fixture(); const genuine = await f.app.createReadonlyApplicationStorage(); expect(genuine).toBeDefined();
  if (reason === "closed") await f.app.closeReadonlyApplicationStorage(genuine!);
  const candidate = reason === "proxy" ? new Proxy(genuine!, {}) : reason === "closed" ? genuine! : {} as KeryxDB;
  vi.mocked(f.app.createReadonlyApplicationStorage).mockResolvedValueOnce(candidate);
  const close = vi.spyOn(f.app, "closeReadonlyApplicationStorage");
  await expect(f.observe()).rejects.toThrow(); expect(state.balance).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledWith(candidate);
});
it("rejects the Supabase selection without creating a reader or observing Circle", async () => {
  const f = await fixture("supabase"); await expect(f.observe()).rejects.toThrow("backend refused");
  expect(f.app.createReadonlyApplicationStorage).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled();
});
it("keeps the genuine native writer unconditionally closed without RPC fallback", async () => {
  const f = await fixture("postgres");
  await expect(f.app.createApplicationStorage()).rejects.toMatchObject({ reason: "adapter_not_initialized" });
  expect(state.balance).not.toHaveBeenCalled();
});
