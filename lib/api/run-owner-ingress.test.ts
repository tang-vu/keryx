import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { A2aOrder } from "../a2a/order";
import type { SettleInfo } from "../x402-server";

// Same controlled route dependencies as a2a-v2-route.test.ts. The callback below
// simulates an already verified settlement; it is not paid-production acceptance.
const mocks = vi.hoisted(() => ({
  collectRun: vi.fn(), getAgentDeps: vi.fn(), getDb: vi.fn(),
  verifyApiKey: vi.fn(), checkRateLimit: vi.fn(), settleThenServe: vi.fn(),
}));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collectRun, getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: mocks.verifyApiKey }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, clientIp: () => "192.0.2.26" }));
vi.mock("@/lib/run-privacy/auth", () => ({ requestPrivacyActor: async () => undefined }));
vi.mock("@/lib/payments/mainnet-hosted-gateway", () => ({ assertMainnetHostedResearchReady: vi.fn() }));
vi.mock("@/lib/x402-discovery", () => ({ a2aDiscovery: {} }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settleThenServe, challengeResponse: vi.fn() }));
vi.mock("@/lib/config", async () => ({ config: {
  profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
  networkId: "eip155:5042002", sellerAddress: `0x${"2".repeat(40)}`,
  funderKey: "synthetic-not-a-signing-key", botKey: "",
  a2aFeeUsdc: 0.02, a2aDeepFeeUsdc: 0.05, a2aMaxBudget: 0.5, defaultBudget: 0.05,
} }));

import { POST } from "../../app/api/agent/ask/route";

const keyWallet = `0x${"a".repeat(40)}`, payer = `0x${"b".repeat(40)}`, forgedWallet = `0x${"c".repeat(40)}`;
const store = {
  incrementUsage: vi.fn(), recordPaymentOnce: vi.fn(), createA2aOrder: vi.fn(),
  getA2aOrder: vi.fn(), failA2aOrder: vi.fn(), completeA2aOrder: vi.fn(),
};
const preparedDeps = { db: store, gateway: {}, engine: {} };
let settlement: SettleInfo;

function request(responseMode: "wait" | "async" = "wait") {
  return new NextRequest("https://synthetic-owner.example/api/agent/ask", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer kx_live_synthetic",
      "payment-signature": "synthetic-signed-envelope", "cf-connecting-ip": "192.0.2.26",
      "user-agent": `synthetic-client-${forgedWallet}`, "x-wallet-address": forgedWallet },
    body: JSON.stringify({ question: "Synthetic ownership failure fixture", budget: 0.05, responseMode,
      asker: forgedWallet, payer: forgedWallet, walletAddress: forgedWallet, mcpClient: "synthetic-desktop",
      provenance: { version: 1, surface: "desktop", ownershipMethod: "session" } }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No outbound transport in ownership fixture"); }));
  mocks.verifyApiKey.mockResolvedValue({ walletAddress: keyWallet, keyId: "synthetic-key-id", scopes: "ask" });
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.getDb.mockResolvedValue(store);
  mocks.getAgentDeps.mockResolvedValue(preparedDeps);
  mocks.collectRun.mockRejectedValue(new Error("Synthetic research failure"));
  store.incrementUsage.mockResolvedValue(undefined);
  store.recordPaymentOnce.mockResolvedValue(true);
  store.getA2aOrder.mockResolvedValue(null);
  store.createA2aOrder.mockImplementation(async (order: A2aOrder) => ({ created: true, order }));
  store.failA2aOrder.mockResolvedValue(true);
  settlement = { payer, transaction: "synthetic-settlement", network: "eip155:5042002",
    authorizationId: `0x${"1".repeat(64)}`, amountUsdc: 0.1 };
  mocks.settleThenServe.mockImplementation(async (_req, _options, produce) => {
    try {
      const result = await produce(settlement);
      return result instanceof Response ? result : Response.json(result);
    } catch {
      return Response.json({ error: "paid resource unavailable after settlement" }, { status: 500 });
    }
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("keeps the established payer when a differently keyed, forged-client request fails research", async () => {
  const response = await POST(request());
  expect(response.status).toBe(500);
  const order = store.createA2aOrder.mock.calls[0][0] as A2aOrder;
  expect(order.payer).toBe(payer);
  expect(mocks.collectRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    queryId: order.queryId, asker: payer, fundingOwner: "treasury",
    provenance: { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" },
  }), { deps: preparedDeps });
  const input = mocks.collectRun.mock.calls[0][0];
  for (const field of ["payer", "walletAddress", "mcpClient", "userAgent", "ip"])
    expect(input).not.toHaveProperty(field);
  expect(store.failA2aOrder).toHaveBeenCalledExactlyOnceWith(order.id, "research_failed", expect.any(String));
  expect(store.completeA2aOrder).not.toHaveBeenCalled();
});

it("queues the established payer instead of the key wallet or claimed body owner", async () => {
  const response = await POST(request("async"));
  expect(response.status).toBe(202);
  const order = store.createA2aOrder.mock.calls[0][0] as A2aOrder;
  expect(order).toMatchObject({ payer, startedAt: null, workerId: null });
  for (const field of ["asker", "payer", "walletAddress", "mcpClient", "provenance"])
    expect(order.request).not.toHaveProperty(field);
  expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith("synthetic-key-id", "ask");
  expect(store.incrementUsage).toHaveBeenCalledExactlyOnceWith("synthetic-key-id");
  expect(mocks.collectRun).not.toHaveBeenCalled();
  expect(store.failA2aOrder).not.toHaveBeenCalled();
  expect(store.completeA2aOrder).not.toHaveBeenCalled();
  const body = await response.json();
  expect(body).toMatchObject({ status: "queued", queryId: order.queryId });
  for (const field of ["asker", "payer", "walletAddress", "mcpClient", "provenance"])
    expect(body).not.toHaveProperty(field);
});

it("records no owned order or run when the settlement callback lacks transaction evidence", async () => {
  settlement.transaction = "";
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(mocks.settleThenServe).toHaveBeenCalledOnce();
  expect(store.recordPaymentOnce).not.toHaveBeenCalled();
  expect(store.createA2aOrder).not.toHaveBeenCalled();
  expect(mocks.collectRun).not.toHaveBeenCalled();
  expect(store.failA2aOrder).not.toHaveBeenCalled();
  expect(store.completeA2aOrder).not.toHaveBeenCalled();
});
