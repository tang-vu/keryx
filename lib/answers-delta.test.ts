import { describe, expect, it } from "vitest";

import { compareAnswerReceipts } from "./answers-delta";
import type { Citation, PaymentRecord, QueryRun } from "./types";

function citation(
  sourceId: string,
  sourceName: string,
  itemId: string,
  contentVersion: string,
): Citation {
  return {
    marker: `S${sourceId}`,
    sourceId,
    sourceName,
    itemId,
    itemTitle: `${sourceName} article`,
    contentVersion,
    weight: 1,
    reward: 0.01,
    rationale: "evidence",
  };
}

function run(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "run",
    question: "What changed?",
    budget: 0.05,
    engine: "llm:test",
    subClaims: ["Claim A"],
    decisions: [],
    citations: [],
    evidence: [],
    claimCoverage: [{ claimIndex: 0, claim: "Claim A", coverage: 0.4, coveredBy: [] }],
    answer: "Answer",
    totalSpent: 0.02,
    totalToCreators: 0.01,
    trace: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    confidence: { level: "Moderate", reason: "one source" },
    ...overrides,
  };
}

function payment(
  queryId: string,
  amountUsdc: number,
  status: PaymentRecord["settlementStatus"] = "settled",
): PaymentRecord {
  return {
    kind: "citation",
    queryId,
    sourceId: "a",
    sourceName: "Alpha",
    payer: "0xpayer",
    payee: "0xcreator",
    amountUsdc,
    network: "eip155:5042002",
    settled: status === "settled",
    settlementStatus: status,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("compareAnswerReceipts", () => {
  it("refuses to compare a genuine follow-up with different scope", () => {
    expect(compareAnswerReceipts(run(), run({ question: "Why did it change?" }))).toBeNull();
  });

  it("shows source, exact-version, coverage, confidence and payout movement", () => {
    const previous = run({
      id: "before",
      citations: [
        citation("a", "Alpha", "article-a", "sha256:old"),
        citation("b", "Beta", "article-b", "sha256:b"),
      ],
      evidence: [
        {
          claimIndex: 0,
          claim: "Claim A",
          marker: "Sa",
          sourceId: "a",
          sourceName: "Alpha",
          quote: "old evidence",
          support: 0.6,
          qualifiesForReward: true,
        },
      ],
      settledPayments: 1,
    });
    const current = run({
      id: "after",
      question: "  What changed?! ",
      citations: [
        citation("a", "Alpha", "article-a", "sha256:new"),
        citation("c", "Gamma", "article-c", "sha256:c"),
      ],
      claimCoverage: [{ claimIndex: 0, claim: "Claim A.", coverage: 0.8, coveredBy: ["Sa"] }],
      evidence: [],
      confidence: { level: "High", reason: "stronger evidence" },
      totalSpent: 0.03,
      totalToCreators: 0.018,
      settledPayments: 1,
    });

    const delta = compareAnswerReceipts(previous, current, {
      previous: [payment(previous.id, 0.01)],
      current: [payment(current.id, 0.018)],
    })!;
    expect(delta.addedSources.map((source) => source.sourceId)).toEqual(["c"]);
    expect(delta.removedSources.map((source) => source.sourceId)).toEqual(["b"]);
    expect(delta.retainedSources).toBe(1);
    expect(delta.changedAssets).toMatchObject([
      {
        sourceId: "a",
        kind: "version",
        previousVersion: "sha256:old",
        currentVersion: "sha256:new",
      },
    ]);
    expect(delta.coverage).toMatchObject({
      previousAverage: 0.4,
      currentAverage: 0.8,
      matchedClaims: 1,
      improvedClaims: 1,
      regressedClaims: 0,
    });
    expect(delta).toMatchObject({
      previousConfidence: "Moderate",
      currentConfidence: "High",
      previousEvidenceSpans: 1,
      currentEvidenceSpans: 0,
    });
    expect(delta.settlement?.previousTotalUsdc).toBeCloseTo(0.01);
    expect(delta.settlement?.currentTotalUsdc).toBeCloseTo(0.018);
    expect(delta.settlement?.deltaUsdc).toBeCloseTo(0.008);
  });

  it("shows an article replacement within the same retained publication", () => {
    const previous = run({ citations: [citation("a", "Alpha", "old-article", "sha256:old")] });
    const current = run({ citations: [citation("a", "Alpha", "new-article", "sha256:new")] });
    expect(compareAnswerReceipts(previous, current)?.changedAssets).toMatchObject([
      {
        sourceId: "a",
        kind: "article",
        previousItemId: "old-article",
        currentItemId: "new-article",
      },
    ]);
  });

  it("keeps historical receipts comparable when coverage and evidence ledgers are absent", () => {
    const previous = run({ claimCoverage: undefined, evidence: undefined });
    const current = run({ claimCoverage: undefined, evidence: undefined });
    expect(compareAnswerReceipts(previous, current)).toMatchObject({
      coverage: null,
      previousEvidenceSpans: null,
      currentEvidenceSpans: null,
    });
  });

  it("never presents simulated rows as settled creator money", () => {
    const previous = run({ paymentMode: "offline" });
    const current = run({ paymentMode: "offline" });
    const delta = compareAnswerReceipts(previous, current, {
      previous: [payment(previous.id, 0.01, "simulated")],
      current: [payment(current.id, 0.02, "simulated")],
    });
    expect(delta?.settlement).toEqual({
      previousTotalUsdc: 0,
      currentTotalUsdc: 0,
      deltaUsdc: 0,
    });
  });

  it("marks a real payout delta unprovable when a settled ledger row is missing", () => {
    const previous = run({ paymentMode: "real", settledPayments: 1 });
    const current = run({ paymentMode: "real", settledPayments: 1 });
    expect(
      compareAnswerReceipts(previous, current, {
        previous: [],
        current: [payment(current.id, 0.02)],
      })?.settlement,
    ).toBeNull();
  });

  it("accepts a formerly pending row after exact Circle reconciliation promotes it", () => {
    const previous = run({
      paymentMode: "real",
      totalSpent: 0,
      totalToCreators: 0,
      settledPayments: 0,
      pendingPayments: 1,
    });
    const current = run({
      paymentMode: "real",
      totalSpent: 0,
      totalToCreators: 0,
      settledPayments: 0,
      pendingPayments: 1,
    });
    const delta = compareAnswerReceipts(previous, current, {
      previous: [payment(previous.id, 0.002)],
      current: [payment(current.id, 0.003)],
    });
    expect(delta?.settlement).toMatchObject({
      previousTotalUsdc: 0.002,
      currentTotalUsdc: 0.003,
    });
  });
});
