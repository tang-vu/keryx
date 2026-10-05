import { describe, expect, it } from "vitest";
import type { PaymentRecord, QueryRun } from "../types";
import { gradeAgentRun } from "./grader";
import { AGENT_EVAL_CORPUS } from "./corpus";
import type { AgentEvalCase } from "./types";

const QUOTE = "The x402 flow starts when a server returns HTTP 402 with machine-readable payment terms.";
const frozenSource = (index: number, id: string) => {
  const fixture = AGENT_EVAL_CORPUS[0]!.sources[index]!;
  return {
    source: { ...fixture.source, id },
    items: fixture.items.map((item) => ({ ...item, id: `${id}-article`, sourceId: id })),
  };
};

const testCase: AgentEvalCase = {
  id: "unit", description: "grader unit fixture", question: "q", budget: 0.01,
  sources: [frozenSource(0, "good"), frozenSource(1, "bad")],
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
    evidence: [{ claimIndex: 0, claim: "claim", marker: "S1", sourceId: "good", sourceName: "good", itemId: "good-article", quote: QUOTE, support: 1, qualifiesForReward: true }],
    claimCoverage: [{ claimIndex: 0, claim: "claim", coverage: 1, coveredBy: ["S1"] }],
    answer: "answer [S1]", totalSpent: 0.005, totalToCreators: 0.005, trace: [],
    createdAt: new Date(0).toISOString(), paymentMode: "offline", settledPayments: 0, pendingPayments: 0,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "fetch", queryId: "r", sourceId: "good", sourceName: "good", itemId: "good-article", payer: "offline", payee: "creator",
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
  it("does not accept a fabricated quote even when the run declares full coverage", () => {
    const observed = run();
    observed.evidence![0]!.quote = "This fabricated payment guarantee is not in the frozen source.";
    const result = gradeAgentRun(testCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
    expect(result.metrics.evidenceYield).toBe(0);
    expect(result.hardFailures).toContain("evidence 0: quote is absent from the identified frozen source item or exceeds excerpt bounds");
  });
  it("does not borrow a different source's literal quote for an allowed citation", () => {
    const observed = run();
    observed.evidence![0] = { ...observed.evidence![0]!, sourceId: "bad", itemId: "bad-article",
      quote: testCase.sources[1]!.items[0]!.content };
    observed.totalSpent = observed.totalToCreators = 0.007;
    observed.decisions[1]!.action = "BUY";
    const bothReadCase = { ...testCase, expected: { ...testCase.expected,
      allowedReadSourceIds: ["good", "bad"], forbiddenReadSourceIds: [],
      decisions: { good: "BUY" as const, bad: "BUY" as const },
    } };
    const result = gradeAgentRun(bothReadCase, { run: observed, payments: [
      ...payments(), payment({ sourceId: "bad", itemId: "bad-article", amountUsdc: 0.002 }),
    ] });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
    expect(result.hardFailures).toContain("evidence 0: answer eligibility has no matching answer marker, citation identity or sufficient support");
  });
  it("requires a coverage marker to identify evidence for that same claim", () => {
    const result = gradeAgentRun(testCase, { run: run({ claimCoverage: [
      { claimIndex: 0, claim: "claim", coverage: 1, coveredBy: ["S999"] },
    ] }), payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
  it("cannot inflate grounded coverage by reporting the same claim twice", () => {
    const coverage = { claimIndex: 0, claim: "claim", coverage: 1, coveredBy: ["S1"] };
    const result = gradeAgentRun(testCase, { run: run({ claimCoverage: [coverage, coverage] }), payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBeLessThanOrEqual(1);
  });
  it("accepts normalized literal quotes and legacy records without item identity", () => {
    const observed = run();
    observed.evidence![0]!.quote = QUOTE.toUpperCase().replace("THE", "ＴＨＥ").replace(" STARTS ", "\nSTARTS\t");
    observed.evidence![0]!.itemId = undefined;
    const result = gradeAgentRun(testCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });
  it("does not borrow a quote from another item under the same source", () => {
    const extraItem = { ...testCase.sources[0]!.items[0]!, id: "good-appendix",
      content: "The appendix describes a different payment protocol than the selected article." };
    const multiItemCase = { ...testCase, sources: [
      { ...testCase.sources[0]!, items: [...testCase.sources[0]!.items, extraItem] }, testCase.sources[1]!,
    ] };
    const observed = run();
    observed.evidence![0]!.quote = extraItem.content;
    const result = gradeAgentRun(multiItemCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
  it("requires matching item identities when both evidence and citation provide them", () => {
    const observed = run();
    observed.citations[0]!.itemId = "another-item";
    const result = gradeAgentRun(testCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.evidenceYield).toBe(0);
  });
  it.each([NaN, Infinity, -1, 1.1])("rejects nonfinite or out-of-range coverage %s", (coverage) => {
    const result = gradeAgentRun(testCase, { run: run({ claimCoverage: [
      { claimIndex: 0, claim: "claim", coverage, coveredBy: ["S1"] },
    ] }), payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });
  it("does not transfer a valid evidence marker to a different claim", () => {
    const result = gradeAgentRun(testCase, { run: run({ subClaims: ["claim", "another claim"], claimCoverage: [
      { claimIndex: 1, claim: "another claim", coverage: 1, coveredBy: ["S1"] },
    ] }), payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
  it.each(["citation", "foreign-run"])("cannot verify an unread paid body using a %s record", (kind) => {
    const result = gradeAgentRun(testCase, { run: run(), payments: [
      payment({ kind: kind === "citation" ? "citation" : "fetch", queryId: kind === "foreign-run" ? "elsewhere" : "r", amountUsdc: 0.005 }),
    ] });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
    expect(result.hardFailures).toContain("evidence 0: paid frozen item has no matching fetch record for this run");
  });
  it("cannot use a paid fetch for one frozen item as proof of reading another", () => {
    const appendix = { ...testCase.sources[0]!.items[0]!, id: "good-appendix",
      content: "The appendix describes a different payment protocol than the selected article." };
    const multiItemCase = { ...testCase, sources: [
      { ...testCase.sources[0]!, items: [...testCase.sources[0]!.items, appendix] }, testCase.sources[1]!,
    ] };
    const observed = run();
    observed.evidence![0] = { ...observed.evidence![0]!, itemId: appendix.id, quote: appendix.content };
    observed.citations[0]!.itemId = appendix.id;
    const result = gradeAgentRun(multiItemCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
  it("does not treat a source-only fetch observation as item read provenance", () => {
    const legacyPayments = payments().map((entry) => ({ ...entry, itemId: undefined }));
    const result = gradeAgentRun(testCase, { run: run(), payments: legacyPayments });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
  it("admits answer evidence separately from reported reward eligibility", () => {
    const observed = run({ totalSpent: 0.001, totalToCreators: 0.001 });
    observed.citations[0]!.reward = 0;
    observed.evidence![0]!.qualifiesForAnswer = true;
    observed.evidence![0]!.qualifiesForReward = false;
    const result = gradeAgentRun(testCase, { run: observed, payments: [payment()] });
    expect(result.passed).toBe(true);
    expect(result.metrics.groundedClaimRate).toBe(1);
    expect(result.metrics.evidenceYield).toBe(0);
  });
  it("rejects answer markers without a matching cited evidence witness", () => {
    const result = gradeAgentRun(testCase, { run: run({ answer: "answer [S999]" }), payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
    expect(result.hardFailures).toContain("citation marker S999 has no verified answer evidence");
  });
  it("allows six-place reporting precision without permitting stronger coverage than evidence", () => {
    const observed = run();
    observed.evidence![0]!.support = 0.7000006;
    observed.claimCoverage![0]!.coverage = 0.700001;
    const partialCase = { ...testCase, expected: { ...testCase.expected, minGroundedClaimRate: 0.5 } };
    expect(gradeAgentRun(partialCase, { run: observed, payments: payments() }).passed).toBe(true);
    observed.claimCoverage![0]!.coverage = 0.8;
    const result = gradeAgentRun(partialCase, { run: observed, payments: payments() });
    expect(result.passed).toBe(false);
    expect(result.metrics.groundedClaimRate).toBe(0);
  });
});
