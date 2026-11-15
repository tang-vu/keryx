// Load the real authority graph during collection, before bounded native fixture work.
// This creates no facade/DB/proof; fixtures still reset modules and enroll actual SQLite.
import "../db/application-storage";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import type { KeryxDB } from "../db/keryx-db";
import type { StorageDeploymentManifest } from "../db/runtime-storage-config";
import type { StorageIdentity } from "../db/storage-identity";
import type { HostedTreasuryPolicy } from "./hosted-treasury-policy";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.doUnmock("viem/accounts"); vi.doUnmock("../a2a/private-worker"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const publicKey = `0x${"11".repeat(32)}` as const, privateKey = `0x${"22".repeat(32)}` as const;
async function fixture() {
  vi.resetModules();
  for (const [name, value] of Object.entries({ KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
    BASE_URL: "https://hosted-storage-fixture.invalid", CONTENT_MASTER_KEY: "aa".repeat(32), NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
    KERYX_RUN_PRIVACY_ENABLED: "false", KERYX_RUN_CLAIMS_ENABLED: "false", KERYX_PUBLIC_PROFILES_ENABLED: "false",
    KERYX_REGISTRY_ADDRESS: `0x${"55".repeat(20)}`, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: `0x${"55".repeat(20)}` })) vi.stubEnv(name, value);
  const folder = mkdtempSync(join(tmpdir(), "keryx-hosted-storage-"));
  cleanup.push(() => { if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !basename(folder).startsWith("keryx-hosted-storage-")) throw new Error("Unsafe hosted fixture cleanup"); rmSync(folder, { recursive: true, force: true }); });
  const file = join(folder, "source.sqlite"), manifest = join(folder, "storage.json");
  const { ARC_MAINNET_PROFILE: profile } = await import("../arc-network-profile");
  const storage = await import("../db/storage-identity");
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: profile.networkId,
    profileDigest: storage.STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
    enrolledAt: new Date().toISOString(), provenanceDigest: "aa".repeat(32) };
  await (await import("../db/storage-identity-provision")).createSqliteStorage(file, identity);
  const deployment: StorageDeploymentManifest = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } };
  writeFileSync(manifest, canonicalJson(deployment)); vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  const actualAccounts = await import("viem/accounts"), signer = actualAccounts.privateKeyToAddress(publicKey).toLowerCase();
  const native = new DatabaseSync(file); cleanup.push(() => native.close());
  const signed = vi.fn();
  // Actual enrolled SQLite is the authority. This recording account only checks
  // order around the existing public test key; no key/account can mint provenance.
  vi.doMock("viem/accounts", () => ({ ...actualAccounts, privateKeyToAccount: (key: `0x${string}`) => {
    const account = actualAccounts.privateKeyToAccount(key);
    return { ...account, signTypedData: async (payload: Parameters<typeof account.signTypedData>[0]) => {
      const nonce = String(payload.message?.nonce).toLowerCase();
      expect(native.prepare("SELECT submitted FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)).toEqual({ submitted: 0 });
      signed(payload); return account.signTypedData(payload);
    } };
  } }));
  const db = await (await import("../db/index")).getDb(); cleanup.push(() => (db as unknown as { close(): void }).close());
  const policyModule = await import("./hosted-treasury-policy");
  const policy: HostedTreasuryPolicy = { format: "keryx-hosted-treasury-policy-v1", network: profile.networkId, origin: "https://hosted-storage-fixture.invalid",
    storageIdentityDigest: storage.storageIdentityDigest(identity), signer, queryCapMicroUsdc: "10000", lifetimeCapMicroUsdc: "20000", expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 };
  function configure(value: HostedTreasuryPolicy, role: "public" | "private" = "public") {
    const prefix = role === "private" ? "KERYX_MAINNET_PRIVATE_TREASURY" : "KERYX_MAINNET_TREASURY";
    vi.stubEnv(`${prefix}_POLICY_JSON`, canonicalJson(value)); vi.stubEnv(`${prefix}_POLICY_DIGEST`, policyModule.hostedTreasuryPolicyDigest(value));
  }
  configure(policy); vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY", publicKey);
  const feeModule = await import("./operating-fee-policy"), feePolicy = { format: "keryx-operating-fee-policy-v1" as const, network: profile.networkId,
    origin: policy.origin, storageIdentityDigest: policy.storageIdentityDigest, beneficiary: `0x${"33".repeat(20)}`, expiresAtSeconds: policy.expiresAtSeconds };
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", canonicalJson(feePolicy)); vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", feeModule.operatingFeePolicyDigest(feePolicy));
  const fee = { policyDigest: feeModule.operatingFeePolicyDigest(feePolicy), allocationDigest: "bb".repeat(32), amountMicroUsdc: "1000", sourceUrls: ["https://public-reference.invalid/article"] };
  let rpcCount = 0, paidCalls = 0;
  const state: { finalRpc?: () => void; afterPaid?: () => void; loseAck?: boolean } = {};
  const http = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/v1/balances")) return Response.json({ token: "USDC", balances: [{ depositor: JSON.parse(String(init?.body)).sources[0].depositor, domain: 26, balance: "1" }] });
    if (target === profile.rpcUrl || target === profile.rpcUrl + "/") {
      const request = JSON.parse(String(init?.body)); expect(request.method).toBe("eth_chainId");
      if (++rpcCount === 2) state.finalRpc?.();
      return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x13b2" });
    }
    if (target.startsWith(policy.origin + "/api/research/operating-fee?")) {
      const header = (init?.headers as Record<string, string> | undefined)?.["Payment-Signature"];
      if (!header) return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{
        scheme: "exact", network: profile.networkId, asset: profile.usdcAddress, amount: "1000", payTo: feePolicy.beneficiary,
        maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } }] })).toString("base64") } });
      const payload = JSON.parse(Buffer.from(header, "base64").toString()); paidCalls++;
      expect(native.prepare("SELECT submitted FROM hosted_treasury_authorizations WHERE nonce=?").get(payload.payload.authorization.nonce)).toEqual({ submitted: 1 });
      state.afterPaid?.(); if (state.loseAck) throw new Error("Synthetic lost response");
      return Response.json({ ok: true }, { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: "synthetic-receipt", payer: signer, network: profile.networkId })).toString("base64") } });
    }
    throw new Error("No real network is permitted in this fixture");
  });
  vi.stubGlobal("fetch", http);
  const gatewayModule = await import("./mainnet-hosted-gateway"), app = await import("../db/application-storage"), config = (await import("../config")).config;
  return { db, file, manifest, deployment, identity, policy, configure, gatewayModule, app, native, signed, fee, state, http, actualAccounts,
    config, counts: () => ({ rpcCount, paidCalls }) };
}

it("uses actual enrolled SQLite policy admission and retains settled receipts after policy expiry", async () => {
  const f = await fixture(), gateway = await f.gatewayModule.createMainnetHostedGateway(f.db);
  expect(await f.gatewayModule.mainnetHostedPolicy(f.db)).toEqual(f.policy);
  await gateway.ensureFunded(0.01);
  expect(await gateway.operatingFeePolicy()).toMatchObject({ storageIdentityDigest: f.policy.storageIdentityDigest });
  f.state.afterPaid = () => f.configure({ ...f.policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
  const payment = await gateway.payOperatingFee({ queryId: randomUUID(), operatingFee: f.fee });
  expect(payment).toMatchObject({ settled: true, txHash: "synthetic-receipt" }); expect(f.signed).toHaveBeenCalledOnce();
  expect(f.native.prepare("SELECT settlement_status FROM payment_events").get()?.settlement_status).toBe("settled");
  expect(f.counts()).toEqual({ rpcCount: 2, paidCalls: 1 });
});
it.each(["expiry", "key", "baseURL", "selection", "closed"])("refuses %s changing during the LAST RPC after reservation, without key use or paid HTTP", async reason => {
  const f = await fixture(), gateway = await f.gatewayModule.createMainnetHostedGateway(f.db); await gateway.ensureFunded(0.01);
  f.state.finalRpc = () => {
    if (reason === "expiry") f.configure({ ...f.policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
    if (reason === "key") vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY", privateKey);
    if (reason === "baseURL") Object.assign(f.config, { baseUrl: "https://changed-fixture.invalid" });
    if (reason === "selection") writeFileSync(f.manifest, canonicalJson({ ...f.deployment, identity: { ...f.identity, provenanceDigest: "bb".repeat(32) } }));
    if (reason === "closed") (f.db as unknown as { close(): void }).close();
  };
  await expect(gateway.payOperatingFee({ queryId: randomUUID(), operatingFee: f.fee })).rejects.toThrow("local signing policy");
  expect(f.native.prepare("SELECT count(*) AS n FROM hosted_treasury_authorizations").get()?.n).toBe(1);
  expect(f.signed).not.toHaveBeenCalled(); expect(f.counts()).toEqual({ rpcCount: 2, paidCalls: 0 });
});
it("captures fee inputs before awaiting identity and never retries unknown paid responses", async () => {
  const f = await fixture(), gateway = await f.gatewayModule.createMainnetHostedGateway(f.db); await gateway.ensureFunded(0.01);
  const original = f.app.applicationStorageIdentity; let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  vi.spyOn(f.app, "applicationStorageIdentity").mockImplementationOnce(async (db, access) => { await gate; return original(db, access); });
  const args = { queryId: randomUUID(), operatingFee: { ...f.fee, sourceUrls: [...f.fee.sourceUrls] } }, originalQuery = args.queryId;
  f.state.loseAck = true;
  const pending = gateway.payOperatingFee(args); args.queryId = randomUUID(); args.operatingFee.sourceUrls[0] = "https://mutated.invalid/"; release();
  await expect(pending).rejects.toThrow("pending");
  const row = f.native.prepare("SELECT query_id,original FROM hosted_treasury_authorizations").get()!;
  expect(row.query_id).toBe(originalQuery); expect(JSON.parse(String(row.original)).context.operatingFee.sourceUrls).toEqual(f.fee.sourceUrls);
  expect(f.counts().paidCalls).toBe(1); expect(f.native.prepare("SELECT settlement_status FROM payment_events").get()?.settlement_status).toBe("pending");
});
it("rejects changed policy during genuine identity await before admitting a policy or exposing a key", async () => {
  const f = await fixture(), original = f.app.applicationStorageIdentity;
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  vi.spyOn(f.app, "applicationStorageIdentity").mockImplementationOnce(async (db, access) => { await gate; return original(db, access); });
  const pending = f.gatewayModule.createMainnetHostedGateway(f.db);
  f.configure({ ...f.policy, expiresAtSeconds: f.policy.expiresAtSeconds + 1 }); release();
  await expect(pending).rejects.toThrow(); expect(f.native.prepare("SELECT count(*) AS n FROM hosted_treasury_policies").get()?.n).toBe(0);
  expect(f.signed).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled();
});
it.each(["postgres", "supabase"] as const)("keeps selected %s hosted provenance closed for forged/Core/proxy facades before getters", async kind => {
  const f = await fixture();
  const backend: StorageDeploymentManifest["backend"] = kind === "supabase" ? { kind, url: "https://supabase-fixture.invalid" } : {
    kind, database: "hosted_fixture", sourceDigest: "ab".repeat(32), endpoint: { kind: "loopback", port: 5432 },
    credentialPaths: { application: join(resolve(f.manifest, ".."), "app.json"), reader: join(resolve(f.manifest, ".."), "reader.json") } };
  writeFileSync(f.manifest, canonicalJson({ ...f.deployment, backend }));
  if (kind === "supabase") vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", backend.kind === "supabase" ? backend.url : "");
  let getters = 0; const forged = new Proxy({}, { get() { getters++; throw new Error("No caller methods as authority"); } }) as KeryxDB;
  for (const value of [{}, forged, Object.create(f.db)]) await expect(f.gatewayModule.createMainnetHostedGateway(value as KeryxDB)).rejects.toThrow();
  expect(getters).toBe(0); expect(f.signed).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled();
  // Linux inspects the selected deployment before native admission. This fixture
  // deliberately retains its SQLite path, so its changed backend is refused at
  // that earlier boundary; other platforms retain the closed native factory.
  await expect((await import("../db/postgres/runtime-adapter")).createPostgresRuntimeAdapter()).rejects.toThrow(
    process.platform === "linux" ? "Storage deployment configuration unavailable" : "adapter_not_initialized");
});
it("uses explicit private-role accounting on both ensureFunded reads", async () => {
  const f = await fixture(), privateSigner = f.actualAccounts.privateKeyToAddress(privateKey).toLowerCase();
  f.configure({ ...f.policy, signer: privateSigner }, "private"); vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY", privateKey);
  const sqlite = await import("../db/sqlite-adapter"), actual = sqlite.SqliteAdapter.prototype.hostedTreasuryAccounting;
  const reads = vi.spyOn(sqlite.SqliteAdapter.prototype, "hostedTreasuryAccounting").mockImplementation(function(this: import("../db/sqlite-adapter").SqliteAdapter, signer, role) { return actual.call(this, signer, role); });
  const job = { id: randomUUID(), owner: `0x${"44".repeat(20)}`, workerId: "synthetic-worker" };
  const gateway = await f.gatewayModule.createMainnetHostedGateway(f.db, { role: "private", job });
  job.owner = `0x${"66".repeat(20)}`; await gateway.ensureFunded(0.01);
  expect(reads.mock.calls).toEqual([[privateSigner, "private"], [privateSigner, "private"]]);
  expect(f.signed).not.toHaveBeenCalled(); expect(f.counts().paidCalls).toBe(0);
});

it("retains the actual original after an unknown admission acknowledgement without signing or retry", async () => {
  const f = await fixture(), gateway = await f.gatewayModule.createMainnetHostedGateway(f.db); await gateway.ensureFunded(0.01);
  const sqlite = await import("../db/sqlite-adapter"), actual = sqlite.SqliteAdapter.prototype.admitHostedAuthorization;
  const admit = vi.spyOn(sqlite.SqliteAdapter.prototype, "admitHostedAuthorization").mockImplementation(async function(this: import("../db/sqlite-adapter").SqliteAdapter, input) {
    await actual.call(this, input); throw new Error("Synthetic committed admission acknowledgement loss");
  });
  await expect(gateway.payOperatingFee({ queryId: randomUUID(), operatingFee: f.fee })).rejects.toThrow("local signing policy");
  expect(admit).toHaveBeenCalledOnce(); expect(f.signed).not.toHaveBeenCalled(); expect(f.counts().paidCalls).toBe(0);
  expect(f.native.prepare("SELECT submitted FROM hosted_treasury_authorizations").all()).toEqual([{ submitted: 0 }]);
  expect(f.native.prepare("SELECT settlement_status FROM payment_events").all()).toEqual([{ settlement_status: "pending" }]);
});

it("refuses private worker configuration changed during the real hosted gateway constructor await", async () => {
  const f = await fixture(), privateSigner = f.actualAccounts.privateKeyToAddress(privateKey).toLowerCase();
  f.configure({ ...f.policy, signer: privateSigner }, "private"); vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY", privateKey);
  Object.assign(f.config, { sellerAddress: `0x${"bb".repeat(20)}`, privateResearchReservedPayees: `0x${"aa".repeat(20)}` });
  for (const [name, value] of Object.entries({ KERYX_PRIVATE_WORKER_ENABLED: "1", KERYX_PRIVATE_RESEARCH_ENABLED: "1",
    KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: f.config.privateResearchReservedPayees, KERYX_PRIVATE_RESEARCH_PAYEE: f.config.privateResearchReservedPayees,
    KERYX_PRIVATE_TREASURY_ADDRESS: privateSigner, KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "50000", KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
    KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek", KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1",
    KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret", KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]' })) vi.stubEnv(name, value);
  // Record constructor options only. No worker/provider/job executes and this is
  // not evidence of private execution readiness or installed native authority.
  const worker = { tick: vi.fn() }, create = vi.fn((_db: KeryxDB, _options: unknown) => worker);
  vi.doMock("../a2a/private-worker", () => ({ createPrivateWorker: create }));
  const spool = { save: vi.fn(), read: vi.fn(), restore: vi.fn(), entries: vi.fn() };
  const boot = await (await import("../a2a/private-worker-bootstrap")).privateWorkerBootstrap(f.db, spool);
  expect(boot).not.toBeNull();
  const actual = f.gatewayModule.createMainnetHostedGateway;
  let release!: () => void, entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(f.gatewayModule, "createMainnetHostedGateway").mockImplementationOnce(async (db, options) => {
    const gateway = await actual(db, options); entered(); await gate; return gateway;
  });
  const options = create.mock.calls[0][1] as { gatewayFactory(job: { id: string; owner: string; workerId: string }): Promise<unknown> };
  const pending = options.gatewayFactory({ id: randomUUID(), owner: `0x${"44".repeat(20)}`, workerId: "synthetic-worker" });
  await reached; vi.stubEnv("KERYX_PRIVATE_PROVIDER_API_KEY", "changed-during-gateway-construction"); release();
  await expect(pending).rejects.toThrow("Private worker authority changed");
  expect(f.signed).not.toHaveBeenCalled(); expect(worker.tick).not.toHaveBeenCalled(); expect(f.http).not.toHaveBeenCalled();
});
