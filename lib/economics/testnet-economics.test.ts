import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { describe, expect, it } from "vitest";
import type { QueryRun } from "../types";
import { calculateEconomics, calculateTestnetEconomics, economicsRunSample } from "./testnet-economics";
import { FLASH_POLICY } from "./provider-cost-policy";

function run(
  id: string,
  fundingOwner: QueryRun["fundingOwner"],
  model = "deepseek-v4-flash",
): Partial<QueryRun> {
  return {
    id,
    researchMode: id === "quick" ? "quick" : "deep",
    fundingOwner,
    llmCalls: [{ id: "call-1", engine: model.startsWith("deepseek") ? `llm:deepseek:${model}` : `llm:mimo:${model}`, outcome: "returned" }],
    reasoningAttempts: [{
      step: "synthesize", engine: model.startsWith("deepseek") ? `llm:deepseek:${model}` : `llm:mimo:${model}`,
      tier: 0, attempt: 1, startedAt: 0, durationMs: 1, outcome: "served",
    }],
    llmUsage: [
      {
        engine: model.startsWith("deepseek") ? `llm:deepseek:${model}` : `llm:mimo:${model}`,
        model,
        callId: "call-1",
        inputTokens: 1_000_000,
        cachedInputTokens: 250_000,
        outputTokens: 500_000,
        costCapture: { provider: model.startsWith("deepseek") ? "deepseek" : "mimo",
          requestStartedAt: "2026-09-30T01:00:00.000Z", responseReceivedAt: "2026-09-30T01:00:01.000Z",
          pricing: model.startsWith("deepseek") ? structuredClone({ ...FLASH_POLICY, wireModel: model }) : null },
      },
    ],
  };
}

describe("testnet economics", () => {
  it("rejects old complete projections and mismatched, duplicate or pending call evidence", () => {
    const measured = run("measured", "treasury");
    expect(calculateTestnetEconomics([{ ...measured, usageCoverage: "complete" }], []).pricedRuns).toBe(0);
    for (const outcome of ["pending", "failed"] as const) {
      const candidate = { ...measured, llmCalls: [{ ...measured.llmCalls![0], outcome }] };
      expect(economicsRunSample(candidate as QueryRun)?.usageCoverage).toBe("unknown");
    }
    for (const callId of [undefined, "unrelated"]) {
      const candidate = { ...measured, llmUsage: [{ ...measured.llmUsage![0], callId }] };
      expect(economicsRunSample(candidate as QueryRun)?.usageCoverage).toBe("unknown");
    }
    const duplicate = { ...measured, llmCalls: [measured.llmCalls![0], measured.llmCalls![0]],
      llmUsage: [measured.llmUsage![0], measured.llmUsage![0]] };
    expect(economicsRunSample(duplicate as QueryRun)?.usageCoverage).toBe("unknown");
    const historical = { ...measured, llmCalls: undefined };
    expect(economicsRunSample(historical as QueryRun)?.usageCoverage).toBe("unknown");
  });
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
    // Per run lower: .75m*.15 + .25m*.003 + .5m*.60 = .41325; peak is twice that.
    expect(snapshot.estimatedLlmCostUsdBounds).toEqual({ lower: expect.closeTo(0.8265, 5), upper: expect.closeTo(1.653, 5) });
    expect(snapshot.shadowServiceFeesAllSampledUsdc).toBe(0.1);
    expect(snapshot.shadowServiceFeesPricedRunsUsdc).toBe(0.1);
    expect(snapshot.shadowGrossMarginUsdBounds).toEqual({ lower: expect.closeTo(-1.563, 5), upper: expect.closeTo(-0.7365, 5) });
    expect(snapshot.pricingPolicyIds).toEqual([FLASH_POLICY.id]);
    expect(snapshot.costAndMarginScope).toBe("priced-runs-only");
    expect(snapshot.totalLlmCostUpperBoundUsd).toBeNull();
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
    expect(snapshot.estimatedLlmCostUsdBounds).toBeNull();
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
    expect(snapshot.shadowGrossMarginUsdBounds).toEqual({ lower: 0.015, upper: 0.015 });
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
      pricedRuns: 0, unpricedRuns: 1, shadowGrossMarginUsdBounds: null,
    });
  });

  it("requires coverage for every served call and preserves it through the compact projection", () => {
    const measured = run("measured", "treasury");
    expect(calculateTestnetEconomics([economicsRunSample(measured as QueryRun)!], []).pricedRuns).toBe(1);
    measured.llmCalls = [...measured.llmCalls!, { ...measured.llmCalls![0], id: "missing-usage" }];
    expect(calculateTestnetEconomics([economicsRunSample(measured as QueryRun)!], []).pricedRuns).toBe(0);
  });

  it("keeps old projections without attempt coverage unpriced, including empty usage", () => {
    const legacy = run("legacy", "treasury");
    delete legacy.reasoningAttempts;
    expect(calculateTestnetEconomics([legacy, { id: "empty", llmUsage: [] }], [])).toMatchObject({
      sampledRuns: 2, pricedRuns: 0, unpricedRuns: 2, shadowGrossMarginUsdBounds: null,
    });
  });

  it.each(["circuit-open", "input-limited"] as const)("does not invent provider cost for a %s skip followed by local execution", (outcome) => {
    const skipped = run("skipped", "treasury");
    skipped.llmUsage = [];
    skipped.llmCalls = [];
    skipped.reasoningAttempts![0].outcome = outcome;
    skipped.reasoningAttempts!.push({
      step: "synthesize", engine: "heuristic", tier: 1, attempt: 1,
      startedAt: 1, durationMs: 1, outcome: "served",
    });
    expect(calculateTestnetEconomics([economicsRunSample(skipped as QueryRun)!], [])).toMatchObject({
      pricedRuns: 1, unpricedRuns: 0, estimatedLlmCostUsdBounds: { lower: 0, upper: 0 },
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

it("mainnet observer retains exact settlement distinctions and refuses original-network or evidence gaps", () => {
  const row = { queryId: "synthetic", kind: "inbound" as const, amountUsdc: 0.05, settled: true,
    settlementStatus: "settled" as const, network: "eip155:5042", txHash: "synthetic-provider-evidence-not-live" };
  const snapshot = calculateEconomics(ARC_MAINNET_PROFILE, [], [row, { ...row, settled: false, settlementStatus: "pending" },
    { ...row, settlementStatus: "simulated" }]);
  expect(snapshot.network).toBe("eip155:5042"); expect(snapshot.label).toBe("mainnet-observatory");
  expect(snapshot.settledInboundRevenueUsdc).toBe(0.05); expect(snapshot.policy.id).toBe("mainnet-economics-v1");
  expect(() => calculateEconomics(ARC_MAINNET_PROFILE, [], [{ ...row, network: "eip155:5042002" }])).toThrow(/original-network/);
  expect(() => calculateEconomics(ARC_MAINNET_PROFILE, [], [{ ...row, network: undefined }])).toThrow(/original-network/);
  expect(() => calculateEconomics(ARC_MAINNET_PROFILE, [], [{ ...row, txHash: null }])).toThrow(/evidence/);
});
