import { describe, expect, it } from "vitest";
import { renderFulfilledOriginalAnswer } from "./original-fulfillment-answer";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import type { EvidenceLedger } from "../agent/evidence-ledger";
import { ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL } from "../llm/original-fulfillment-quality";
import { qualityQuestion, qualityStatements, qualityTargets } from "../llm/original-fulfillment-quality-fixture";

function input() {
  const statements = qualityStatements();
  const ledger = { acceptedMarkers: new Set(["S1", "S2", "S3", "S4"]),
    evidence: statements.map(row => ({ ...row, qualifiesForAnswer: true, qualifiesForReward: false })),
    claimCoverage: qualityTargets.map((claim, claimIndex) => ({ claim, claimIndex, coverage: 0.9, coveredBy: [] })) } as unknown as EvidenceLedger;
  return { question: qualityQuestion, answer: "Untrusted raw draft [S1].", ledger, statements, evidenceGaps: [] };
}
describe("same-evidence quality answer rendering", () => {
  it("preserves the byte-identical historical renderer without the protected opt-in", () => {
    const value = input();
    expect(renderFulfilledOriginalAnswer(value)).toBe(finalizeGroundedAnswer(value));
    expect(renderFulfilledOriginalAnswer(value)).not.toContain("Proposed acceptance checks");
  });
  it("renders concrete observation checks as explicit unexecuted inferences with unresolved values", () => {
    const answer = renderFulfilledOriginalAnswer({ ...input(), qualityProtocol: ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL });
    for (const part of ["Arc profile:", "Wallet and rail:", "Bounded authorization:", "Contract validation:", "Genuine settlement:", "Research delivery:"])
      expect(answer).toContain(part);
    expect(answer).toContain("inferences; not executed");
    expect(answer).toContain("not vendor test procedures or evidence of a successful deployment");
    expect(answer).toContain("numeric cap, nonce, expiry");
    expect(answer).toContain("no addresses, amounts, nonces or deadlines are invented");
    expect(answer).not.toContain("Untrusted raw draft");
    expect(answer).not.toMatch(/0x[\da-fA-F]{40}/);
  });
  it("refuses an acceptance checklist when an underlying reviewed premise is missing", () => {
    const value = input(); value.statements = value.statements.filter(row => !row.quote.includes("signed authorization attached"));
    expect(() => renderFulfilledOriginalAnswer({ ...value, qualityProtocol: ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL })).toThrow(/signed-retry/);
  });
});
