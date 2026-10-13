import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, stringToBytes } from "viem";
import { researchMandateAbi } from "./contract";
import { evaluateMandate, microUsdc, type MandateInput } from "./evaluate";
import { mandateExample } from "./example";

const now = new Date("2026-10-13T12:00:00.500Z");
const assess = (change: (input: MandateInput) => void = () => {}) => {
  const input = mandateExample(now); change(input); return evaluateMandate(input, now);
};
describe("research mandate compiler: supplied books are never execution authority", () => {
  it("retains overdue and unknown unpaid obligations instead of treating them as available money", () => {
    const result = assess();
    expect(result.cash).toMatchObject({ unpaidLiabilitiesUsdc: "40.000000", protectedReserveUsdc: "44.000000", requiredUsdc: "45.000000" });
    expect(result.executionAuthorized).toBe(false);
    expect(result.assessment).toBe("within-supplied-policy");
    expect(assess(input => { input.policy.liabilities[0].state = "unknown"; }).cash).toEqual(result.cash);
    expect(assess(input => { input.books.balanceUsdc = "44.999999"; }).assessment).toBe("hold");
  });
  it("rounds reserve buffers up at the micro-USDC boundary and respects the reserve floor", () => {
    const result = assess(input => { input.policy.reserveFloorUsdc = "0"; input.policy.liabilities[0].amountUsdc = "0.000001"; });
    expect(result.cash.protectedReserveUsdc).toBe("0.000002");
    expect(assess(input => { input.policy.liabilities[0].state = "settled"; }).cash.protectedReserveUsdc).toBe("5.000000");
  });
  it.each(["1e6", "0.0000001", "-1", "NaN", "1.0.0", "01", "10000000000"])("rejects non-exact or out-of-range amounts %s", value => {
    expect(() => microUsdc(value)).toThrow();
  });
  it("counts unresolved exposure against both cash and committed caps", () => {
    const result = assess(input => { input.books.heldUsdc = "5"; input.books.dailyCommittedUsdc = "10";
      input.books.rollingWeekCommittedUsdc = "20"; input.books.lifetimeCommittedUsdc = "30";
      input.books.categoryCommittedUsdc["source-access"] = "15"; input.books.taskCommittedUsdc[input.proposal.taskHash] = "10"; });
    expect(result.reasons.map(row => row.code)).toEqual(expect.arrayContaining(["daily-cap", "rolling-week-cap", "lifetime-cap", "category-cap", "task-cap"]));
    expect(result.prepareCalldata).toBeNull();
  });
  it.each(["missing", "stale", "future", "inconsistent"])("holds %s observations", mode => {
    const result = assess(input => {
      if (mode === "missing") input.books.complete = false;
      if (mode === "stale") input.books.observedAt = new Date(now.getTime() - 30_001).toISOString();
      if (mode === "future") input.books.observedAt = new Date(now.getTime() + 1).toISOString();
      if (mode === "inconsistent") input.books.taskCommittedUsdc[input.proposal.taskHash] = "1";
    });
    expect(result.assessment).toBe("hold");
  });
  it("refuses wrong source recipients even when the recipient itself is allowlisted", () => {
    const result = assess(input => { const wrong = "0x2222222222222222222222222222222222222222";
      input.policy.payees.push(wrong); input.proposal.payee = wrong; });
    expect(result.reasons.map(row => row.code)).toContain("source-payee-mismatch");
  });
  it("binds exact question, content, decision, source, payee and amount into ABI-compatible purchase bytes", () => {
    const input = mandateExample(now), result = evaluateMandate(input, now);
    const decoded = decodeFunctionData({ abi: researchMandateAbi, data: result.prepareCalldata! });
    expect(decoded.functionName).toBe("prepare");
    expect(decoded.args![0]).toMatchObject({ amount: BigInt(1_000_000), decisionHash: result.identity.decisionHash, taskHash: input.proposal.taskHash });
    for (const mutate of [
      (row: MandateInput) => { row.proposal.contentHash = keccak256(stringToBytes("changed content")); },
      (row: MandateInput) => { row.proposal.rationale = "Changed rationale"; },
      (row: MandateInput) => { row.proposal.amountUsdc = "1.000001"; },
      (row: MandateInput) => { row.network = "eip155:5042002"; },
    ]) { const changed = structuredClone(input); mutate(changed);
      expect(evaluateMandate(changed, now).identity.purchaseBinding).not.toBe(result.identity.purchaseBinding); }
    expect(assess(row => { row.proposal.question += "?"; }).reasons.map(row => row.code)).toContain("task-binding-mismatch");
  });
  it("holds a subsecond deadline which would already be expired after contract timestamp conversion", () => {
    expect(assess(input => { input.proposal.validUntil = "2026-10-13T12:00:00.900Z"; }).reasons.map(row => row.code)).toContain("purchase-expiry");
  });
  it.each(["BUY", "HOLD", "ESCALATE", "SKIP"] as const)("does not turn the supplied %s recommendation into financial authority", recommendation => {
    const result = assess(input => { input.proposal.recommendation = recommendation; });
    expect(result.assessment).toBe({ BUY: "within-supplied-policy", HOLD: "hold", ESCALATE: "review", SKIP: "skip" }[recommendation]);
    expect(result.executionAuthorized).toBe(false);
    if (recommendation !== "BUY") expect(result.prepareCalldata).toBeNull();
  });
  it("refuses heuristic agency, unreviewed evidence and unknown task/category books", () => {
    const result = assess(input => { input.proposal.serving = "heuristic"; input.proposal.evidenceReview = "unknown";
      input.books.categoryCommittedUsdc = {}; input.books.taskCommittedUsdc = {}; });
    expect(result.reasons.map(row => row.code)).toEqual(expect.arrayContaining(["unverified-agency", "evidence-needs-review", "task-books-unknown", "category-books-unknown"]));
  });
  it("rejects duplicate obligations and extra fields instead of silently rewriting the policy", () => {
    const input = mandateExample(now); input.policy.liabilities.push({ ...input.policy.liabilities[0] });
    expect(() => evaluateMandate(input, now)).toThrow();
    expect(() => evaluateMandate({ ...mandateExample(now), execute: true }, now)).toThrow();
    const ambiguous = mandateExample(now); ambiguous.books.categoryCommittedUsdc[" source-access "] = "0";
    expect(() => evaluateMandate(ambiguous, now)).toThrow();
    expect(() => evaluateMandate({ padding: "汉".repeat(32_000) }, now)).toThrow("64 KiB");
  });
});
