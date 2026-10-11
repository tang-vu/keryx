import { describe, expect, it } from "vitest";
import { planLearnedPortfolio } from "./source-learning-planner";
import type { SourceLearningReport } from "../research/source-learning-contract";
import type { Decision } from "../types";

function decision(sourceId: string, value: number, price = 0.001): Decision {
  return { sourceId, sourceName: sourceId, action: "BUY", expectedValue: value, price, confidence: 0.8, targets: [0], rationale: "Preview relevance." };
}
function record(bought: number, cited: number, shiftFlag = false): SourceLearningReport["records"][number] {
  return { topic: "x402", bought, cited, offered: bought, read: bought, cached: 0, averagePriceMicros: { numerator: String(bought * 1000), denominator: bought },
    smoothedCitationRate: bought ? (cited + 1) / (bought + 2) : null, uncertainty: bought ? 1 / Math.sqrt(bought + 2) : null,
    averageContribution: bought ? cited * 0.8 / bought : null, shiftFlag, firstObservedAt: null, lastObservedAt: null };
}
const plan = (decisions: Decision[], records: Map<string, ReturnType<typeof record>>, options = {}) => planLearnedPortfolio({
  decisions, records, fetchBudgetMicros: "1000", explorationFractionBps: 0, attentionLimit: 1, claimCount: 1, ...options });
describe("prospective outcome-learning portfolio (not active live)", () => {
  it("changes actual planned purchase rate in a controlled repeated-record replay and cites that record", () => {
    const purchaseRates = (candidate: Decision, cited: boolean) => Array.from({ length: 20 }, (_, i) => {
      const result = plan([candidate, decision("neutral", 0.5)], new Map([[candidate.sourceId, record(i, cited ? i : 0)], ["neutral", record(10, 5)]]),
        { fetchBudgetMicros: "10000", explorationFractionBps: cited ? 0 : 1000 });
      const d = result.decisions.find(d => d.sourceId === candidate.sourceId)!;
      if (i >= 5) expect(d.rationale).toContain(`Bought ${i} times and cited ${cited ? i : 0} times`);
      return d.action === "BUY" ? 1 : 0;
    });
    const uncited = purchaseRates(decision("uncited", 0.52), false), cited = purchaseRates(decision("cited", 0.48), true);
    expect(uncited.slice(0, 5).reduce<number>((a, b) => a + b, 0)).toBe(5);
    expect(uncited.slice(5).reduce<number>((a, b) => a + b, 0)).toBe(0);
    expect(cited.slice(0, 5).reduce<number>((a, b) => a + b, 0)).toBe(0);
    expect(cited.slice(5).reduce<number>((a, b) => a + b, 0)).toBe(15);
    const before = plan([decision("cited", 0.48), decision("neutral", 0.5)], new Map([["cited", record(5, 0)], ["neutral", record(10, 5)]]));
    const after = plan([decision("cited", 0.48), decision("neutral", 0.5)], new Map([["cited", record(15, 15)], ["neutral", record(10, 5)]]));
    expect(before.selectedAssetIds).toEqual(["neutral"]); expect(after.selectedAssetIds).toEqual(["cited"]);
  });
  it("enforces the stated exact exploration fraction, budget and original SKIP even with highly valued new sources", () => {
    const result = plan([decision("new-a", 1), decision("new-b", 1), decision("known", 0.9), { ...decision("model-skip", 1), action: "SKIP" }],
      new Map([["known", record(10, 10)]]), { fetchBudgetMicros: "19999", explorationFractionBps: 1000, attentionLimit: 4 });
    expect(result.explorationAllowanceMicros).toBe("1999"); expect(result.explorationSpentMicros).toBe("1000");
    expect(BigInt(result.spentMicros)).toBeLessThanOrEqual(BigInt(19999));
    expect(result.decisions.find(d => d.sourceId === "model-skip")?.action).toBe("SKIP");
    expect(result.decisions.filter(d => d.sourceId.startsWith("new") && d.action === "BUY")).toHaveLength(1);
    const expensive = plan([decision("over-budget", 1, 1)], new Map([["over-budget", record(60, 60)]]));
    expect(expensive.spentMicros).toBe("0"); expect(expensive.selectedAssetIds).toEqual([]);
    expect(() => plan([], new Map(), { fetchBudgetMicros: "9007199254740992" })).toThrow();
  });
  it("damps an abrupt shift and cannot manufacture another canonical-document read", () => {
    const d = decision("known", 0.5);
    const normal = plan([d], new Map([[d.sourceId, record(10, 10)]]));
    const damped = plan([d], new Map([[d.sourceId, record(10, 10, true)]]));
    expect(damped.decisions[0].expectedValue - 0.5).toBeCloseTo((normal.decisions[0].expectedValue - 0.5) / 2);
    expect(damped.decisions[0].rationale).toContain("shift flagged");
    const aliases = plan([{ ...decision("new", 0.6), itemUrl: "https://canonical.example/article" },
      { ...decision("known", 0.9), itemUrl: "https://canonical.example/article" }], new Map([["known", record(10, 10)]]),
      { fetchBudgetMicros: "10000", explorationFractionBps: 1000, attentionLimit: 2 });
    expect(aliases.selectedAssetIds).toHaveLength(1);
  });
});
