import { describe, expect, it } from "vitest";
import type { PaymentRecord, QueryRun } from "../types";
import { gradeAgentRun } from "./grader";
import type { AgentEvalCase } from "./types";

const testCase: AgentEvalCase = {
  id: "unit", description: "grader unit fixture", question: "q", budget: 0.01, sources: [],
  expected: {
    allowedCitationSourceIds: ["good"], requiredCitationSourceIds: ["good"],
    allowedReadSourceIds: ["good"], requiredReadSourceIds: ["good"], forbiddenReadSourceIds: ["bad"],
    decisions: { good: "BUY", bad: "SKIP" }, minGroundedClaimRate: 1,
  },
};

function run(over: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "r", question: "q", budget: 0.01, engine: "test", subClaims: ["claim"],
    decisions: [
      { sourceId: "good", sourceName: "good", action: "BUY", expectedValue: 1, price: 0.001, confidence: 1, rationale: "relevant", targets: [0] },
      { sourceId: "bad", sourceName: "bad", action: "SKIP", expectedValue: 0, price: 0.001, confidence: 1, rationale: "irrelevant", targets: [] },
    ],
    citations: [{ marker: "S1", sourceId: "good", sourceName: "good", weight: 1, reward: 0.004, rationale: "evidence" }],
    evidence: [{ claimIndex: 0, claim: "claim", marker: "S1", sourceId: "good", sourceName: "good", quote: "fact", support: 1, qualifiesForReward: true }],
    claimCoverage: [{ claimIndex: 0, claim: "claim", coverage: 1, coveredBy: ["S1"] }],
    answer: "answer [S1]", totalSpent: 0.005, totalToCreators: 0.005, trace: [],
    createdAt: new Date(0).toISOString(), paymentMode: "offline", settledPayments: 0, pendingPayments: 0,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "fetch", queryId: "r", sourceId: "good", sourceName: "good", payer: "offline", payee: "creator",
    amountUsdc: 0.001, network: "eip155:5042002", settled: false, settlementStatus: "simulated",
    createdAt: new Date(0).toISOString(), ...over,
  };
}

function payments(): PaymentRecord[] {
  return [payment(), payment({ kind: "citation", amountUsdc: 0.004 })];
}

describe("agent eval grader", () => {
  it("scores a grounded, budget-safe offline run", () => {
    const result = gradeAgentRun(testCase, { run: run(), payments: payments() });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });
  it("hard-fails real settlement evidence even when quality is perfect", () => {
    const result = gradeAgentRun(testCase, { run: run({ paymentMode: "real", settledPayments: 1 }), payments: [payment({ amountUsdc: 0.005, settled: true, settlementStatus: "settled", txHash: "0xreal" })] });
    expect(result.passed).toBe(false);
    expect(result.hardFailures).toContain("evaluation produced a settled payment");
    expect(result.hardFailures).toContain("payment ledger contains non-simulated settlement evidence");
  });
  it("detects forbidden reads and budget violations", () => {
    const result = gradeAgentRun(testCase, { run: run({ totalSpent: 0.02 }), payments: [payment({ sourceId: "bad" })] });
    expect(result.hardFailures).toContain("run exceeded the user budget");
    expect(result.hardFailures).toContain("forbidden source bad was read");
  });
});
