import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), getAgentDeps: vi.fn(), collectRun: vi.fn(),
  mainnetReady: vi.fn(), checkRateLimit: vi.fn(), settleThenServe: vi.fn(), challengeResponse: vi.fn(),
}));

vi.mock("@/lib/config", async () => ({ config: {
  profile: (await import("../arc-network-profile")).ARC_MAINNET_PROFILE,
  networkId: "eip155:5042", sellerAddress: `0x${"2".repeat(40)}`,
  a2aFeeUsdc: 0.02, a2aDeepFeeUsdc: 0.05, a2aMaxBudget: 0.5, defaultBudget: 0.05, botKey: "fixture-bot",
} }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps, collectRun: mocks.collectRun }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/payments/mainnet-hosted-gateway", () => ({ assertMainnetHostedResearchReady: mocks.mainnetReady }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: vi.fn(() => { throw Error("No API key belongs in this fixture"); }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/x402-discovery", () => ({ a2aDiscovery: {} }));
// The x402 helper is the route's Circle verification/settlement entrance. No real facilitator
// is imported or settlement simulated: a signed request reaching it returns a test-only sentinel.
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settleThenServe, challengeResponse: mocks.challengeResponse }));
// This suite exercises the distinct business-canary gate, without reading an owner's allowance.
vi.mock("@/lib/research/research-allowance", () => ({ configuredResearchAllowance: () => null }));

import { GET, POST } from "@/app/api/agent/ask/route";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { a2aOrderId, type A2aOrder } from "../a2a/order";
import { a2aResearchPackageForVersion } from "../a2a/research-package";
import type { BuyerIntent } from "../buyer/journal";
import {
  activateBusinessCanary, assertPreparedCanarySubmission, businessCanaryDirectory,
  businessCanaryHostIdentity, type BusinessCanaryPolicy,
} from "../business-operator/canary-policy";

const now = "2026-10-06T12:00:00.000Z";
const fixtureParent = os.homedir();
// File writes/readback/fsync remain real. Only directory fsync is substituted on Windows,
// matching the retained-ledger unit fixtures; production financial admission requires POSIX.
const flush = process.platform === "win32" ? () => {} : undefined;
let fixtureHome: string;
let db: {
  assertResearchPurchaseAuthority: ReturnType<typeof vi.fn>;
  getA2aOrder: ReturnType<typeof vi.fn>;
  getQueryRun: ReturnType<typeof vi.fn>;
  listCreatorPaymentAttemptsByQuery: ReturnType<typeof vi.fn>;
};

function fixture(reserved = false) {
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
  const original: BuyerIntent = { schema: "keryx-buyer-intent-v1",
    request: { question: "Which supplier bounds apply to this single research original?", budget: 0.01,
      researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      amount: "30000", payTo: to, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    authorization: { from, to, value: "30000", nonce, validAfter: "1791248400", validBefore: "1791936000" },
    queryId: a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId, payer: from, payee: to, authorizationId: nonce }) };
  const policy: BusinessCanaryPolicy = { format: "keryx-business-canary-v1", approvalId: "operator-business-20261006",
    approvedAt: "2026-10-06T03:23:02.644Z", expiresAt: "2026-10-07T00:00:00.000Z", priceCheckedOn: "2026-10-06",
    maximumOriginals: 1, maximumMicroUsd: 250000, maximumMicroUsdc: 60000, creatorPaymentMode: "forbidden",
    executionHostSha256: businessCanaryHostIdentity(), original };
  const directory = businessCanaryDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const file = path.join(fixtureHome, "policy.json"), bytes = JSON.stringify(policy);
  const digest = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  activateBusinessCanary(file, digest, flush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", file); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", digest);
  if (reserved) assertPreparedCanarySubmission(original, flush);
  return { original, directory };
}

function request(body: unknown, authorization?: BuyerIntent["authorization"], query = "") {
  const header = authorization ? Buffer.from(JSON.stringify({ x402Version: 2,
    payload: { authorization, signature: "synthetic-signature-not-for-Circle" } })).toString("base64") : undefined;
  return new NextRequest(`http://localhost/api/agent/ask${query}`, { method: "POST",
    headers: { "content-type": "application/json", ...(header ? { "payment-signature": header } : {}) },
    body: JSON.stringify(body) });
}

function retained(directory: string) {
  return fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), "utf8")]);
}
function expectNoPaidDependencies() {
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(db.assertResearchPurchaseAuthority).not.toHaveBeenCalled();
  expect(mocks.mainnetReady).not.toHaveBeenCalled();
  expect(mocks.getAgentDeps).not.toHaveBeenCalled();
  expect(mocks.settleThenServe).not.toHaveBeenCalled();
  expect(mocks.challengeResponse).not.toHaveBeenCalled();
  expect(mocks.collectRun).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}
function order(original: BuyerIntent, completed: boolean): A2aOrder {
  return { id: original.queryId, queryId: original.queryId, authorizationId: original.authorization.nonce,
    requestHash: "synthetic-saved-request-hash", payer: original.authorization.from, payee: original.authorization.to,
    amountUsdc: 0.03, creatorBudgetUsdc: 0.01, serviceFeeUsdc: 0.02, researchMode: "quick",
    researchPackage: a2aResearchPackageForVersion("quick", "1.0.0")!, status: completed ? "completed" : "running",
    transaction: "synthetic-saved-inbound-proof", request: { question: original.request.question, origin: "a2a" },
    startedAt: null, workerId: null, executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: null,
    response: completed ? { status: "completed", queryId: original.queryId, answer: "Synthetic saved fixture answer" } : null,
    errorCode: null, resolution: null, createdAt: now, updatedAt: now };
}

beforeEach(() => {
  vi.resetAllMocks();
  fixtureHome = fs.mkdtempSync(path.join(fixtureParent, "keryx-a2a-canary-route-test-")); fs.chmodSync(fixtureHome, 0o700);
  vi.spyOn(os, "homedir").mockReturnValue(fixtureHome);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Network is forbidden in A2A admission fixtures"); }));
  db = { assertResearchPurchaseAuthority: vi.fn().mockResolvedValue(undefined), getA2aOrder: vi.fn().mockResolvedValue(null),
    getQueryRun: vi.fn().mockResolvedValue(null), listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([]) };
  mocks.checkRateLimit.mockResolvedValue(null); mocks.getDb.mockResolvedValue(db);
  mocks.mainnetReady.mockResolvedValue(undefined); mocks.getAgentDeps.mockResolvedValue({});
  mocks.challengeResponse.mockImplementation((requirements) => Response.json({ testOnlyQuote: requirements }, { status: 402 }));
  mocks.settleThenServe.mockImplementation(async (req, requirements) => req.headers.has("payment-signature")
    ? Response.json({ testOnly: "x402 entrance reached; no Circle verification or settlement" }, { status: 418 })
    : mocks.challengeResponse(requirements));
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  const resolved = path.resolve(fixtureHome);
  if (path.dirname(resolved) !== path.resolve(fixtureParent) || !path.basename(resolved).startsWith("keryx-a2a-canary-route-test-"))
    throw Error("Unsafe A2A fixture cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe("A2A route with a retained business-canary original", () => {
  it.each(["question", "budget", "researchMode", "responseMode", "extra policy selector", "bot"] as const)
    ("refuses a foreign %s before mainnet readiness, runtime or Circle entrance", async mutation => {
      const value = fixture(true), before = retained(value.directory), body: Record<string, unknown> = { ...value.original.request };
      if (mutation === "question") body.question = "A different paid research original";
      if (mutation === "budget") body.budget = 0.02;
      if (mutation === "researchMode") body.researchMode = "deep";
      if (mutation === "responseMode") body.responseMode = "wait";
      if (mutation === "extra policy selector") body.KERYX_BUSINESS_CANARY_FILE = "caller-selected-policy";
      const response = await POST(request(body, value.original.authorization, mutation === "bot" ? "?bot=fixture-bot" : ""));
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: "research_service_unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expectNoPaidDependencies(); expect(retained(value.directory)).toEqual(before);
    });

  it.each(["nonce", "payer", "value", "validBefore"] as const)
    ("refuses a foreign authorization %s without exposing it to Circle", async mutation => {
      const value = fixture(true), before = retained(value.directory), authorization = { ...value.original.authorization };
      if (mutation === "nonce") authorization.nonce = `0x${"b".repeat(64)}`;
      if (mutation === "payer") authorization.from = `0x${"3".repeat(40)}`;
      if (mutation === "value") authorization.value = "30001";
      if (mutation === "validBefore") authorization.validBefore = "1791936001";
      const response = await POST(request(value.original.request, authorization));
      expect(response.status).toBe(503); expectNoPaidDependencies(); expect(retained(value.directory)).toEqual(before);
    });

  it("refuses the exact signed original when its protected reservation is missing", async () => {
    const value = fixture(), before = retained(value.directory);
    expect(fs.existsSync(path.join(value.directory, "original.json"))).toBe(false);
    const response = await POST(request(value.original.request, value.original.authorization));
    expect(response.status).toBe(503); expectNoPaidDependencies(); expect(retained(value.directory)).toEqual(before);
  });

  it("quotes the exact unsigned original without requiring or creating a reservation", async () => {
    const value = fixture(), before = retained(value.directory);
    const response = await POST(request(value.original.request));
    expect(response.status).toBe(402);
    expect(mocks.settleThenServe).toHaveBeenCalledExactlyOnceWith(expect.any(NextRequest),
      expect.objectContaining({ priceUsdc: 0.03, payTo: value.original.authorization.to, purchasePurpose: "a2a" }), expect.any(Function));
    expect(await response.json()).toMatchObject({ testOnlyQuote: { priceUsdc: 0.03, endpoint: "/api/agent/ask" } });
    expect(mocks.getAgentDeps).not.toHaveBeenCalled(); expect(mocks.collectRun).not.toHaveBeenCalled();
    expect(db.getA2aOrder).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(retained(value.directory)).toEqual(before);
  });

  it("allows the exact reserved signed original to reach the payment entrance after both preflights", async () => {
    const value = fixture(true), before = retained(value.directory);
    const response = await POST(request(value.original.request, value.original.authorization));
    expect(response.status).toBe(418); // Deliberate test boundary: no signature verification or settlement.
    expect(db.assertResearchPurchaseAuthority).toHaveBeenCalledWith(ARC_MAINNET_PROFILE.networkId);
    expect(mocks.mainnetReady).toHaveBeenCalledExactlyOnceWith(db, "10000");
    expect(mocks.getAgentDeps).toHaveBeenCalledExactlyOnceWith({ model: undefined });
    expect(mocks.settleThenServe).toHaveBeenCalledTimes(1);
    expect(mocks.mainnetReady.mock.invocationCallOrder[0]).toBeLessThan(mocks.getAgentDeps.mock.invocationCallOrder[0]);
    expect(mocks.getAgentDeps.mock.invocationCallOrder[0]).toBeLessThan(mocks.settleThenServe.mock.invocationCallOrder[0]);
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(retained(value.directory)).toEqual(before);
  });

  it("keeps ordinary unsigned GET discovery available when no canary is active", async () => {
    const response = await GET(new NextRequest("http://localhost/api/agent/ask"));
    expect(response.status).toBe(402);
    expect(mocks.challengeResponse).toHaveBeenCalledWith(expect.objectContaining({ priceUsdc: 0.1 }),
      expect.objectContaining({ method: "POST", network: ARC_MAINNET_PROFILE.networkId }));
    expect(mocks.mainnetReady).toHaveBeenCalledExactlyOnceWith(db, "50000");
    expect(mocks.settleThenServe).not.toHaveBeenCalled(); expect(mocks.getAgentDeps).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["active", "removed selectors", "expired"] as const)
    ("recovers the original completed/queued order by GET despite %s admission state", async state => {
      const value = fixture(true), before = retained(value.directory);
      if (state === "removed selectors") {
        vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
      }
      if (state === "expired") vi.setSystemTime("2026-10-07T00:00:00.000Z");
      // Public discovery remains held, while original GET recovery runs before that guard.
      expect((await GET(new NextRequest("http://localhost/api/agent/ask"))).status).toBe(503);
      expectNoPaidDependencies();
      db.getA2aOrder.mockResolvedValue(order(value.original, true));
      const url = `http://localhost/api/agent/ask?queryId=${value.original.queryId}`;
      const completed = await GET(new NextRequest(url));
      expect(completed.status).toBe(200); expect(await completed.json()).toMatchObject({ status: "completed",
        queryId: value.original.queryId, answer: "Synthetic saved fixture answer", totalToCreators: 0 });
      db.getA2aOrder.mockResolvedValue(order(value.original, false));
      const queued = await GET(new NextRequest(url));
      expect(queued.status).toBe(200); expect(await queued.json()).toMatchObject({ status: "queued",
        queryId: value.original.queryId, pollUrl: `/api/agent/ask?queryId=${value.original.queryId}` });
      expect(db.getA2aOrder).toHaveBeenCalledWith(value.original.queryId);
      expect(mocks.mainnetReady).not.toHaveBeenCalled(); expect(mocks.getAgentDeps).not.toHaveBeenCalled();
      expect(mocks.settleThenServe).not.toHaveBeenCalled(); expect(mocks.collectRun).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled(); expect(retained(value.directory)).toEqual(before);
    });
});
