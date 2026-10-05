import { beforeEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), getOrder: vi.fn() }));
vi.mock("./research-allowance", () => ({ configuredResearchAllowance: mocks.configured }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ getA2aOrder: mocks.getOrder }) }));
import { assertMainnetHostedResearchReady } from "../payments/mainnet-hosted-gateway";
import { assertMonthlyExecutionReady, monthlyAdmissionQuote } from "../monthly/readiness";
import { runNextA2aOrder } from "../a2a/run-order";
import { paidResearchAdmissionResponse } from "./paid-admission";
import { GET as a2aQuote, POST as a2aPurchase } from "../../app/api/agent/ask/route";
import { POST as monthlyPurchase } from "../../app/api/research/monthly/route";
import { NextRequest } from "next/server";
import { config } from "../config";

beforeEach(() => { vi.clearAllMocks(); mocks.configured.mockReturnValue({}); });
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
it.each(["eip155:5042", "eip155:5042002"])("withholds paid HTTP admission on %s and hides protected policy failures", async networkId => {
  const prior = config.networkId; Object.assign(config, { networkId });
  try {
  const req = new NextRequest("https://keryx.cc/api/agent/ask", { method: "POST", body: "{}" });
  expect((await a2aQuote(new NextRequest("https://keryx.cc/api/agent/ask"))).status).toBe(503);
  expect((await a2aPurchase(req)).status).toBe(503);
  expect((await monthlyPurchase(new NextRequest("https://keryx.cc/api/research/monthly", { method: "POST", body: "{}" }))).status).toBe(503);
  mocks.configured.mockImplementation(() => { throw new Error("private-policy-path-and-digest"); });
  const response = paidResearchAdmissionResponse()!;
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-policy-path");
  } finally { Object.assign(config, { networkId: prior }); }
});
it("keeps the original A2A status lookup before the temporary admission guard", async () => {
  mocks.getOrder.mockResolvedValue(null);
  expect((await a2aQuote(new NextRequest(`https://keryx.cc/api/agent/ask?queryId=a2a_${"a".repeat(64)}`))).status).toBe(404);
  expect(mocks.getOrder).toHaveBeenCalledOnce(); expect(mocks.configured).not.toHaveBeenCalled();
});
