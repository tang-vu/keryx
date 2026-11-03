import { expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputLimitError, type SynthInput } from "./reasoning-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { prepareSpecialistBrief } from "../research/specialist-briefs";
import { parseWorkProductRequest } from "../research/work-product-request";
import { deliverWorkProduct, type WorkProductPacket } from "../research/work-products";
import { EVIDENCE_REVIEW_GUIDANCE } from "./evidence-review";
import { MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";

const fact = "The synthetic queue can deliver the same message more than once.";
function input(): SynthInput {
  const question = prepareSpecialistBrief({ track: "custom", decision: "Propose a retry investigation checklist.", context: "Provider capability is unknown.",
    sourceLeads: [], deliverable: "A proposed checklist.", reviewCriteria: ["No exactly-once guarantee."] }).request.question;
  return { question, workProductRequest: parseWorkProductRequest(question), subClaims: ["Can messages repeat?"], generationFormat: "evidence-only",
    gathered: [{ sourceId: "synthetic", sourceName: "Synthetic reference only", sourceKind: "public-reference", marker: "S1", itemId: "one", contentVersion: "v1", text: fact }] };
}
type Mode = "generation-input" | "review-input" | "generation-limit" | "review-limit" | "missing-review" | "rejected-product" | "rejected-statement" | "no-evidence" | "invalid-first-row";
class Engine extends JsonChatEngine {
  readonly name = "synthetic-work-product-engine";
  captured: { system: string; packet: Record<string, unknown>; cap?: number }[] = [];
  constructor(private mode?: Mode) { super(); }
  protected validateChatJsonInput(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user);
    if (this.mode === "generation-input" && packet.workProductRequest || this.mode === "review-input" && packet.workProduct)
      throw new ReasoningInputLimitError("Synthetic addition refused");
  }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user); this.captured.push({ system, packet, cap });
    if (this.captured.length === 1) {
      if (this.mode === "generation-limit") throw new ReasoningOutputLimitError(cap!);
      const options = packet.quoteOptions as { quoteId: string; text: string; marker: string }[];
      const option = options.find(row => row.text === fact)!;
      const evidence = [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement: fact }];
      if (this.mode === "invalid-first-row") evidence.unshift({ ...evidence[0], quoteId: "unknown" });
      return { evidence: this.mode === "no-evidence" ? [] : evidence, conflicts: [], workProductSections: [{ id: "w1", heading: "Proposed check",
        text: "Propose a controlled repeated-delivery test before choosing a retry strategy.", premiseIds: [this.mode === "invalid-first-row" ? "e2" : "e1"], conditions: ["If an isolated test environment is available."] }] };
    }
    if (this.mode === "review-limit") throw new ReasoningOutputLimitError(cap!);
    const reviews = (packet.evidence as { index: number }[]).map(row => ({ index: row.index, supportedFact: fact, support: 0.9,
      statementSupport: this.mode === "rejected-statement" ? 0 : 0.9 }));
    const product = packet.workProduct as WorkProductPacket | undefined;
    return { reviews, ...(product && this.mode !== "missing-review" ? { workProductReview: { digest: product.digest,
      sections: product.sections.map(row => ({ id: row.id, premiseIds: row.premiseIds, premiseConsistency: "supported", proposalOnly: "supported",
        scope: this.mode === "rejected-product" ? "unsupported" : "supported", conditions: "supported", language: "supported" })),
      criteria: product.request.criteria.map((_row, index) => ({ index, status: "supported" })) } } : {}) };
  }
}
async function drive(mode?: Mode, value = input()) {
  const engine = new Engine(mode), result = await engine.synthesize(value);
  const ledger = buildEvidenceLedger({ ...value, answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence,
    finalAssessment: [{ claim: value.subClaims[0], coverage: 0.9, coveredBy: ["S1"] }] });
  const delivery = deliverWorkProduct(value.workProductRequest!, result.workProduct?.reviewed, ledger, selectCitedStatements(result.evidence, ledger), result.workProduct?.preparationGaps);
  return { engine, result, ledger, delivery };
}
it("uses the same two calls/caps and preserves the complete independent factual review", async () => {
  const value = input(), base = new Engine(), plain = await base.synthesize({ ...value, workProductRequest: undefined });
  const f = await drive(undefined, value);
  expect(f.engine.calls).toHaveLength(2); expect(f.engine.captured.map(row => row.cap)).toEqual(base.captured.map(row => row.cap));
  expect(f.engine.captured[0].packet.workProductRequest).toEqual(value.workProductRequest);
  expect(f.engine.captured[1].packet.evidence).toEqual(base.captured[1].packet.evidence);
  expect(f.engine.captured[1].system).toContain(EVIDENCE_REVIEW_GUIDANCE);
  expect(Buffer.byteLength(f.engine.captured[1].system + JSON.stringify(f.engine.captured[1].packet)) + 1024).toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
  expect(f.result.evidence).toEqual(plain.evidence); expect(f.result.citedMarkers).toEqual(plain.citedMarkers);
  expect(f.delivery.sections).toHaveLength(1); expect(f.delivery.criteriaReviewed).toBe(true);
});
it.each(["generation-input", "review-input"] as const)("falls back to the unchanged factual request on %s refusal without extra supplier attempts", async mode => {
  const value = input(), baseline = new Engine();await baseline.synthesize({ ...value, workProductRequest: undefined });
  const f = await drive(mode, value);expect(f.engine.calls).toHaveLength(2);expect(f.delivery.sections).toEqual([]);
  const index = mode === "generation-input" ? 0 : 1;
  expect(f.engine.captured[index]).toEqual(baseline.captured[index]);
  expect(f.result.evidence).toHaveLength(1); expect(f.result.evidence[0].statementSupport).toBe(0.9);
});
it.each(["missing-review", "rejected-product", "rejected-statement"] as const)("withholds proposed content on %s while retaining factual gates", async mode => {
  const f = await drive(mode);expect(f.engine.calls).toHaveLength(2);expect(f.delivery.sections).toEqual([]);expect(f.delivery.criteriaReviewed).toBe(false);
});
it("keeps resolved evidence positions when an earlier quote cannot be resolved", async () => {
  const f = await drive("invalid-first-row");
  expect(f.delivery.sections[0].premises.map(row => row.id)).toEqual(["e2"]);
  expect((f.engine.captured[1].packet.evidence as { index: number }[]).map(row => row.index)).toEqual([1]);
});
it("never creates a proposal-only review when factual evidence is absent", async () => {
  const f = await drive("no-evidence");expect(f.engine.calls).toHaveLength(1);expect(f.delivery.sections).toEqual([]);
});
it("retains the original review when the proposed packet exceeds the existing 32KB bound", async () => {
  const value = input();value.question += "\n\n" + "x".repeat(27_000);value.workProductRequest = parseWorkProductRequest(value.question);
  const f = await drive(undefined, value);expect(f.engine.calls).toHaveLength(2);
  expect(f.engine.captured[1].packet.workProduct).toBeUndefined();expect(f.engine.captured[1].packet.evidence).toHaveLength(1);
  expect(f.delivery.sections).toEqual([]);
});
it.each(["legacy", "decision", "teaching", "changed-question"])("does not activate from a stray request on %s inputs", async kind => {
  const value = input();
  if (kind === "legacy") value.generationFormat = undefined;
  if (kind === "decision") value.answerFormat = "decision-brief";
  if (kind === "teaching") value.teachingRequest = {} as NonNullable<SynthInput["teachingRequest"]>;
  if (kind === "changed-question") value.question += " changed";
  const engine = new Engine();await engine.synthesize(value);
  expect(engine.captured[0].packet.workProductRequest).toBeUndefined();
  expect(engine.captured[0].system).not.toContain("workProductSections");
});
it("does not retry a generation ceiling and withholds review-stopped proposals", async () => {
  const generation = new Engine("generation-limit");await expect(generation.synthesize(input())).rejects.toBeInstanceOf(ReasoningOutputLimitError);
  expect(generation.calls).toHaveLength(1);
  const review = await drive("review-limit");expect(review.engine.calls).toHaveLength(2);expect(review.result.synthesisFailure).toBe("review");expect(review.delivery.sections).toEqual([]);
});
