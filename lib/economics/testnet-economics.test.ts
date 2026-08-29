import { describe, expect, it } from "vitest";
import type { QueryRun } from "../types";
import { calculateTestnetEconomics } from "./testnet-economics";

function run(
  id: string,
  fundingOwner: QueryRun["fundingOwner"],
  model = "deepseek-v4-flash",
): Partial<QueryRun> {
  return {
    id,
    researchMode: id === "quick" ? "quick" : "deep",
    fundingOwner,
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
    const snapshot = calculateTestnetEconomics([{ id: "heuristic", llmUsage: [], researchMode: "quick" }], []);
    expect(snapshot).toMatchObject({ sampledRuns: 1, pricedRuns: 1, providerCalls: 0 });
    expect(snapshot.shadowGrossMarginUsd).toBe(0.015);
  });
});
