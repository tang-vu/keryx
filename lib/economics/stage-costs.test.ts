import { expect, it } from "vitest";
import { summarizeStageCosts } from "./stage-costs";
import { capturePricePolicy } from "./provider-cost-policy";
import type { LlmUsageRecord } from "../llm/reasoning-engine";

function usage(): LlmUsageRecord {
  return { callId: "local-call", engine: "llm:deepseek:deepseek-flash", model: "deepseek-flash", stage: "sufficiency",
    inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100,
    costCapture: { provider: "deepseek", requestStartedAt: "2026-10-19T10:00:00Z", responseReceivedAt: "2026-10-19T10:00:01Z",
      pricing: capturePricePolicy("deepseek", "deepseek-flash") } };
}

it("aggregates captured stage costs and exposes failures without inventing zero cost", () => {
  const result = summarizeStageCosts([{ llmCalls: [
    { id: "local-call", engine: usage().engine, stage: "sufficiency", outcome: "returned" },
    { id: "failed", engine: usage().engine, stage: "decide", outcome: "failed" },
    { id: "pending", engine: usage().engine, stage: "decide", outcome: "pending" },
  ], llmUsage: [usage()] }]);
  expect(result.find(s => s.stage === "decide")).toMatchObject({ calls: 2, failedCalls: 1, pendingCalls: 1,
    missingUsageCalls: 2, pricedCostUsdBounds: null });
  const covered = result.find(s => s.stage === "sufficiency")!;
  expect(covered).toMatchObject({ calls: 1, usageRecords: 1, inputTokens: 1000, outputTokens: 100, unpricedUsageRecords: 0 });
  expect(covered.pricedCostUsdBounds!.lower).toBeCloseTo(.0001806);
  expect(covered.pricedCostUsdBounds!.upper).toBeCloseTo(.0003612);
});

it("keeps history unassigned and duplicate or missing-cache costs unknown", () => {
  const historical = usage(); delete historical.stage; delete historical.callId; delete historical.costCapture;
  const duplicate = usage(); const unknown = usage(); unknown.callId = "missing-cache"; unknown.cachedInputTokens = null;
  const rows = summarizeStageCosts([{ llmUsage: [historical, duplicate, structuredClone(duplicate), unknown] }]);
  expect(rows.find(r => r.stage === "unassigned")).toMatchObject({ usageRecords: 1, unpricedUsageRecords: 1, pricedCostUsdBounds: null });
  expect(rows.find(r => r.stage === "sufficiency")).toMatchObject({ usageRecords: 3, unpricedUsageRecords: 3, pricedCostUsdBounds: null });
});

it("does not join call IDs across runs or trust conflicting stage labels", () => {
  const u = usage();
  const rows = summarizeStageCosts([
    { llmCalls: [{ id: u.callId!, engine: u.engine, outcome: "returned", stage: "decide" }], llmUsage: [u] },
    { llmCalls: [{ id: u.callId!, engine: u.engine, outcome: "returned", stage: "sufficiency" }], llmUsage: [usage()] },
  ]);
  expect(rows.find(r => r.stage === "unassigned")).toMatchObject({ usageRecords: 1 });
  expect(rows.find(r => r.stage === "sufficiency")).toMatchObject({ usageRecords: 1, calls: 1 });
});
