import { beforeEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), getOrder: vi.fn(), getDb: vi.fn(),
  rateLimit: vi.fn(), clientIp: vi.fn(), hostedReady: vi.fn(), settleThenServe: vi.fn(), challengeResponse: vi.fn() }));
vi.mock("./research-allowance", () => ({ configuredResearchAllowance: mocks.configured }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit, clientIp: mocks.clientIp }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settleThenServe, challengeResponse: mocks.challengeResponse }));
vi.mock("../payments/mainnet-hosted-gateway", async importOriginal => {
  const actual = await importOriginal<typeof import("../payments/mainnet-hosted-gateway")>();
  // Preserve real allowance/custody behavior for the helper tests; spy on the route boundary.
  mocks.hostedReady.mockImplementation(actual.assertMainnetHostedResearchReady);
  return { ...actual, assertMainnetHostedResearchReady: mocks.hostedReady };
});
import { assertMainnetHostedResearchReady } from "../payments/mainnet-hosted-gateway";
import { assertMonthlyExecutionReady, monthlyAdmissionQuote } from "../monthly/readiness";
import { runNextA2aOrder } from "../a2a/run-order";
import { paidResearchAdmissionResponse } from "./paid-admission";
import { GET as a2aQuote, POST as a2aPurchase } from "../../app/api/agent/ask/route";
import { POST as monthlyPurchase } from "../../app/api/research/monthly/route";
import { NextRequest } from "next/server";
import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { quoteResearchMonthly } from "../monthly/quote";

beforeEach(() => {
  vi.clearAllMocks(); mocks.configured.mockReturnValue({});
  mocks.getDb.mockResolvedValue({ getA2aOrder: mocks.getOrder });
  mocks.rateLimit.mockResolvedValue(null); mocks.clientIp.mockReturnValue("synthetic-maintenance-caller");
  const forbidden = () => { throw new Error("HTTP maintenance must precede payment challenge or settlement"); };
  mocks.settleThenServe.mockImplementation(forbidden); mocks.challengeResponse.mockImplementation(forbidden);
});
it("refuses new paid capacity and Monthly slots before touching custody or purchase admission", async () => {
  const admission = vi.fn();
  const db = { assertResearchPurchaseAuthority: admission } as unknown as KeryxDB;
  await expect(assertMainnetHostedResearchReady(db, "50000")).rejects.toThrow("paused");
  await expect(assertMainnetHostedResearchReady(db, "50000", "private")).rejects.toThrow("paused");
  await expect(monthlyAdmissionQuote(db)).rejects.toThrow("paused");
  await expect(assertMonthlyExecutionReady(db, 50000)).rejects.toThrow("paused");
  expect(admission).not.toHaveBeenCalled();
});
it("preserves already-paid queued work without claiming or failing it during the round", async () => {
  const claimNextA2aOrder = vi.fn(), failA2aOrder = vi.fn();
  const db = { claimNextA2aOrder, failA2aOrder } as unknown as Parameters<typeof runNextA2aOrder>[0];
  expect(await runNextA2aOrder(db, "worker")).toBeNull();
  expect(claimNextA2aOrder).not.toHaveBeenCalled(); expect(failA2aOrder).not.toHaveBeenCalled();
  mocks.configured.mockReturnValue(null); claimNextA2aOrder.mockResolvedValue(null);
  expect(await runNextA2aOrder(db, "worker")).toBeNull();
  expect(claimNextA2aOrder).toHaveBeenCalledOnce();
});
it("fails closed on changed/expired configuration before paid admission or worker claim", async () => {
  mocks.configured.mockImplementation(() => { throw new Error("Bounded allowance expired"); });
  await expect(assertMainnetHostedResearchReady({} as KeryxDB, "50000")).rejects.toThrow("expired");
  await expect(runNextA2aOrder({} as Parameters<typeof runNextA2aOrder>[0], "worker")).rejects.toThrow("expired");
});
it.each([ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE])("refuses $networkId HTTP admission before reading valid requests or touching side effects", async profile => {
  const prior = { networkId: config.networkId, profile: config.profile, sellerAddress: config.sellerAddress,
    funderKey: config.funderKey, defaultBudget: config.defaultBudget, a2aMaxBudget: config.a2aMaxBudget,
    a2aDeepFeeUsdc: config.a2aDeepFeeUsdc };
  Object.assign(config, { networkId: profile.networkId, profile, sellerAddress: `0x${"3".repeat(40)}`,
    funderKey: `0x${"7".repeat(64)}`, defaultBudget: 0.05, a2aMaxBudget: 0.5, a2aDeepFeeUsdc: 0.01 });
  try {
    const askBody = { question: "Explain how to retain original research payment evidence.", budget: 0.05,
      researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" };
    // Use the ordinary quote implementation, including its economic/schema validation.
    const monthlyBody = quoteResearchMonthly();
    const cases = [
      { handler: a2aQuote, request: new NextRequest("https://keryx.cc/api/agent/ask") },
      { handler: a2aPurchase, request: new NextRequest("https://keryx.cc/api/agent/ask", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(askBody) }) },
      { handler: monthlyPurchase, request: new NextRequest("https://keryx.cc/api/research/monthly", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(monthlyBody) }) },
    ];
    for (const { handler, request } of cases) {
      vi.clearAllMocks();
      const bodyRead = vi.spyOn(request, "json");
      const response = await handler(request);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.configured).toHaveBeenCalledExactlyOnceWith();
      expect(bodyRead).not.toHaveBeenCalled();
      expect(mocks.clientIp).not.toHaveBeenCalled(); expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.getOrder).not.toHaveBeenCalled();
      expect(mocks.hostedReady).not.toHaveBeenCalled();
      expect(mocks.challengeResponse).not.toHaveBeenCalled(); expect(mocks.settleThenServe).not.toHaveBeenCalled();
    }
  } finally { Object.assign(config, prior); }
});
it("hides protected policy failures in the paid HTTP maintenance response", async () => {
  mocks.configured.mockImplementation(() => { throw new Error("private-policy-path-and-digest"); });
  const response = paidResearchAdmissionResponse()!;
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-policy-path");
});
it("keeps the original A2A status lookup before the temporary admission guard", async () => {
  mocks.getOrder.mockResolvedValue(null);
  expect((await a2aQuote(new NextRequest(`https://keryx.cc/api/agent/ask?queryId=a2a_${"a".repeat(64)}`))).status).toBe(404);
  expect(mocks.getOrder).toHaveBeenCalledOnce(); expect(mocks.configured).not.toHaveBeenCalled();
});
