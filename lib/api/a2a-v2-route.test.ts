import { NextRequest } from "next/server";
import { beforeEach, afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "../db/storage-identity";
import { installMainnetApplicationSchema } from "../db/mainnet-application-schema";
import { installNativeUserDomainSchema } from "../db/native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "../db/storage-identity-sqlite";
import { createEnrolledSqliteAdapter } from "../db/enrolled-sqlite-adapter";
import { canonicalJson } from "../canonical-json";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { a2aOrderId } from "../a2a/order";

const mocks = vi.hoisted(() => ({
  collectRun: vi.fn(),
  getAgentDeps: vi.fn(),
  getDb: vi.fn(),
  settleThenServe: vi.fn(),
  checkRateLimit: vi.fn(),
  cookies: vi.fn(), vendorVerify: vi.fn(), vendorSettle: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class { verify = mocks.vendorVerify; settle = mocks.vendorSettle; } }));

vi.mock("@/lib/config", async () => ({
  config: {
    profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
    sellerAddress: "0x2222222222222222222222222222222222222222",
    networkId: "eip155:5042002",
    a2aFeeUsdc: 0.02,
    a2aDeepFeeUsdc: 0.05,
    a2aMaxBudget: 0.5,
    defaultBudget: 0.05,
    botKey: "",
    funderKey: "0xtest-private-key",
  },
}));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collectRun, getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/run-privacy/auth", () => ({requestPrivacyActor:async()=>undefined}));
vi.mock("@/lib/payments/mainnet-hosted-gateway", () => ({ assertMainnetHostedResearchReady: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/x402-discovery", () => ({ a2aDiscovery: {} }));
vi.mock("@/lib/x402-server", () => ({
  challengeResponse: vi.fn(),
  settleThenServe: mocks.settleThenServe,
}));

import { GET, POST } from "@/app/api/agent/ask/route";
import { config } from "@/lib/config";
import { verifyApiKey } from "@/lib/api-keys";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { a2aResearchPackage } from "../a2a/research-package";

function request(body: unknown, signed = false) {
  return new NextRequest("http://localhost/api/agent/ask", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signed ? { "payment-signature": "signed" } : {}) },
    body: JSON.stringify(body),
  });
}

const run = {
  id: "filled-by-test",
  question: "q",
  budget: 0.05,
  answer: "answer",
  subClaims: ["claim"],
  decisions: [],
  citations: [],
  evidence: [],
  claimCoverage: [{ claimIndex: 0, claim: "claim", coverage: 0, coveredBy: [] }],
  totalSpent: 0.031,
  totalToCreators: 0.031,
  trace: [],
  createdAt: "2026-09-02T00:01:00.000Z",
  durationMs: 60_000,
  engine: "heuristic",
  paymentMode: "real",
};

/** UNRUN F1/F2 actual POST + real seller helper + genuine native original producer.
 * Only vendor transport/readiness and framework request selection are synthetic.
 * No settlement/session/owner proof or native facade is mocked. */
describe("authenticated NEW original through actual signed POST", () => {
  const cookies = new AsyncLocalStorage<string | undefined>();
  const owner = `0x${"a".repeat(40)}`, foreign = `0x${"d".repeat(40)}`;
  const payer = privateKeyToAccount(`0x${"3".repeat(64)}`), secret = "unfunded-native-post-test-secret";
  let folder: string, native: Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>;
  let actualSeller: typeof import("../x402-server"), nonceSequence = 0;
  const savedConfig = { ...config };
  beforeAll(async () => { actualSeller = await vi.importActual("../x402-server"); });
  beforeEach(async () => {
    Object.assign(config, { profile: ARC_MAINNET_PROFILE, networkId: ARC_MAINNET_PROFILE.networkId,
      usdcAddress: ARC_MAINNET_PROFILE.usdcAddress, gatewayWallet: ARC_MAINNET_PROFILE.gatewayWallet, maxTimeoutSeconds: 691200, jwtSecret: secret });
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
    folder = mkdtempSync(join(tmpdir(), "keryx-owned-real-post-"));
    const file = join(folder, "synthetic.sqlite"), manifest = join(folder, "deployment.json");
    const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
      network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
    const setup = new DatabaseSync(file);
    try {
      setup.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(setup); installNativeUserDomainSchema(setup);
      insertStorageIdentity(setup, identity); installStorageFences(setup, identity); setup.exec("COMMIT");
    } finally { setup.close(); }
    writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
    vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
    native = await createEnrolledSqliteAdapter();
    mocks.getDb.mockResolvedValue(native); mocks.getAgentDeps.mockResolvedValue({ db: native, gateway: {}, engine: {} });
    mocks.cookies.mockImplementation(async () => ({ get: (name: string) => name === "keryx_session" && cookies.getStore() ? { value: cookies.getStore() } : undefined }));
    mocks.checkRateLimit.mockResolvedValue(null); mocks.collectRun.mockClear();
    vi.mocked(verifyApiKey).mockResolvedValue({ keyId: "synthetic-ownerless-key", scopes: "ask" } as never);
    mocks.settleThenServe.mockImplementation(actualSeller.settleThenServe);
    mocks.vendorVerify.mockReset().mockImplementation(async (payload, requirements) => {
      const authorization = payload.payload.authorization;
      const recovered = await recoverTypedDataAddress({ ...typed(authorization), signature: payload.payload.signature });
      return { isValid: recovered.toLowerCase() === payer.address.toLowerCase() && authorization.to === requirements.payTo
        && authorization.value === requirements.amount, payer: recovered };
    });
    mocks.vendorSettle.mockReset().mockImplementation(async payload => ({ success: true, network: "eip155:5042", payer: payer.address,
      transaction: `unfunded-vendor-fixture-${payload.payload.authorization.nonce}` }));
  });
  afterEach(() => { try { native?.close(); } catch {} if (folder) rmSync(folder, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs();
    for (const key of Object.keys(config)) if (!Object.prototype.hasOwnProperty.call(savedConfig, key)) Reflect.deleteProperty(config, key);
    Object.assign(config, savedConfig); });
  afterAll(() => Object.assign(config, savedConfig));
  function typed(a: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }) {
    return { domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042, verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet as `0x${string}` },
      types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "TransferWithAuthorization",
      message: { from: a.from as `0x${string}`, to: a.to as `0x${string}`, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` } } as const;
  }
  async function signed(mode: "quick" | "deep" = "quick", extra: Record<string, unknown> = {}) {
    const authorization = { from: payer.address, to: config.sellerAddress!, value: mode === "quick" ? "50000" : "80000",
      validAfter: String(Math.floor(Date.now() / 1000) - 600), validBefore: String(Math.floor(Date.now() / 1000) + 691200), nonce: `0x${(++nonceSequence).toString(16).padStart(64, "0")}` };
    const signature = await payer.signTypedData(typed(authorization));
    const header = Buffer.from(JSON.stringify({ authorization, signature })).toString("base64");
    const body = JSON.stringify({ question: "Unfunded owned original fixture", budget: .03, researchMode: mode, packageVersion: "1.0.0", responseMode: "async", ...extra });
    const id = a2aOrderId({ network: "eip155:5042", payer: payer.address, payee: config.sellerAddress!, authorizationId: authorization.nonce });
    return { id, header, body, authorization, req: (headers: Record<string, string> = {}) => new NextRequest("https://keryx.cc/api/agent/ask", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://keryx.cc", "payment-signature": header, "x-keryx-account-job": "associate", ...headers }, body }) };
  }
  const token = async (wallet = owner) => (await issueWebSession(native, secret, wallet, "asker")).token;
  async function history(jwt: string | undefined, id: string) {
    const route = await import("../../app/api/me/jobs/route");
    return cookies.run(jwt, () => route.GET(new Request(`https://keryx.cc/api/me/jobs?pending=owned&id=${id}`)));
  }
  it.each(["quick", "deep"] as const)("actual %s producer associates only cookie owner and projects exact retained hold before target", async mode => {
    const jwt = await token(), original = await signed(mode);
    const response = await cookies.run(jwt, () => POST(original.req()));
    expect(response.status).toBe(202); expect(response.headers.get("payment-response")).toBeTruthy();
    const saved = (await native.getA2aOrder(original.id))!;
    expect(saved.payer.toLowerCase()).toBe(payer.address.toLowerCase()); expect(saved.amountUsdc).toBe(mode === "quick" ? .05 : .08);
    const worker = "unfunded-fixture-worker", started = new Date().toISOString();
    expect((await native.claimNextA2aOrder(worker, started))?.id).toBe(original.id);
    await native.setSyncState("a2aWorker", JSON.stringify({ workerId: worker, status: "recovery_pending", orderId: original.id, updatedAt: new Date().toISOString() }));
    const packet = await (await history(jwt, original.id)).json();
    expect(packet.jobs[0]).toMatchObject({ attention: "needs_review", recoveryState: "held", status: "review_required", escalation: { state: "within_target" } });
    expect(JSON.stringify(packet)).not.toContain(worker); expect(JSON.stringify(packet)).not.toContain(saved.request!.question);
    expect((await (await history(await token(payer.address), original.id)).json()).jobs).toEqual([]);
    expect((await (await history(await token(foreign), original.id)).json()).jobs).toEqual([]);
    expect(mocks.vendorSettle).toHaveBeenCalledOnce(); expect(mocks.collectRun).not.toHaveBeenCalled();
    expect((await native.listPaymentsByQuery(original.id)).filter(p => p.kind === "inbound")).toHaveLength(1);
    for (const fact of [null, "malformed", JSON.stringify({ workerId: "foreign", status: "recovery_pending", orderId: original.id, updatedAt: started }),
      JSON.stringify({ workerId: worker, status: "processing", orderId: original.id, updatedAt: started }), "x".repeat(2049)]) {
      await native.setSyncState("a2aWorker", fact ?? "null");
      const refused = await (await history(jwt, original.id)).json();
      expect(refused.jobs[0]).toMatchObject({ attention: "unknown", recoveryState: "unknown" });
    }
    await native.failA2aOrder(original.id, "research_failed", new Date().toISOString());
    expect((await (await history(jwt, original.id)).json()).jobs[0]).toMatchObject({ attention: "needs_review", recoveryState: "unknown", escalation: { state: "within_target" } });
    expect(mocks.vendorSettle).toHaveBeenCalledOnce();
  });
  it.each(["missing", "forged", "api-key", "foreign-origin", "payer-worker-body"])("actual POST refuses %s as owner authority before settlement", async reason => {
    let jwt: string | undefined = await token(); const original = await signed("quick", { wallet: owner, payer: owner, workerId: owner });
    const headers: Record<string, string> = {};
    if (reason === "missing" || reason === "payer-worker-body") jwt = undefined;
    if (reason === "forged") { const parts = jwt!.split("."); const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()); claims.address = foreign; parts[1] = Buffer.from(JSON.stringify(claims)).toString("base64url"); jwt = parts.join("."); }
    if (reason === "api-key") headers.authorization = "Bearer caller-api-key";
    if (reason === "foreign-origin") headers.origin = "https://foreign.test";
    const response = await cookies.run(jwt, () => POST(original.req(headers)));
    expect(response.status).toBe(401); expect(mocks.vendorSettle).not.toHaveBeenCalled();
    expect(await native.getA2aOrder(original.id)).toBeNull(); expect(await native.listPaymentsByQuery(original.id)).toEqual([]);
  });
  it("actual details mounts genuine owned route state; foreign/replaced/missing selectors have no financial effect", async () => {
    const jwt = await token(), original = await signed();
    expect((await cookies.run(jwt, () => POST(original.req()))).status).toBe(202);
    await native.failA2aOrder(original.id, "research_failed", new Date().toISOString());
    const financialBefore = await native.listPaymentsByQuery(original.id);
    const { JSDOM } = await import("jsdom"), { createElement, act } = await import("react"), { createRoot } = await import("react-dom/client");
    const { ResearchJobDetails } = await import("../../components/keryx/research-job-details");
    const route = await import("../../app/api/me/jobs/route"), sessionRoute = await import("../../app/api/auth/sessions/route");
    const dom = new JSDOM('<div id="fixture"></div>', { url: "https://keryx.cc" });
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let current: string | undefined = jwt;
    const intercepted = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      return cookies.run(current, () => String(url) === "/api/auth/sessions" ? sessionRoute.GET()
        : route.GET(new Request(`https://keryx.cc${url}`)));
    });
    vi.stubGlobal("fetch", intercepted); vi.useFakeTimers();
    const host = dom.window.document.getElementById("fixture")!, root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(ResearchJobDetails, { job: { queryId: original.id, status: "processing" } })); });
      expect(host.textContent).toContain("NeedsReview");
      current = await token(payer.address);
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event("keryx:auth")); });
      expect(host.textContent).not.toContain("NeedsReview");
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(host.textContent).not.toContain("NeedsReview");
      current = jwt;
      await act(async () => { root.render(createElement(ResearchJobDetails, { job: { queryId: `a2a_${"f".repeat(64)}`, status: "processing" } })); });
      expect(host.textContent).not.toContain("NeedsReview");
      current = undefined;
      await act(async () => { dom.window.dispatchEvent(new dom.window.Event("keryx:auth")); await vi.advanceTimersByTimeAsync(2000); });
      expect(host.textContent).not.toContain("NeedsReview");
      expect(await native.listPaymentsByQuery(original.id)).toEqual(financialBefore);
      expect(mocks.vendorSettle).toHaveBeenCalledOnce(); expect(mocks.collectRun).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); dom.window.close(); }
  });
  it.each(["before-settlement", "during-settlement"])("session revocation %s preserves original financial boundary and never retries", async phase => {
    const jwt = await token(), original = await signed(); const claims = (await parseWebSession(jwt, secret))!;
    const revoke = () => native.revokeWebSession(webSessionHash(claims.jti), owner);
    if (phase === "before-settlement") {
      const verify = mocks.vendorVerify.getMockImplementation()!;
      mocks.vendorVerify.mockImplementation(async (...args) => { const result = await verify(...args); await revoke(); return result; });
    } else mocks.vendorSettle.mockImplementation(async () => { await revoke(); return { success: true, payer: payer.address, network: "eip155:5042", transaction: "unfunded-debit-before-owner-refusal" }; });
    const response = await cookies.run(jwt, () => POST(original.req()));
    expect(response.status).toBe(phase === "before-settlement" ? 401 : 500);
    expect(mocks.vendorSettle).toHaveBeenCalledTimes(phase === "before-settlement" ? 0 : 1);
    expect(!!response.headers.get("payment-response")).toBe(phase === "during-settlement");
    // Guard refusal may close the facade; reopen the same exact namespace to inspect retained debit.
    try { native.close(); } catch {} native = await createEnrolledSqliteAdapter(); mocks.getDb.mockResolvedValue(native);
    expect(await native.getA2aOrder(original.id)).toBeNull();
    expect((await native.listPaymentsByQuery(original.id)).filter(p => p.kind === "inbound")).toHaveLength(phase === "during-settlement" ? 1 : 0);
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect((await history(jwt, original.id)).status).toBe(401);
  });
});

describe("A2A v2 route", () => {
  it.each([{ reviewFirst: true }, { mode: "review-first" }, { researchMode: "review-first" }, { responseMode: "reviewFirst" }])("refuses review intent before provider, payment or job admission: %j", async intent => {
    const response = await POST(request({ question: "Synthetic question", budget: 0.05, ...intent }));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "review_unsupported" });
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect(mocks.getAgentDeps).not.toHaveBeenCalled(); expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });
  let db: {
    recordPaymentOnce: ReturnType<typeof vi.fn>;
    createA2aOrder: ReturnType<typeof vi.fn>;
    completeA2aOrder: ReturnType<typeof vi.fn>;
    failA2aOrder: ReturnType<typeof vi.fn>;
    resolveA2aOrder: ReturnType<typeof vi.fn>;
    markA2aOrderPaymentStarted: ReturnType<typeof vi.fn>;
    markA2aOrderResultSaving: ReturnType<typeof vi.fn>;
    getQueryRun: ReturnType<typeof vi.fn>;
    getA2aOrder: ReturnType<typeof vi.fn>;
    listCreatorPaymentAttemptsByQuery: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    Object.assign(config, { profile: ARC_TESTNET_PROFILE, networkId: ARC_TESTNET_PROFILE.networkId });
    vi.clearAllMocks();
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
    mocks.checkRateLimit.mockResolvedValue(null);
    db = {
      recordPaymentOnce: vi.fn().mockResolvedValue(true),
      createA2aOrder: vi.fn(),
      completeA2aOrder: vi.fn().mockResolvedValue(true),
      failA2aOrder: vi.fn().mockResolvedValue(true),
      resolveA2aOrder: vi.fn().mockResolvedValue(true),
      markA2aOrderPaymentStarted: vi.fn().mockResolvedValue(true),
      markA2aOrderResultSaving: vi.fn().mockResolvedValue(true),
      getQueryRun: vi.fn().mockResolvedValue(null),
      getA2aOrder: vi.fn().mockResolvedValue(null),
      listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([
        { amountUsdc: 0.031, settled: true, settlementStatus: "settled" },
      ]),
    };
    db.createA2aOrder.mockImplementation(async (order) => {
      db.getA2aOrder.mockResolvedValue(order);
      return { created: true, order };
    });
    mocks.getDb.mockResolvedValue(db);
    Object.assign(db, { assertResearchPurchaseAuthority: vi.fn().mockResolvedValue(undefined) });
    // These retained transport/economics cases use explicitly public admitted
    // originals. Hidden/unknown/owner authorization is covered by poll.test.ts.
    Object.assign(db,{runPrivacy:{read:async()=>({exists:true,item:{run,state:{visibility:"public",revision:0,erased:false}}})}});
    mocks.getAgentDeps.mockResolvedValue({ db, gateway: {}, engine: {} });
    mocks.collectRun.mockImplementation(async (input) => ({ ...run, id: input.queryId }));
    mocks.settleThenServe.mockImplementation(async (_req, opts, produce) => {
      try {
        const produced = await produce({
          payer: "0x1111111111111111111111111111111111111111",
          transaction: "circle-transfer",
          amountUsdc: opts.priceUsdc,
          authorizationId: "0xnonce",
        });
        return produced instanceof Response ? produced : Response.json(produced);
      } catch {
        return Response.json({ error: "paid resource unavailable after settlement" }, { status: 500 });
      }
    });
  });

  it.each([undefined, "wait", "async"])("mainnet %s cannot bypass the durable business queue", async responseMode => {
    Object.assign(config, { profile: ARC_MAINNET_PROFILE, networkId: ARC_MAINNET_PROFILE.networkId });
    const response = await POST(request({ question: "q", responseMode }, true));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({status:"queued"});
    expect(db.createA2aOrder).toHaveBeenCalledWith(expect.objectContaining({ startedAt:null,workerId:null }));
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("checks the research runtime before submitting a signed payment for settlement", async () => {
    const cause = new ReferenceError("Cannot access 'e9' before initialization");
    mocks.getAgentDeps.mockRejectedValue(cause);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(request({ question: "q" }, true));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "research service unavailable" });
      expect(mocks.settleThenServe).not.toHaveBeenCalled();
      expect(db.recordPaymentOnce).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("[a2a] research dependency preflight failed:", cause);
    } finally {
      log.mockRestore();
    }
  });

  it("uses the preflighted dependencies for a signed research run", async () => {
    const response = await POST(request({ question: "q" }, true));
    expect(response.status).toBe(200);
    expect(mocks.getAgentDeps).toHaveBeenCalledWith({ model: undefined });
    expect(mocks.collectRun).toHaveBeenCalledWith(
      expect.objectContaining({ question: "q", asker: "0x1111111111111111111111111111111111111111",
        provenance: { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } }),
      { deps: await mocks.getAgentDeps.mock.results[0]!.value },
    );
  });

  it("prices the body before settlement and bounds downstream spend to the prepaid cap", async () => {
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(200);
    expect(mocks.settleThenServe.mock.calls[0][1].priceUsdc).toBe(0.1);
    expect(mocks.collectRun).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: 0.05,
        researchMode: "deep",
        fundingOwner: "treasury",
        executionLimits: { attentionLimit: 4, reevaluateRounds: 1 },
      }),
    );
    expect(await response.json()).toMatchObject({
      status: "completed",
      feePaid: 0.05,
      totalPricePaid: 0.1,
      pricing: {
        settledCreatorSpendUsdc: 0.031,
        pendingCreatorSpendUsdc: 0,
        unusedCreatorReserveUsdc: 0.019,
      },
      researchPackage: { id: "keryx-deep", version: "1.0.0" },
      serviceReceipt: {
        outcome: "completed",
        targetCompletionMs: 300_000,
        objectiveKind: "provisional_slo",
        quality: { status: "measured", groundedClaimRate: 0 },
      },
    });
  });

  it("returns the durable completed result on authorization replay without rerunning", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: { ...order, status: "completed", response: { status: "completed", queryId: order.id } },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "completed", replayed: true });
    expect(mocks.collectRun).not.toHaveBeenCalled();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
  });

  it("returns a historical completed authorization without relabeling it package v1", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: {
        ...order,
        requestHash: "8cb6a2f97128ce20d77011dc361c084ec5d64ec7613adfabda891816b148075a",
        researchPackage: null,
        request: null,
        status: "completed",
        response: { status: "completed", queryId: order.id, answer: "historical answer" },
      },
    }));

    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "completed",
      answer: "historical answer",
      replayed: true,
    });
    expect(payload).not.toHaveProperty("researchPackage");
    expect(payload).not.toHaveProperty("serviceReceipt");
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("returns processing for an already-claimed authorization with no saved run", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "processing", replayed: true });
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("settles, durably queues, and returns 202 without running research inline", async () => {
    const response = await POST(
      request({ question: "q", budget: 0.05, researchMode: "deep", responseMode: "async" }),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toMatch(/^\/api\/agent\/ask\?queryId=a2a_/);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toMatchObject({
      status: "queued",
      pollUrl: expect.any(String),
      researchPackage: { id: "keryx-deep", version: "1.0.0" },
      serviceStatus: {
        state: "queued",
        targetCompletionMs: 300_000,
        targetBreached: false,
        objectiveKind: "provisional_slo",
      },
    });
    expect(mocks.collectRun).not.toHaveBeenCalled();
    const proposed = db.createA2aOrder.mock.calls[0][0];
    expect(proposed).toMatchObject({
      request: { question: "q", origin: "a2a" },
      startedAt: null,
      workerId: null,
    });
  });

  it("honors Prefer: respond-async and rejects unknown response modes", async () => {
    const preferred = request({ question: "q", budget: 0.05 });
    preferred.headers.set("prefer", "respond-async");
    const preferredResponse = await POST(preferred);
    expect(preferredResponse.status).toBe(202);
    expect(preferredResponse.headers.get("preference-applied")).toBe("respond-async");
    expect(preferredResponse.headers.get("vary")).toBe("Prefer");
    expect(mocks.collectRun).not.toHaveBeenCalled();

    const invalid = await POST(request({ question: "q", responseMode: "later" }));
    expect(invalid.status).toBe(400);
    expect(mocks.settleThenServe).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported package version before issuing or settling a payment", async () => {
    const response = await POST(request({ question: "q", packageVersion: "2.0.0" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "unsupported A2A research package version",
      supportedPackageVersions: ["1.0.0"],
    });
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("repairs a lost completion write from the saved real QueryRun", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    db.getQueryRun.mockImplementation(async (queryId) => ({ ...run, id: queryId }));
    db.getA2aOrder.mockImplementation(async (queryId) => ({
      ...db.createA2aOrder.mock.calls[0]?.[0],
      id: queryId,
      queryId,
      status: "completed",
      response: { status: "completed", queryId },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "completed", replayed: true });
    expect(db.resolveA2aOrder).toHaveBeenCalledOnce();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("keeps a simulated saved run under review without publishing it", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    db.getQueryRun.mockImplementation(async (queryId) => ({
      ...run,
      id: queryId,
      paymentMode: "offline",
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "processing", replayed: true });
    expect(db.resolveA2aOrder).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("fails closed when a replay changes the signed economic tuple", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: { ...order, amountUsdc: order.amountUsdc + 0.01 },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(500);
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("polls a durable order without settling or launching research", async () => {
    const queryId = `a2a_${"a".repeat(64)}`;
    db.getA2aOrder.mockResolvedValue({
      id: queryId,
      queryId,
      authorizationId: "0xnonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "completed",
      transaction: "circle-transfer",
      request: { question: "q", origin: "a2a" },
      startedAt: "now",
      workerId: "worker",
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: { status: "completed", queryId, answer: "saved" },
      errorCode: null,
      resolution: null,
      createdAt: "now",
      updatedAt: "now",
    });
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([
      { amountUsdc: 0.03, settled: true, settlementStatus: "settled" },
      { amountUsdc: 0.005, settled: false, settlementStatus: "pending" },
    ]);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    const completedPacket = await response.json();
    expect(completedPacket).not.toHaveProperty("escalation");
    expect(completedPacket).toMatchObject({
      status: "completed",
      answer: "saved",
      totalToCreators: 0.03,
      pricing: {
        settledCreatorSpendUsdc: 0.03,
        pendingCreatorSpendUsdc: 0.005,
        unusedCreatorReserveUsdc: 0.015,
      },
    });
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("distinguishes queued from processing without exposing private worker input", async () => {
    const queryId = `a2a_${"b".repeat(64)}`;
    const queued = {
      id: queryId,
      queryId,
      authorizationId: "0xnonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "running",
      transaction: "circle-transfer",
      request: { question: "private question", origin: "a2a" },
      startedAt: null,
      workerId: null,
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: null,
      resolution: null,
      createdAt: "now",
      updatedAt: "now",
    };
    db.getA2aOrder.mockResolvedValue(queued);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    const payload = await response.json();
    expect(payload).toMatchObject({ status: "queued", queryId });
    expect(JSON.stringify(payload)).not.toContain("private question");

    db.getA2aOrder.mockResolvedValue({
      ...queued,
      startedAt: new Date().toISOString(),
      workerId: "worker",
    });
    const processing = await GET(
      new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`),
    );
    expect(await processing.json()).toMatchObject({ status: "processing", queryId });
  });

  it("observes an overdue original without new settlement, research or private payment references", async () => {
    const queryId = `a2a_${"d".repeat(64)}`, original = {
      id: queryId, queryId, authorizationId: "PRIVATE_NONCE", requestHash: "PRIVATE_HASH",
      payer: "0x1111111111111111111111111111111111111111", payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.08, creatorBudgetUsdc: 0.06, serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: a2aResearchPackage("quick"),
      status: "running", transaction: "PRIVATE_ORIGINAL_PAYMENT", request: { question: "PRIVATE_QUESTION", origin: "a2a", network: "eip155:5042002" },
      startedAt: "2026-09-01T00:00:01.000Z", workerId: "PRIVATE_WORKER", executionJournalVersion: 1,
      paymentStartedAt: "2026-09-01T00:00:02.000Z", resultSavingAt: null, response: null, errorCode: null, resolution: null,
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:02.000Z",
    };
    db.getA2aOrder.mockResolvedValue(original);
    const before = structuredClone(original);
    const packet = await (await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`))).json();
    expect(packet.escalation).toMatchObject({ state: "overdue", escalationNeeded: true, lastRecordedStage: "creator_payment_boundary",
      creatorPaymentState: "payment_boundary_crossed", acceptedAt: original.createdAt, targetCompletionAt: "2026-09-01T00:03:00.000Z" });
    expect(JSON.stringify(packet)).not.toMatch(/PRIVATE_|originalPayment/);
    expect(original).toEqual(before); expect(mocks.settleThenServe).not.toHaveBeenCalled(); expect(mocks.collectRun).not.toHaveBeenCalled();
    for (const method of [db.recordPaymentOnce, db.completeA2aOrder, db.failA2aOrder, db.resolveA2aOrder, db.markA2aOrderPaymentStarted, db.markA2aOrderResultSaving]) expect(method).not.toHaveBeenCalled();
  });

  it("publishes audited failed economics without exposing private order data", async () => {
    const queryId = `a2a_${"c".repeat(64)}`;
    const failedOrder = {
      id: queryId,
      queryId,
      authorizationId: "0xprivate-nonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "failed",
      transaction: "private-circle-transfer",
      request: { question: "private failed question", origin: "a2a" },
      startedAt: "2026-09-01T00:00:00.000Z",
      workerId: "private-worker",
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: "operator_reviewed_no_result",
      resolution: {
        action: "close_failed",
        actor: "operator-cli",
        reason: "no_saved_run_before_execution_boundaries",
        evidence: {
          executionJournalVersion: 1,
          paymentBoundaryCrossed: false,
          resultSaveBoundaryCrossed: false,
          creatorAttempts: 0,
          settledCreatorMicros: 0,
          pendingCreatorMicros: 0,
          failedCreatorMicros: 0,
          simulatedCreatorMicros: 0,
          queryRunFound: false,
        },
        resolvedAt: "2026-09-01T00:20:00.000Z",
      },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:20:00.000Z",
    } as const;
    db.getA2aOrder.mockResolvedValue(failedOrder);
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([]);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "failed",
      error: "operator_reviewed_no_result",
      pricing: {
        settledCreatorSpendUsdc: 0,
        pendingCreatorSpendUsdc: 0,
        unusedCreatorReserveUsdc: 0.05,
      },
      creatorPayments: { attempts: 0, failedUsdc: 0, accountingComplete: true },
      resolution: {
        action: "close_failed",
        reason: "no_saved_run_before_execution_boundaries",
        evidence: { settledCreatorSpendUsdc: 0, failedCreatorSpendUsdc: 0 },
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private failed question|private-worker|private-circle-transfer|0xprivate-nonce/,
    );

    db.getA2aOrder.mockResolvedValue({
      ...failedOrder,
      paymentStartedAt: "2026-09-01T00:00:01.000Z",
      errorCode: "research_failed",
      resolution: null,
    });
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([
      { amountUsdc: 0.01, settled: true, settlementStatus: "settled" },
    ]);
    const incomplete = await GET(
      new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`),
    );
    expect(await incomplete.json()).toMatchObject({
      status: "failed",
      pricing: { accountingComplete: false, unusedCreatorReserveUsdc: null },
      creatorPayments: { accountingComplete: false },
      message: expect.stringContaining("lower bound"),
    });
  });

  it("refuses payment before issuing a challenge when the server is forced offline", async () => {
    vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
    const response = await POST(request({ question: "q", budget: 0.05 }));
    expect(response.status).toBe(503);
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("does not terminally hide a saved run with unexpected offline accounting", async () => {
    mocks.collectRun.mockImplementation(async (input) => ({
      ...run,
      id: input.queryId,
      paymentMode: "offline",
    }));
    const response = await POST(request({ question: "q", budget: 0.05 }));
    expect(response.status).toBe(500);
    expect(db.failA2aOrder).not.toHaveBeenCalled();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
  });

  it("does not terminally fail a saved paid run when only the completion CAS is unavailable", async () => {
    db.completeA2aOrder.mockRejectedValue(new Error("database timeout"));

    const response = await POST(request({ question: "q", budget: 0.05 }));

    expect(response.status).toBe(500);
    expect(mocks.collectRun).toHaveBeenCalledOnce();
    expect(db.failA2aOrder).not.toHaveBeenCalled();
  });
});

/** UNRUN route-consumer controls. The genuine existing signed-route fixture is
 * copied locally below so every original body/helper/mock stays byte-identical.
 * Circle verifier/delivery responses are synthetic UNFUNDED fixtures, never
 * financial settlement proof. Native owner/session/admission methods are real;
 * readonly SQL readback observes their output, not a mocked atomicity assertion.
 * Native atomic pair/rollback qualification remains the separate R143 gate. */
describe("signed POST NEW owner-admission controls", () => {
  const shared = Object.values(mocks);
  let previousImplementations: Array<ReturnType<(typeof shared)[number]["getMockImplementation"]>>;
  let previousApiKeyImplementation: typeof verifyApiKey | undefined;
  beforeEach(() => {
    previousImplementations = shared.map(mock => mock.getMockImplementation());
    previousApiKeyImplementation = vi.mocked(verifyApiKey).getMockImplementation();
  });
  const cookies = new AsyncLocalStorage<string | undefined>();
  const owner = `0x${"a".repeat(40)}`, foreign = `0x${"d".repeat(40)}`;
  const payer = privateKeyToAccount(`0x${"3".repeat(64)}`), secret = "unfunded-native-post-test-secret";
  let folder: string, file: string, manifest: string, contentKey: string, native: Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>;
  let actualSeller: typeof import("../x402-server"), nonceSequence = 0;
  const savedConfig = { ...config };
  let fixtureIdentity: Parameters<typeof installStorageFences>[1];
  beforeAll(async () => { actualSeller = await vi.importActual("../x402-server"); });
  beforeEach(async () => {
    Object.assign(config, { profile: ARC_MAINNET_PROFILE, networkId: ARC_MAINNET_PROFILE.networkId,
      usdcAddress: ARC_MAINNET_PROFILE.usdcAddress, gatewayWallet: ARC_MAINNET_PROFILE.gatewayWallet, maxTimeoutSeconds: 691200, jwtSecret: secret });
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
    if (!folder) {
      folder = mkdtempSync(join(tmpdir(), "keryx-owned-real-post-"));
      file = join(folder, "synthetic.sqlite"); manifest = join(folder, "deployment.json");
      const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
        network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
      fixtureIdentity = identity;
      const setup = new DatabaseSync(file);
      try {
        setup.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(setup); installNativeUserDomainSchema(setup);
        insertStorageIdentity(setup, identity); installStorageFences(setup, identity); setup.exec("COMMIT");
      } finally { setup.close(); }
      writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
      contentKey = randomBytes(32).toString("hex");
    }
    vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file); vi.stubEnv("CONTENT_MASTER_KEY", contentKey);
    native = await createEnrolledSqliteAdapter();
    mocks.getDb.mockResolvedValue(native); mocks.getAgentDeps.mockResolvedValue({ db: native, gateway: {}, engine: {} });
    mocks.cookies.mockImplementation(async () => ({ get: (name: string) => name === "keryx_session" && cookies.getStore() ? { value: cookies.getStore() } : undefined }));
    mocks.checkRateLimit.mockResolvedValue(null); mocks.collectRun.mockClear();
    vi.mocked(verifyApiKey).mockResolvedValue({ keyId: "synthetic-ownerless-key", scopes: "ask" } as never);
    mocks.settleThenServe.mockImplementation(actualSeller.settleThenServe);
    mocks.vendorVerify.mockReset().mockImplementation(async (payload, requirements) => {
      const authorization = payload.payload.authorization;
      const recovered = await recoverTypedDataAddress({ ...typed(authorization), signature: payload.payload.signature });
      return { isValid: recovered.toLowerCase() === payer.address.toLowerCase() && authorization.to === requirements.payTo
        && authorization.value === requirements.amount, payer: recovered };
    });
    mocks.vendorSettle.mockReset().mockImplementation(async payload => ({ success: true, network: "eip155:5042", payer: payer.address,
      transaction: `unfunded-vendor-fixture-${payload.payload.authorization.nonce}` }));
  });
  afterEach(() => { try { native?.close(); } catch {} vi.restoreAllMocks(); vi.unstubAllEnvs();
    for (const key of Object.keys(config)) if (!Object.prototype.hasOwnProperty.call(savedConfig, key)) Reflect.deleteProperty(config, key);
    Object.assign(config, savedConfig); });
  afterAll(() => { Object.assign(config, savedConfig); if (folder) rmSync(folder, { recursive: true, force: true }); });
  function typed(a: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }) {
    return { domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042, verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet as `0x${string}` },
      types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "TransferWithAuthorization",
      message: { from: a.from as `0x${string}`, to: a.to as `0x${string}`, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` } } as const;
  }
  async function signed(mode: "quick" | "deep" = "quick", extra: Record<string, unknown> = {}) {
    const authorization = { from: payer.address, to: config.sellerAddress!, value: mode === "quick" ? "50000" : "80000",
      validAfter: String(Math.floor(Date.now() / 1000) - 600), validBefore: String(Math.floor(Date.now() / 1000) + 691200), nonce: `0x${(++nonceSequence).toString(16).padStart(64, "0")}` };
    const signature = await payer.signTypedData(typed(authorization));
    const header = Buffer.from(JSON.stringify({ authorization, signature })).toString("base64");
    const body = JSON.stringify({ question: "Unfunded owned original fixture", budget: .03, researchMode: mode, packageVersion: "1.0.0", responseMode: "async", ...extra });
    const id = a2aOrderId({ network: "eip155:5042", payer: payer.address, payee: config.sellerAddress!, authorizationId: authorization.nonce });
    return { id, header, body, authorization, req: (headers: Record<string, string> = {}) => new NextRequest("https://keryx.cc/api/agent/ask", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://keryx.cc", "payment-signature": header, "x-keryx-account-job": "associate", ...headers }, body }) };
  }
  const token = async (wallet = owner) => (await issueWebSession(native, secret, wallet, "asker")).token;
  async function history(jwt: string | undefined, id: string) {
    const route = await import("../../app/api/me/jobs/route");
    return cookies.run(jwt, () => route.GET(new Request(`https://keryx.cc/api/me/jobs?pending=owned&id=${id}`)));
  }
  // Restore the inherited mock implementations after this block's local fixture
  // cleanup; do not reset/replace any original global helper or mock definition.
  afterEach(() => {
    vi.useRealTimers();
    shared.forEach((mock, index) => {
      mock.mockReset();
      const implementation = previousImplementations[index];
      if (implementation) mock.mockImplementation(implementation);
    });
    vi.mocked(verifyApiKey).mockReset();
    if (previousApiKeyImplementation) vi.mocked(verifyApiKey).mockImplementation(previousApiKeyImplementation);
  });
  function ownerRows(id: string) {
    const inspect = new DatabaseSync(join(folder, "synthetic.sqlite"), { readOnly: true });
    try { return inspect.prepare("SELECT job_id,query_id,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at FROM pending_job_owners WHERE job_id=?").all(id); }
    finally { inspect.close(); }
  }
  // Observe the full fixture ledger: listPaymentsByQuery is citation-only.
  // This raw synthetic readback does not establish financial settlement.
  function paymentRows(id: string) {
    const inspect = new DatabaseSync(file, { readOnly: true });
    try { return inspect.prepare("SELECT * FROM payment_events WHERE query_id=? ORDER BY created_at,id").all(id); }
    finally { inspect.close(); }
  }
  async function noOriginal(id: string) {
    expect(ownerRows(id)).toEqual([]);
    expect(await native.getA2aOrder(id)).toBeNull();
    expect(paymentRows(id)).toEqual([]);
    expect(mocks.collectRun).not.toHaveBeenCalled();
  }
  function without(original: Awaited<ReturnType<typeof signed>>, ...names: string[]) {
    const req = original.req();
    for (const name of names) req.headers.delete(name);
    return req;
  }
  it.each(["quick", "deep"] as const)("admits NEW %s with exact real cookie/durable tuple and unchanged signed economics", async mode => {
    const jwt = await token(), claims = (await parseWebSession(jwt, secret))!;
    const original = await signed(mode), req = original.req();
    expect(req.url).toBe("https://keryx.cc/api/agent/ask");
    expect(req.headers.get("origin")).toBe("https://keryx.cc");
    expect(req.headers.get("x-keryx-account-job")).toBe("associate");
    expect(await req.clone().text()).toBe(original.body);
    expect(req.headers.get("payment-signature")).toBe(original.header);
    expect((await cookies.run(jwt, () => POST(req))).status).toBe(202);
    const saved = (await native.getA2aOrder(original.id))!;
    expect(saved).toMatchObject({ id: original.id, queryId: original.id, payer: payer.address,
      authorizationId: original.authorization.nonce, amountUsdc: mode === "quick" ? .05 : .08,
      creatorBudgetUsdc: .03, serviceFeeUsdc: mode === "quick" ? .02 : .05,
      researchMode: mode, status: "running", startedAt: null, workerId: null,
      request: { question: JSON.parse(original.body).question, network: "eip155:5042" } });
    expect(ownerRows(original.id)).toEqual([{
      job_id: original.id, query_id: original.id, request_hash: saved.requestHash, network: "eip155:5042",
      wallet: owner, session_hash: webSessionHash(claims.jti), issued_at: claims.iat * 1000,
      expires_at: claims.exp * 1000, admitted_at: saved.createdAt,
    }]);
    expect(owner.toLowerCase()).not.toBe(payer.address.toLowerCase());
    const projected = await (await history(jwt, original.id)).json();
    expect(projected.jobs).toHaveLength(1);
    expect(projected.jobs[0]).toMatchObject({ attention: "unknown", recoveryState: "unknown" });
    expect((await (await history(await token(payer.address), original.id)).json()).jobs).toEqual([]);
    const payload = mocks.vendorVerify.mock.calls[0][0];
    expect(payload.payload.authorization).toEqual(original.authorization);
    expect(mocks.vendorVerify.mock.calls[0][1].amount).toBe(original.authorization.value);
    expect(mocks.vendorSettle).toHaveBeenCalledOnce();
    expect(mocks.vendorSettle.mock.calls[0][0].payload.authorization).toEqual(original.authorization);
    expect((paymentRows(original.id)).filter(row => row.kind === "inbound")).toHaveLength(1);
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });
  it.each(["missing-cookie", "false-header", "foreign-origin", "missing-origin", "api-key-opt-in", "wrong-cookie", "revoked-original", "expired-cookie", "wrong-durable-wallet", "wrong-durable-issued", "wrong-durable-expiry"])(
    "refuses %s without owner/original/payment insertion", async reason => {
      let jwt: string | undefined = await token();
      const original = await signed(), headers: Record<string, string> = {};
      if (reason === "missing-cookie") jwt = undefined;
      if (reason === "false-header") headers["x-keryx-account-job"] = "false";
      if (reason === "foreign-origin") headers.origin = "https://foreign.test";
      if (reason === "api-key-opt-in") headers.authorization = "Bearer caller-api-key";
      if (reason === "wrong-cookie") jwt = (await issueWebSession(native, "different-unfunded-test-secret", owner, "asker")).token;
      if (reason === "revoked-original") {
        const claims = (await parseWebSession(jwt, secret))!;
        await native.revokeWebSession(webSessionHash(claims.jti), owner);
        await token(); // A genuine active replacement cannot revive the revoked presented token.
      }
      if (reason === "expired-cookie") {
        vi.useFakeTimers({ toFake: ["Date"] });
        jwt = (await issueWebSession(native, secret, owner, "asker", new Date(Date.now() + 2000).toISOString())).token;
        vi.setSystemTime(Date.now() + 3000);
      }
      if (reason.startsWith("wrong-durable-")) {
        const claims = (await parseWebSession(jwt, secret))!;
        const edit = new DatabaseSync(join(folder, "synthetic.sqlite"));
        try {
          registerStorageCapability(edit, fixtureIdentity, () => true);
          // Corrupt only the isolated fixture row; the signed JWT is untouched.
          if (reason === "wrong-durable-wallet") edit.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(foreign, webSessionHash(claims.jti));
          if (reason === "wrong-durable-issued") edit.prepare("UPDATE web_sessions SET issued_at=issued_at+1000 WHERE hash=?").run(webSessionHash(claims.jti));
          if (reason === "wrong-durable-expiry") edit.prepare("UPDATE web_sessions SET expires_at=expires_at-1000 WHERE hash=?").run(webSessionHash(claims.jti));
        } finally { edit.close(); }
      }
      const req = original.req(headers);
      if (reason === "missing-origin") req.headers.delete("origin");
      const response = await cookies.run(jwt, () => POST(req));
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.vendorVerify).not.toHaveBeenCalled(); expect(mocks.vendorSettle).not.toHaveBeenCalled();
      await noOriginal(original.id);
    });
  it.each(["cookie-without-header", "anonymous", "api-key", "cli", "generic-transport"])(
    "keeps ordinary signed %s ownerless with original body, budget and nonce", async actor => {
      const original = await signed("quick", { wallet: owner, payer: owner, workerId: owner });
      const req = without(original, "x-keryx-account-job");
      if (actor !== "cookie-without-header") req.headers.delete("origin");
      if (actor === "api-key") req.headers.set("authorization", "Bearer caller-api-key");
      if (actor === "cli") req.headers.set("user-agent", "keryx-cli-unfunded-fixture");
      const response = await cookies.run(actor === "cookie-without-header" ? await token() : undefined, () => POST(req));
      expect(response.status).toBe(202); expect(ownerRows(original.id)).toEqual([]);
      expect(await native.getA2aOrder(original.id)).toMatchObject({ authorizationId: original.authorization.nonce,
        payer: payer.address, amountUsdc: .05, creatorBudgetUsdc: .03, serviceFeeUsdc: .02,
        request: { question: JSON.parse(original.body).question }, startedAt: null, workerId: null });
      expect(mocks.vendorSettle).toHaveBeenCalledOnce();
      expect(mocks.vendorSettle.mock.calls[0][0].payload.authorization).toEqual(original.authorization);
      expect((paymentRows(original.id)).filter(row => row.kind === "inbound")).toHaveLength(1);
      expect((await (await history(await token(), original.id)).json()).jobs).toEqual([]);
      expect(mocks.collectRun).not.toHaveBeenCalled();
    });
  it("refuses unsigned opt-in before verifier/payment instead of dispatching an anonymous purchase", async () => {
    const original = await signed();
    const response = await cookies.run(await token(), () => POST(without(original, "payment-signature")));
    expect(response.status).toBe(401);
    expect(mocks.vendorVerify).not.toHaveBeenCalled(); expect(mocks.vendorSettle).not.toHaveBeenCalled();
    await noOriginal(original.id);
  });
  it.each(["signature", "payment", "receipt"] as const)("failed %s never inserts owner/original or runs research", async failure => {
    const original = await signed(), req = original.req();
    if (failure === "signature") {
      const wrongSigner = privateKeyToAccount(`0x${"4".repeat(64)}`);
      const signature = await wrongSigner.signTypedData(typed(original.authorization));
      req.headers.set("payment-signature", Buffer.from(JSON.stringify({ authorization: original.authorization, signature })).toString("base64"));
    } else if (failure === "payment") mocks.vendorSettle.mockResolvedValue({ success: false, errorReason: "explicit synthetic vendor refusal" });
    else mocks.vendorSettle.mockResolvedValue({ success: true, network: "eip155:5042", payer: payer.address });
    const response = await cookies.run(await token(), () => POST(req));
    expect(response.status).toBe(failure === "receipt" ? 503 : 402); expect(response.headers.get("payment-response")).toBeNull();
    // The real seller retains its discovery-extension-to-bare soft-refusal fallback.
    expect(mocks.vendorVerify).toHaveBeenCalledTimes(failure === "signature" ? 2 : 1);
    expect(mocks.vendorSettle).toHaveBeenCalledTimes(failure === "signature" ? 0 : 1);
    await noOriginal(original.id);
  });
  it.each(["unowned-history", "owned-history"] as const)("idempotent replay/recovery cannot attach or replace %s owner", async kind => {
    const jwt = await token(), original = await signed();
    const first = kind === "owned-history" ? original.req() : without(original, "x-keryx-account-job");
    expect((await cookies.run(jwt, () => POST(first))).status).toBe(202);
    const before = (await native.getA2aOrder(original.id))!, ownersBefore = ownerRows(original.id);
    const paymentsBefore = paymentRows(original.id);
    const replacement = await token(), foreignToken = await token(foreign);
    for (const presented of [replacement, foreignToken]) {
      const replay = await cookies.run(presented, () => POST(original.req()));
      expect(replay.status).toBe(200); expect((await replay.json()).replayed).toBe(true);
      expect(ownerRows(original.id)).toEqual(ownersBefore);
      expect(await native.getA2aOrder(original.id)).toEqual(before);
      expect(paymentRows(original.id)).toEqual(paymentsBefore);
    }
    // Delivery replay still traverses the unchanged synthetic vendor boundary;
    // do not claim these three fixture calls prove vendor nonce deduplication.
    expect(mocks.vendorSettle).toHaveBeenCalledTimes(3);
    for (const [payload] of mocks.vendorSettle.mock.calls) expect(payload.payload.authorization).toEqual(original.authorization);
    const callsBeforeRead = mocks.vendorSettle.mock.calls.length;
    expect((await (await history(foreignToken, original.id)).json()).jobs).toEqual([]);
    const historyResult = await (await history(replacement, original.id)).json();
    if (kind === "unowned-history") expect(historyResult.jobs).toEqual([]);
    else {
      expect(historyResult.jobs[0]).toMatchObject({ attention: "unknown", recoveryState: "unknown" });
      expect(ownersBefore).toHaveLength(1);
      expect(ownersBefore[0].session_hash).toBe(webSessionHash((await parseWebSession(jwt, secret))!.jti));
    }
    // The inherited fixture explicitly disables privacy reads; its actual bearer
    // GET retains ordinary pending delivery without creating owner authority.
    const publicRead = await GET(new NextRequest(`https://keryx.cc/api/agent/ask?queryId=${original.id}`));
    expect(publicRead.status).toBe(200);
    expect(ownerRows(original.id)).toEqual(ownersBefore);
    expect(await native.getA2aOrder(original.id)).toEqual(before);
    expect(paymentRows(original.id)).toEqual(paymentsBefore);
    expect(mocks.vendorSettle).toHaveBeenCalledTimes(callsBeforeRead);
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });
  it.each(["question", "budget"] as const)("changed %s cannot use an old nonce to attach an owner", async field => {
    const original = await signed();
    expect((await POST(without(original, "x-keryx-account-job"))).status).toBe(202);
    const before = (await native.getA2aOrder(original.id))!, payments = paymentRows(original.id);
    const body = JSON.parse(original.body);
    if (field === "question") body.question = "Different unfunded research question";
    else body.budget = .04;
    const template = original.req();
    const altered = new NextRequest(template.url, { method: "POST", headers: template.headers, body: JSON.stringify(body) });
    const response = await cookies.run(await token(), () => POST(altered));
    expect(response.status).toBe(field === "budget" ? 402 : 500);
    expect(response.headers.get("payment-response")).toBeNull();
    expect(ownerRows(original.id)).toEqual([]);
    expect(await native.getA2aOrder(original.id)).toEqual(before);
    expect(paymentRows(original.id)).toEqual(payments);
    expect(mocks.vendorSettle).toHaveBeenCalledOnce();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });
  it.each(["before-settlement", "during-settlement"])("session revocation %s preserves original financial boundary and never retries", async phase => {
    const jwt = await token(), original = await signed(); const claims = (await parseWebSession(jwt, secret))!;
    const revoke = () => native.revokeWebSession(webSessionHash(claims.jti), owner);
    if (phase === "before-settlement") {
      const verify = mocks.vendorVerify.getMockImplementation()!;
      mocks.vendorVerify.mockImplementation(async (...args) => { const result = await verify(...args); await revoke(); return result; });
    } else mocks.vendorSettle.mockImplementation(async () => { await revoke(); return { success: true, payer: payer.address, network: "eip155:5042", transaction: "unfunded-debit-before-owner-refusal" }; });
    const response = await cookies.run(jwt, () => POST(original.req()));
    expect(response.status).toBe(phase === "before-settlement" ? 401 : 500);
    expect(mocks.vendorSettle).toHaveBeenCalledTimes(phase === "before-settlement" ? 0 : 1);
    expect(!!response.headers.get("payment-response")).toBe(phase === "during-settlement");
    // Guard refusal may close the facade; reopen the same exact namespace to inspect retained debit.
    try { native.close(); } catch {} native = await createEnrolledSqliteAdapter(); mocks.getDb.mockResolvedValue(native);
    expect(ownerRows(original.id)).toEqual([]);
    expect(await native.getA2aOrder(original.id)).toBeNull();
    expect((paymentRows(original.id)).filter(p => p.kind === "inbound")).toHaveLength(phase === "during-settlement" ? 1 : 0);
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect((await history(jwt, original.id)).status).toBe(401);
  });
});
