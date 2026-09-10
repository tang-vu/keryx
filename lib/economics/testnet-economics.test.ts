import { describe, expect, it } from "vitest";
import type { QueryRun } from "../types";
import { calculateTestnetEconomics, economicsRunSample } from "./testnet-economics";

function run(
  id: string,
  fundingOwner: QueryRun["fundingOwner"],
  model = "deepseek-v4-flash",
): Partial<QueryRun> {
  return {
    id,
    researchMode: id === "quick" ? "quick" : "deep",
    fundingOwner,
    reasoningAttempts: [{
      step: "synthesize", engine: model.startsWith("deepseek") ? `llm:deepseek:${model}` : `llm:mimo:${model}`,
      tier: 0, attempt: 1, startedAt: 0, durationMs: 1, outcome: "served",
    }],
    llmUsage: [
      {
        engine: model.startsWith("deepseek") ? `llm:deepseek:${model}` : `llm:mimo:${model}`,
        model,
        inputTokens: 1_000_000,
        cachedInputTokens: 250_000,
        outputTokens: 500_000,
      },
    ],
  };
}

describe("testnet economics", () => {
  it("separates settled revenue, browser spend, treasury subsidy, and pending money", () => {
    const snapshot = calculateTestnetEconomics(
      [run("browser", "browser"), run("treasury", "treasury")],
      [
        { queryId: "treasury", kind: "inbound", amountUsdc: 0.02, settled: true, settlementStatus: "settled" },
        { queryId: "browser", kind: "fetch", amountUsdc: 0.01, settled: true, settlementStatus: "settled" },
        { queryId: "treasury", kind: "citation", amountUsdc: 0.02, settled: true, settlementStatus: "settled" },
        { queryId: "treasury", kind: "fetch", amountUsdc: 0.03, settled: false, settlementStatus: "pending" },
        { queryId: "treasury", kind: "inbound", amountUsdc: 9, settled: true, settlementStatus: "simulated" },
      ],
      new Date("2026-08-29T00:00:00.000Z"),
    );

    expect(snapshot.settledInboundRevenueUsdc).toBe(0.02);
    expect(snapshot.browserCreatorSpendUsdc).toBe(0.01);
    expect(snapshot.treasuryCreatorSubsidyUsdc).toBe(0.02);
    expect(snapshot.pendingCreatorSpendUsdc).toBe(0.03);
    expect(snapshot.pricedRuns).toBe(2);
    // Per run: .75m * .14 + .25m * .0028 + .5m * .28 = $0.2457.
    expect(snapshot.estimatedLlmCostUsd).toBe(0.4914);
    expect(snapshot.shadowServiceFeesUsdc).toBe(0.1);
    expect(snapshot.shadowGrossMarginUsd).toBe(-0.4014);
  });

  it("keeps historical and unknown-provider costs visibly incomplete", () => {
    const unknown = run("unknown", "treasury", "mimo-v2.5");
    const snapshot = calculateTestnetEconomics(
      [unknown, { id: "legacy", askerFunded: false }],
      [{ queryId: "legacy", kind: "fetch", amountUsdc: 1, settled: true, settlementStatus: "settled" }],
    );

    expect(snapshot.sampledRuns).toBe(1);
    expect(snapshot.pricedRuns).toBe(0);
    expect(snapshot.unpricedRuns).toBe(1);
    expect(snapshot.estimatedLlmCostUsd).toBe(0);
    expect(snapshot.unpricedModels).toEqual(["mimo-v2.5"]);
    expect(snapshot.unknownFundingCreatorSpendUsdc).toBe(1);
  });

  it("uses the payment grant epoch as direct browser-funding evidence", () => {
    const snapshot = calculateTestnetEconomics(
      [],
      [{
        queryId: "run-without-projection",
        kind: "fetch",
        amountUsdc: 0.012,
        settled: true,
        settlementStatus: "settled",
        grantEpoch: "browser-grant-v3",
      }],
    );
    expect(snapshot.browserCreatorSpendUsdc).toBe(0.012);
    expect(snapshot.unknownFundingCreatorSpendUsdc).toBe(0);
  });

  it("treats an explicitly measured heuristic-only run as priced zero-token work", () => {
    const snapshot = calculateTestnetEconomics([{
      id: "heuristic", engine: "heuristic", reasoningAttempts: [], llmUsage: [], researchMode: "quick",
    }], []);
    expect(snapshot).toMatchObject({ sampledRuns: 1, pricedRuns: 1, providerCalls: 0 });
    expect(snapshot.shadowGrossMarginUsd).toBe(0.015);
  });

  it("does not price a failed provider followed by heuristic fallback as free work", () => {
    const failed = run("fallback", "treasury");
    failed.llmUsage = [];
    failed.engine = "heuristic";
    failed.reasoningAttempts![0].outcome = "failed";
    failed.reasoningAttempts!.push({
      step: "synthesize", engine: "heuristic", tier: 1, attempt: 1,
      startedAt: 1, durationMs: 1, outcome: "served",
    });
    const sample = economicsRunSample(failed as QueryRun)!;
    expect(sample.usageCoverage).toBe("unknown");
    expect(sample).not.toHaveProperty("reasoningAttempts");
    expect(calculateTestnetEconomics([JSON.parse(JSON.stringify(sample))], [])).toMatchObject({
      pricedRuns: 0, unpricedRuns: 1, shadowGrossMarginUsd: 0,
    });
  });

  it("requires coverage for every served call and preserves it through the compact projection", () => {
    const measured = run("measured", "treasury");
    expect(calculateTestnetEconomics([economicsRunSample(measured as QueryRun)!], []).pricedRuns).toBe(1);
    measured.reasoningAttempts!.push({ ...measured.reasoningAttempts![0], step: "decide" });
    expect(calculateTestnetEconomics([economicsRunSample(measured as QueryRun)!], []).pricedRuns).toBe(0);
  });

  it("keeps old projections without attempt coverage unpriced, including empty usage", () => {
    const legacy = run("legacy", "treasury");
    delete legacy.reasoningAttempts;
    expect(calculateTestnetEconomics([legacy, { id: "empty", llmUsage: [] }], [])).toMatchObject({
      sampledRuns: 2, pricedRuns: 0, unpricedRuns: 2, shadowGrossMarginUsd: 0,
    });
  });

  it("does not invent provider cost for a circuit-open skip followed by local execution", () => {
    const skipped = run("skipped", "treasury");
    skipped.llmUsage = [];
    skipped.reasoningAttempts![0].outcome = "circuit-open";
    skipped.reasoningAttempts!.push({
      step: "synthesize", engine: "heuristic", tier: 1, attempt: 1,
      startedAt: 1, durationMs: 1, outcome: "served",
    });
    expect(calculateTestnetEconomics([economicsRunSample(skipped as QueryRun)!], [])).toMatchObject({
      pricedRuns: 1, unpricedRuns: 0, estimatedLlmCostUsd: 0,
    });
  });

  it("separates prepaid A2A creator spend from treasury subsidy", () => {
    const snapshot = calculateTestnetEconomics(
      [run("a2a-v2", "treasury")],
      [
        { queryId: "a2a-v2", kind: "inbound", amountUsdc: 0.1, settled: true, settlementStatus: "settled" },
        { queryId: "a2a-v2", kind: "citation", amountUsdc: 0.03, settled: true, settlementStatus: "settled" },
        { queryId: "a2a-v2", kind: "fetch", amountUsdc: 0.01, settled: false, settlementStatus: "pending" },
      ],
      new Date("2026-08-29T00:00:00.000Z"),
      [{
        queryId: "a2a-v2",
        creatorBudgetUsdc: 0.05,
        serviceFeeUsdc: 0.05,
        status: "completed",
        // Deliberately stale: the observatory must derive reserve from current ledger evidence.
        response: { pricing: { unusedCreatorReserveUsdc: 0.02 } },
      }],
    );
    expect(snapshot).toMatchObject({
      settledA2aV2ServiceFeesUsdc: 0.05,
      prepaidA2aCreatorCapsUsdc: 0.05,
      prepaidA2aCreatorSpendUsdc: 0.03,
      completedA2aUnusedReserveUsdc: 0.01,
      pendingCreatorSpendUsdc: 0.01,
      treasuryCreatorSubsidyUsdc: 0,
    });
  });
});
