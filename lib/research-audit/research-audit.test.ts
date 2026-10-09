import { describe, expect, it } from "vitest";
import type { Decision, PaymentRecord, QueryRun } from "../types";
import { decimalMicros, micros } from "./exact-units";
import { classifyUsage, historicalUsage, publicHistoryIncludes } from "./usage-cohort";
import { canonicalDecisionRecord, createDecisionRecord, decisionRecordHash, replayReadPolicy, verifyDecisionRecord,
  type ReadPolicyInput } from "./decision-record";
import { scorePurchases, type PurchaseOutcome } from "./purchase-outcomes";
import { explorationAllowance, learnedValue, reserveExploration, sourceLearningRecord, type LearningObservation } from "./source-learning";
import { summarizeUsage, type AuditUsageRun } from "./usage-summary";

const input = (patch: Partial<ReadPolicyInput> = {}): ReadPolicyInput => ({ candidateId: "item:one", proposal: "BUY",
  priceMicros: "1", budgetRemainingMicros: "10", priceCeilingMicros: "10", attentionRemaining: 2,
  eligible: true, external: false, cacheFresh: false, sufficient: false, requiresApproval: false, ...patch });
const decision = (patch: Partial<Decision> = {}): Decision => ({ sourceId: "source", assetId: "item:one", itemId: "one",
  contentVersion: "sha256:one", sourceName: "Source", action: "BUY", expectedValue: 0.8, price: 0.000001,
  confidence: 0.9, rationale: "private question is not copied into audit output", targets: [0], ...patch });
const payment = (patch: Partial<PaymentRecord> = {}): PaymentRecord => ({ id: "payment:one", kind: "fetch", queryId: "run",
  sourceId: "source", sourceName: "Source", itemId: "one", contentVersion: "sha256:one", payer: "0x" + "1".repeat(40), payee: "0x" + "2".repeat(40),
  amountUsdc: 0.000001, network: "eip155:5042002", settled: true, settlementStatus: "settled", txHash: "recorded-circle-id",
  createdAt: "2026-10-09T00:00:00.000Z", ...patch });
const run = (patch: Partial<QueryRun> = {}): QueryRun => ({ id: "run", question: "private", budget: 1, engine: "fixture",
  subClaims: [], decisions: [decision()], citations: [], answer: "Recorded completed answer", totalSpent: 0.000001,
  totalToCreators: 0.000001, trace: [], createdAt: "2026-10-09T00:00:00.000Z", ...patch });

describe("exact audit amounts", () => {
  it("preserves sub-cent, scientific notation and amounts above Number safe integers", () => {
    expect(decimalMicros(0.000001)).toBe("1"); expect(decimalMicros(0.000011)).toBe("11");
    expect(decimalMicros(1.234567)).toBe("1234567"); expect(micros("9007199254740993").toString()).toBe("9007199254740993");
  });
  it("refuses fractional micro amounts rather than rounding authority up", () => {
    expect(decimalMicros(0.0000005)).toBeNull(); expect(decimalMicros(0.1 + 0.2)).toBeNull();
    expect(decimalMicros(NaN)).toBeNull(); expect(() => micros("01")).toThrow(); expect(() => micros("-1")).toThrow();
  });
});
describe("cohort/funding boundaries (#249)", () => {
  it("keeps unknown history conservative regardless of execution channel", () => {
    expect(historicalUsage()).toEqual({ cohort: "unknown", payment: "unknown" });
    expect(classifyUsage({ actor: "unknown", funding: "independent", scripted: false }).payment).toBe("unknown");
  });
  it("separates independently funded, sponsored and treasury-funded outside activity", () => {
    expect(classifyUsage({ actor: "outside", funding: "independent", scripted: false })).toEqual({ cohort: "outside", payment: "independent" });
    expect(classifyUsage({ actor: "outside", funding: "sponsored", scripted: false })).toEqual({ cohort: "outside", payment: "sponsored" });
    expect(classifyUsage({ actor: "outside", funding: "treasury", scripted: false })).toEqual({ cohort: "outside", payment: "team" });
  });
  it("scripted/team callers never become outside payers", () => {
    expect(classifyUsage({ actor: "outside", funding: "independent", scripted: true })).toEqual({ cohort: "scripted", payment: "team" });
    expect(classifyUsage({ actor: "team", funding: "independent", scripted: false })).toEqual({ cohort: "team", payment: "team" });
    expect(publicHistoryIncludes("scripted")).toBe(false); expect(publicHistoryIncludes("unknown", true)).toBe(false);
    expect(publicHistoryIncludes("outside", true)).toBe(true);
  });
  it("refuses malformed metadata", () => {
    expect(() => classifyUsage({ actor: "web", funding: "independent", scripted: false } as never)).toThrow();
  });
});
describe("explicit usage corpus (#249)", () => {
  const usageRun = (id: string, patch: Partial<AuditUsageRun> = {}): AuditUsageRun => ({ id, network: "eip155:5042002",
    createdAt: "2026-10-09T00:00:00.000Z", classification: { cohort: "outside", payment: "independent" }, ...patch });
  const summary = (runs: AuditUsageRun[], payments: PaymentRecord[]) => summarizeUsage({ network: "eip155:5042002",
    since: "2026-10-08T00:00:00.000Z", until: "2026-10-10T00:00:00.000Z", runs, payments });
  it("keeps four columns, funding labels, explicit rules and observed latency/acceptance denominators", () => {
    const result = summary([usageRun("run", { actorId: "verified:one", accepted: true, timeToFirstAnswerMs: 10 }),
      usageRun("sponsored", { classification: { cohort: "outside", payment: "sponsored" }, timeToFirstAnswerMs: 20 }),
      usageRun("scripted", { classification: { cohort: "scripted", payment: "team" } }),
      usageRun("legacy", { classification: historicalUsage() })],
      [payment(), payment({ id: "sponsored-payment", queryId: "sponsored" }), payment({ id: "simulation", settled: false, settlementStatus: "simulated" })]);
    expect(result.columns.map(column => column.cohort)).toEqual(["outside", "team", "scripted", "unknown"]);
    expect(result.columns[0]).toMatchObject({ people: 1, researchRuns: 2, payingRuns: 2, independentPayingRuns: 1,
      sponsoredPayingRuns: 1, settledMicros: "2", acceptedDeliverables: 1, acceptanceSamples: 1,
      medianTimeToFirstAnswerMs: 15, timeToFirstAnswerSamples: 2 });
    expect(result.columns[3].researchRuns).toBe(1); expect(result.excludedPayments).toBe(1);
    expect(result.basis).toBe("supplied-corpus-not-production-query"); expect(result.periodRule).toContain("run-created-at");
  });
  it("does not merge networks, periods or empty samples", () => {
    const result = summary([usageRun("foreign", { network: "eip155:5042" }),
      usageRun("old", { createdAt: "2026-10-07T00:00:00.000Z" }), usageRun("until", { createdAt: "2026-10-10T00:00:00.000Z" })], [payment()]);
    expect(result.columns[0].researchRuns).toBe(0); expect(result.columns[0].medianTimeToFirstAnswerMs).toBeNull();
  });
  it("does not count zero-value settlement rows as paying users or paid creators", () => {
    const result = summary([usageRun("run")], [payment({ amountUsdc: 0 })]);
    expect(result.columns[0]).toMatchObject({ payingRuns: 0, independentPayingRuns: 0, creatorsPaid: 0, settledMicros: "0" });
    expect(result.excludedPayments).toBe(1);
  });
  it("refuses duplicate run identities, invalid periods and purported outside payer on unknown origin", () => {
    expect(() => summary([usageRun("run"), usageRun("run")], [])).toThrow();
    expect(() => summary([usageRun("run", { classification: { cohort: "unknown", payment: "independent" } })], [])).toThrow();
    expect(() => summarizeUsage({ network: "arc", since: "now", until: "later", runs: [], payments: [] })).toThrow();
  });
});
describe("canonical policy replay (#301)", () => {
  it.each([
    [{}, "BUY", "1"], [{ proposal: "SKIP", cacheFresh: true }, "SKIP", "0"],
    [{ proposal: "CACHE", cacheFresh: true }, "CACHE", "0"], [{ proposal: "CACHE" }, "BUY", "1"],
    [{ external: true }, "SKIP", "0"], [{ eligible: false }, "SKIP", "0"],
    [{ attentionRemaining: 0 }, "STOP", "0"], [{ sufficient: true }, "STOP", "0"],
    [{ requiresApproval: true }, "ESCALATE", "0"], [{ proposal: "ESCALATE" }, "ESCALATE", "0"],
    [{ priceMicros: "11" }, "SKIP", "0"], [{ budgetRemainingMicros: "0" }, "SKIP", "0"],
  ] as const)("replays gates %j as %s reserving %s", (patch, action, reservedMicros) => {
    expect(replayReadPolicy(input(patch))).toMatchObject({ action, reservedMicros });
  });
  it("verifies separately retained digest and fails changed inputs/outcomes", async () => {
    const record = createDecisionRecord(input()), digest = await decisionRecordHash(record);
    expect(await verifyDecisionRecord(record, digest)).toBe(true);
    expect(await verifyDecisionRecord({ ...record, input: input({ priceMicros: "2" }) }, digest)).toBe(false);
    const altered = { ...record, outcome: { ...record.outcome, reservedMicros: "2" } };
    expect(await verifyDecisionRecord(altered, await decisionRecordHash(altered))).toBe(false);
  });
  it("canonicalizes key order without retaining arbitrary question/rationale/model text", () => {
    const record = createDecisionRecord(input());
    expect(canonicalDecisionRecord({ outcome: record.outcome, input: record.input, policy: record.policy, schema: record.schema }))
      .toBe(canonicalDecisionRecord(record));
    expect(() => canonicalDecisionRecord({ ...record, question: "secret" })).toThrow();
    expect(() => createDecisionRecord({ ...input(), rationale: "secret" } as never)).toThrow();
    expect(() => createDecisionRecord(input({ candidateId: "https://host/?private=question" }))).toThrow();
  });
  it("refuses a record replaced while asynchronous digest verification is pending", async () => {
    const record = createDecisionRecord(input()), digest = await decisionRecordHash(record);
    const pending = verifyDecisionRecord(record, digest);
    const replacement = createDecisionRecord(input({ priceMicros: "2" }));
    record.input = replacement.input; record.outcome = replacement.outcome;
    expect(await pending).toBe(false);
  });
  it("refuses accessors, oversized integer strings, invalid flags and future policy", () => {
    const malicious = { ...input() }; Object.defineProperty(malicious, "proposal", { get() { throw new Error("accessor invoked"); } });
    expect(() => createDecisionRecord(malicious)).toThrow("Unexpected or missing");
    expect(() => createDecisionRecord(input({ priceMicros: "1".repeat(31) }))).toThrow();
    expect(() => createDecisionRecord(input({ eligible: "yes" } as never))).toThrow();
    expect(() => canonicalDecisionRecord({ ...createDecisionRecord(input()), policy: "v2" })).toThrow();
  });
  it("reserves exact huge amounts without floating point arithmetic", () => {
    expect(replayReadPolicy(input({ priceMicros: "9007199254740993", budgetRemainingMicros: "9007199254740994", priceCeilingMicros: "9007199254740993" })).reservedMicros)
      .toBe("9007199254740993");
  });
});
describe("recorded purchase outcomes (#298)", () => {
  it("scores settled access against exact-version citations, with exact rewards", () => {
    const citation = { ...decision(), marker: "S1", weight: 0.7, reward: 999 };
    const result = scorePurchases(run({ citations: [citation] }), [payment(), payment({ id: "reward", kind: "citation", amountUsdc: 0.000007 })], "eip155:5042002");
    expect(result.hitRate).toBe(1); expect(result.purchases[0]).toMatchObject({ contributionWeight: 0.7, settledRewardMicros: "7" });
    expect(result.missedValue).toBeNull(); expect(result.costPerSupportedClaim).toBeNull();
  });
  it.each([
    { settlementStatus: "pending", settled: false }, { settlementStatus: "simulated", settled: false },
    { settlementStatus: "failed", settled: false }, { settlementStatus: undefined }, { txHash: null },
    { network: "eip155:5042" }, { queryId: "foreign" }, { contentVersion: "other" }, { id: undefined },
  ] as Partial<PaymentRecord>[])("excludes non-proven/mismatched payment %j", patch => {
    const result = scorePurchases(run(), [payment(patch)], "eip155:5042002");
    expect(result.purchases).toHaveLength(0); expect(result.hitRate).toBeNull(); expect(result.excludedPayments).toBe(1);
  });
  it("does not confuse another version, planned rewards or duplicate payment rows with an outcome", () => {
    const result = scorePurchases(run({ citations: [{ ...decision({ contentVersion: "new" }), marker: "S1", weight: 1, reward: 10 }] }),
      [payment(), payment()], "eip155:5042002");
    expect(result.hitRate).toBe(0); expect(result.uncitedAccessMicros).toBe("1");
    expect(result.purchases[0].settledRewardMicros).toBe("0"); expect(result.excludedPayments).toBe(1);
  });
  it("requires a completed answer and leaves unsupported legacy identities unscored", () => {
    expect(() => scorePurchases(run({ answer: "" }), [payment()], "eip155:5042002")).toThrow();
    expect(scorePurchases(run({ decisions: [decision({ itemId: undefined })] }), [payment()], "eip155:5042002").unscoredDecisions).toBe(1);
  });
  it("refuses conflicting duplicate decisions and payments in either order", () => {
    const a = decision(), b = decision({ expectedValue: 0.2 });
    for (const decisions of [[a, b], [b, a]]) expect(() => scorePurchases(run({ decisions }), [payment()], "eip155:5042002")).toThrow("Conflicting decision");
    for (const payments of [[payment(), payment({ amountUsdc: 0.000002 })], [payment({ amountUsdc: 0.000002 }), payment()]])
      expect(() => scorePurchases(run(), payments, "eip155:5042002")).toThrow("Conflicting payment");
  });
  it("refuses raw JSON identities/weights and bounds collection work", () => {
    expect(() => scorePurchases(run({ decisions: [decision({ itemId: {} } as never)] }), [], "eip155:5042002")).toThrow();
    expect(() => scorePurchases(run(), [payment({ id: {} } as never)], "eip155:5042002")).toThrow();
    expect(() => scorePurchases(run({ citations: [{ ...decision(), marker: "S1", weight: "0.9", reward: 0 } as never] }), [payment()], "eip155:5042002")).toThrow();
    expect(() => scorePurchases(run(), Array.from({ length: 2001 }, () => payment()), "eip155:5042002")).toThrow();
  });
});

const actor = "0x" + "1".repeat(40), owner = "0x" + "2".repeat(40);
const observation = (i: number, cited: boolean, patch: Partial<LearningObservation> = {}): LearningObservation => ({
  runId: "run" + i, topic: "biology", actorWallet: actor, sourceOwnerWallets: [owner],
  classification: { cohort: "outside", payment: "independent" },
  outcome: { assetId: "item:one", sourceId: "source", expectedValue: 0.5, settledAccessMicros: "1", cited,
    contributionWeight: cited ? 1 : 0, settledRewardMicros: "0" } satisfies PurchaseOutcome, ...patch,
});
describe("bounded source learning (#299)", () => {
  it("refuses truthy string citation flags instead of inflating citation rate", () => {
    expect(() => sourceLearningRecord("source", "biology", [observation(0, true, { outcome: { ...observation(0, true).outcome, cited: "false" } as never })])).toThrow();
  });
  it("refuses contradictory learning observations in either order", () => {
    for (const observations of [[observation(0, true), observation(0, false)], [observation(0, false), observation(0, true)]])
      expect(() => sourceLearningRecord("source", "biology", observations)).toThrow("Conflicting learning run");
    const good = observation(0, true), ownerCopy = observation(0, true, { actorWallet: owner });
    for (const observations of [[good, ownerCopy], [ownerCopy, good]])
      expect(() => sourceLearningRecord("source", "biology", observations)).toThrow("Conflicting learning run");
  });
  it("demonstrates falling/rising advisory value for consistently uncited/cited sources", () => {
    const low = sourceLearningRecord("source", "biology", Array.from({ length: 20 }, (_, i) => observation(i, false)));
    const high = sourceLearningRecord("source", "biology", Array.from({ length: 20 }, (_, i) => observation(i, true)));
    expect(learnedValue(0.5, low).value).toBeLessThan(0.5); expect(learnedValue(0.5, high).value).toBeGreaterThan(0.5);
    expect(learnedValue(0.5, low).rationale).toContain("Bought 20 times and cited 0");
    expect(low.averagePriceMicros).toEqual({ numerator: "20", denominator: 20 });
  });
  it("excludes self-dealing, unknown ownership, team/scripted/sponsored and duplicate runs", () => {
    const result = sourceLearningRecord("source", "biology", [observation(0, true), observation(0, true),
      observation(1, true, { actorWallet: owner.toUpperCase().replace("0X", "0x") }),
      observation(2, true, { sourceOwnerWallets: [] }), observation(3, true, { classification: { cohort: "team", payment: "team" } }),
      observation(4, true, { classification: { cohort: "scripted", payment: "team" } }),
      observation(5, true, { classification: { cohort: "outside", payment: "sponsored" } })]);
    expect(result.bought).toBe(1); expect(result.excluded).toBe(6); expect(learnedValue(0.5, result).changed).toBe(false);
  });
  it("bounds exploration by exact partition and refuses exhaustion/negative budgets", () => {
    expect(explorationAllowance("101", 1000)).toEqual({ explorationMicros: "10", remainingMicros: "91" });
    expect(reserveExploration("10", "7")).toBe("3"); expect(() => reserveExploration("3", "4")).toThrow();
    expect(() => explorationAllowance("1", 10001)).toThrow(); expect(() => explorationAllowance("-1", 1000)).toThrow();
  });
});
