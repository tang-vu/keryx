import { describe, expect, it } from "vitest";
import { scorePurchases } from "./purchase-outcomes";
import { comparePurchaseScores, parsePurchaseScoreSummary, summarizePurchaseScores, type PurchaseObservation } from "./purchase-regression";

const rows = (cited: number, uncited: number, expectedValue: number): PurchaseObservation[] => [
  ...Array.from({ length: cited }, () => ({ expectedValue, cited: true })),
  ...Array.from({ length: uncited }, () => ({ expectedValue, cited: false }))];
const margins = { maxHitRateDrop: 0.05, maxCalibrationGapRise: 0.05, minScoredPurchases: 20 };

describe("pooled purchase score", () => {
  it("pools observations into hit rate, bands and a sample-weighted calibration gap", () => {
    const summary = summarizePurchaseScores([...rows(3, 1, 0.9), ...rows(1, 3, 0.3), { expectedValue: 1, cited: true }]);
    expect(summary).toMatchObject({ scoredPurchases: 9, citedPurchases: 5, hitRate: 5 / 9 });
    expect(summary.calibration.map(band => [band.samples, band.cited])).toEqual([[0, 0], [4, 1], [0, 0], [0, 0], [5, 4]]);
    expect(summary.calibration[4].predictedMean).toBeCloseTo(0.92);
    expect(summary.calibrationGap).toBeCloseTo((4 * Math.abs(0.3 - 0.25) + 5 * Math.abs(0.92 - 0.8)) / 9);
    expect(summarizePurchaseScores([])).toMatchObject({ scoredPurchases: 0, hitRate: null, calibrationGap: null });
    expect(parsePurchaseScoreSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
    expect(() => summarizePurchaseScores([{ expectedValue: 1.2, cited: true }])).toThrow();
    expect(() => summarizePurchaseScores([{ expectedValue: 0.5, cited: "yes" as never }])).toThrow();
  });

  it("bands every boundary exactly like the per-dispatch scorer", () => {
    for (const expectedValue of [0, 0.2, 0.4, 0.6, 0.8, 1, 0.19999999999999998, 0.5999999999999999, 0.7999999999999999]) {
      const scored = scorePurchases({ id: "run", answer: "Answer", citations: [],
        decisions: [{ sourceId: "s", itemId: "i", contentVersion: "v", sourceName: "S", action: "BUY", expectedValue, price: 0.002,
          confidence: 1, rationale: "r", targets: [] }] },
      [{ id: "p", queryId: "run", network: "eip155:5042002", kind: "fetch", sourceId: "s", itemId: "i", contentVersion: "v",
        amountUsdc: 0.002, settled: true, settlementStatus: "settled", txHash: "0xabc" } as never], "eip155:5042002");
      expect(summarizePurchaseScores([{ expectedValue, cited: false }]).calibration.map(band => band.samples))
        .toEqual(scored.calibration.map(band => band.samples));
    }
  });

  it("refuses summaries whose rates do not follow from their counts", () => {
    const summary = summarizePurchaseScores(rows(6, 4, 0.7));
    for (const bad of [{ ...summary, hitRate: 0.9 }, { ...summary, citedPurchases: 7 }, { ...summary, calibrationGap: 0 },
      { ...summary, extra: true }, { ...summary, calibration: summary.calibration.slice(1) },
      { ...summary, calibration: summary.calibration.map(band => band.samples ? { ...band, predictedMean: 0.1 } : band) },
      { ...summary, calibration: summary.calibration.map(band => band.samples ? { ...band, cited: 11 } : band) }])
      expect(() => parsePurchaseScoreSummary(bad)).toThrow();
  });
});

describe("release comparison", () => {
  const baseline = summarizePurchaseScores(rows(14, 6, 0.7));   // hit rate 0.70, gap 0.00
  it("passes inside the stated margins and flags a worse hit rate or calibration", () => {
    expect(comparePurchaseScores(baseline, summarizePurchaseScores(rows(13, 7, 0.7)), margins))
      .toMatchObject({ status: "pass", reasons: [], hitRateChange: expect.closeTo(-0.05), calibrationGapChange: expect.closeTo(0.05) });
    expect(comparePurchaseScores(baseline, summarizePurchaseScores(rows(12, 8, 0.7)), margins))
      .toMatchObject({ status: "flagged", reasons: ["hit-rate-fell", "calibration-gap-rose"] });
    // The same citations with over-confident predictions: hit rate holds, calibration does not.
    expect(comparePurchaseScores(baseline, summarizePurchaseScores(rows(14, 6, 0.95)), margins))
      .toMatchObject({ status: "flagged", reasons: ["calibration-gap-rose"], hitRateChange: 0 });
    expect(comparePurchaseScores(baseline, summarizePurchaseScores(rows(20, 0, 0.99)), margins).status).toBe("pass");
  });

  it("never passes a comparison it cannot evaluate", () => {
    const small = summarizePurchaseScores(rows(19, 0, 0.9)), empty = summarizePurchaseScores([]);
    expect(comparePurchaseScores(baseline, small, margins))
      .toMatchObject({ status: "not-evaluable", reasons: ["candidate-sample-too-small"], hitRateChange: null, calibrationGapChange: null });
    expect(comparePurchaseScores(empty, empty, margins))
      .toMatchObject({ status: "not-evaluable", reasons: ["baseline-sample-too-small", "candidate-sample-too-small"] });
  });

  it("requires every margin to be stated and valid", () => {
    for (const bad of [{}, { ...margins, minScoredPurchases: 0 }, { ...margins, maxHitRateDrop: -0.1 }, { ...margins, maxCalibrationGapRise: 2 },
      { maxHitRateDrop: 0.05, minScoredPurchases: 20 }, { ...margins, extra: 1 }, { ...margins, minScoredPurchases: 2.5 }])
      expect(() => comparePurchaseScores(baseline, baseline, bad as never)).toThrow("Explicit regression margins required");
    expect(() => comparePurchaseScores({ ...baseline, hitRate: 1 }, baseline, margins)).toThrow();
  });
});
