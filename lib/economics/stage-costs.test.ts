import { afterEach, expect, it, vi } from "vitest";
import { summarizeStageCosts } from "./stage-costs";
import { capturePricePolicy } from "./provider-cost-policy";
import type { LlmUsageRecord } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";
import { calculateTestnetEconomics, economicsRunSample } from "./testnet-economics";
import { privateEconomicsReport } from "./private-report";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { SupabaseAdapter } from "../db/supabase-adapter";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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

function recordedRun(): QueryRun {
  return { id: "synthetic-stage-ledger", question: "Synthetic accounting fixture", budget: 0,
    engine: usage().engine, subClaims: [], decisions: [], citations: [], answer: "Offline fixture",
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-19T10:00:01Z", paymentMode: "offline",
    llmCalls: [
      { id: "local-call", engine: usage().engine, stage: "sufficiency", outcome: "returned" },
      { id: "failed", engine: usage().engine, stage: "decide", outcome: "failed" },
      { id: "pending", engine: usage().engine, stage: "synthesize", outcome: "pending" },
    ], llmUsage: [usage()] };
}

it("detaches compact call records and preserves unknown historical or entirely unreported work", () => {
  const run = recordedRun(), sample = economicsRunSample(run)!;
  expect(sample.llmCalls).toEqual(run.llmCalls);
  sample.llmCalls![0].outcome = "failed";
  expect(run.llmCalls![0].outcome).toBe("returned");
  const historical = { ...run, llmCalls: undefined };
  expect(economicsRunSample(historical)).not.toHaveProperty("llmCalls");
  const unreported = { ...run, llmUsage: [] };
  const persisted = JSON.parse(JSON.stringify(economicsRunSample(unreported)));
  const report = privateEconomicsReport(calculateTestnetEconomics([persisted], []));
  expect(report.stageUsage).toHaveLength(3);
  expect(report.stageUsage.every(stage => stage.missingUsageCalls === 1 && stage.pricedCostUsdBounds === null)).toBe(true);
  expect(report.estimates.totalLlmCostUpperBoundUsd).toBeNull();
  expect(report.accounting.realizedProfitUsd).toBeNull();
});

it("retains failed and pending stage calls through the SQLite and Supabase storage/report paths", async () => {
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-stage.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-no-authority");
  const stored = new Map<string, unknown>();
  const http = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split("/").pop();
    expect(url.origin).toBe("https://synthetic-stage.invalid");
    expect(["query_runs", "payment_events", "a2a_orders"]).toContain(table);
    if (init?.method === "POST") {
      expect(table).toBe("query_runs");
      const row = JSON.parse(String(init.body)); stored.set(row.id, row);
      return new Response(null, { status: 201 });
    }
    return Response.json(table === "query_runs" ? [...stored.values()] : []);
  });
  vi.stubGlobal("fetch", http);
  const sqlite = new SqliteAdapter(":memory:");
  try {
    await sqlite.init();
    for (const db of [sqlite, new SupabaseAdapter()]) {
      await db.saveQueryRun(recordedRun());
      const report = privateEconomicsReport(await db.economics());
      expect(report.stageUsage).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: "sufficiency", calls: 1, usageRecords: 1, missingUsageCalls: 0 }),
        expect.objectContaining({ stage: "decide", calls: 1, failedCalls: 1, missingUsageCalls: 1, pricedCostUsdBounds: null }),
        expect.objectContaining({ stage: "synthesize", calls: 1, pendingCalls: 1, missingUsageCalls: 1, pricedCostUsdBounds: null }),
      ]));
      expect(report.coverage).toMatchObject({ pricedRuns: 0, unpricedRuns: 1 });
      expect(report.estimates.totalLlmCostUpperBoundUsd).toBeNull();
      expect(report.accounting.realizedProfitUsd).toBeNull();
    }
    expect(http).toHaveBeenCalled();
  } finally { sqlite.close(); }
});
