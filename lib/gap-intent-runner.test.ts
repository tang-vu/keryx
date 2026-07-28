import { describe, expect, it } from "vitest";
import { demandGapId } from "./demand-signal";
import { classifyGapIntentRun } from "./gap-intent-runner";
import type { GapIntent, PaymentRecord, QueryRun } from "./types";

const CLAIM = "CCTP moves USDC across domains by burning and minting.";
const GAP_ID = demandGapId(CLAIM);

function intent(over: Partial<GapIntent> = {}): GapIntent {
  return {
    id: "intent-1",
    gapId: GAP_ID,
    claim: CLAIM,
    question: "How does CCTP move USDC?",
    failedQueryId: "failed-1",
    sourceId: "source-1",
    sourceItemLink: "https://example.com/cctp",
    ownerWallet: "0xabc",
    status: "running",
    attempts: 1,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...over,
  };
}

function run(over: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "retry-1",
    question: "How does CCTP move USDC?",
    budget: 0.05,
    engine: "llm:test",
    subClaims: [CLAIM],
    decisions: [],
    citations: [],
    evidence: [
      {
        claimIndex: 0,
        claim: CLAIM,
        marker: "S1",
        sourceId: "source-1",
        sourceName: "CCTP Notes",
        quote: "CCTP burns on the source domain and mints on the destination.",
        support: 0.8,
        qualifiesForReward: true,
      },
    ],
    claimCoverage: [
      { claimIndex: 0, claim: CLAIM, coverage: 0.8, coveredBy: ["S1"] },
    ],
    answer: "Answer [S1]",
    totalSpent: 0.025,
    totalToCreators: 0.025,
    trace: [],
    createdAt: "2026-07-28T00:01:00.000Z",
    retryOf: "failed-1",
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "citation",
    queryId: "retry-1",
    sourceId: "source-1",
    sourceName: "CCTP Notes",
    payer: "0xtreasury",
    payee: "0xabc",
    amountUsdc: 0.025,
    txHash: "settlement-evidence",
    network: "eip155:5042002",
    settled: true,
    createdAt: "2026-07-28T00:01:00.000Z",
    ...over,
  };
}

describe("classifyGapIntentRun", () => {
  it("fills only when target evidence and real settlement both exist", () => {
    expect(classifyGapIntentRun(intent(), run(), [payment()])).toEqual({
      status: "filled",
      coverage: 0.8,
      rewardUsdc: 0.025,
    });
  });

  it("does not treat simulated or missing settlement as fulfillment", () => {
    expect(
      classifyGapIntentRun(intent(), run(), [
        payment({ settled: false, txHash: null }),
      ]),
    ).toMatchObject({ status: "unpaid", coverage: 0.8, rewardUsdc: 0 });
  });

  it("does not let another source's evidence fill the offered source's claim", () => {
    const other = run({
      evidence: run().evidence!.map((item) => ({
        ...item,
        sourceId: "source-2",
      })),
    });
    expect(classifyGapIntentRun(intent(), other, [payment()])).toMatchObject({
      status: "missed",
    });
  });
});
