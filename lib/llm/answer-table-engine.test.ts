import { expect, it } from "vitest";
import { JsonChatEngine } from "./json-chat-engine";
import { ReasoningInputLimitError, ReasoningOutputLimitError, type SynthInput } from "./reasoning-engine";
import { parseAnswerTableRequest } from "../research/answer-table-request";
import { deliverAnswerTable, type AnswerTablePacket } from "../research/answer-table";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { EVIDENCE_REVIEW_GUIDANCE } from "./evidence-review";
import { MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";

const fact = "The synthetic queue can deliver the same message more than once.";
function input(): SynthInput {
  const question = "Give a decision table with the delivery fact and a conditional test. Keep missing inputs explicit.";
  return { question, answerTableRequest: parseAnswerTableRequest(question), generationFormat: "evidence-only", subClaims: ["Can delivery repeat?"],
    gathered: [{ sourceId: "synthetic", sourceName: "Synthetic source", sourceKind: "public-reference", marker: "S1", itemId: "one", contentVersion: "v1", text: fact }] };
}
type Mode = "generation-input" | "review-input" | "generation-limit" | "review-limit" | "missing-review" | "rejected-layout" | "rejected-statement" | "invalid-first" | "no-evidence";
class Engine extends JsonChatEngine {
  readonly name = "synthetic-answer-table-engine";
  captured: { system: string; packet: Record<string, unknown>; cap?: number }[] = [];
  constructor(private mode?: Mode) { super(); }
  protected validateChatJsonInput(_model: string, _system: string, user: string) {
    const packet = JSON.parse(user);
    if (this.mode === "generation-input" && packet.answerTableRequest || this.mode === "review-input" && packet.answerTable)
      throw new ReasoningInputLimitError("Synthetic table addition refused");
  }
  protected async chatJson(_model: string, system: string, user: string, cap?: number) {
    const packet = JSON.parse(user); this.captured.push({ system, packet, cap });
    if (this.captured.length === 1) {
      if (this.mode === "generation-limit") throw new ReasoningOutputLimitError(cap!);
      const option = (packet.quoteOptions as { quoteId: string; text: string; marker: string }[]).find(row => row.text === fact)!;
      const evidence = [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement: fact }];
      if (this.mode === "invalid-first") evidence.unshift({ ...evidence[0], quoteId: "unknown" });
      const id = this.mode === "invalid-first" ? "e2" : "e1";
      return { evidence: this.mode === "no-evidence" ? [] : evidence, conflicts: [], answerTable: { columns: ["Delivery", "Proposed check"], rows: [[
        { kind: "facts", evidenceIds: [id] }, { kind: "proposal", text: "Propose an isolated repeated-delivery test.", premiseIds: [id], conditions: ["If an isolated test environment is available."] },
      ]] } };
    }
    if (this.mode === "review-limit") throw new ReasoningOutputLimitError(cap!);
    const table = packet.answerTable as AnswerTablePacket | undefined;
    return { reviews: (packet.evidence as { index: number }[]).map(row => ({ index: row.index, supportedFact: fact, support: 0.9,
      statementSupport: this.mode === "rejected-statement" ? 0 : 0.9 })),
      ...(table && this.mode !== "missing-review" ? { answerTableReview: { digest: table.digest, layout: this.mode === "rejected-layout" ? "unsupported" : "supported",
        cells: table.table.rows.flatMap((row, ri) => row.map((_cell, ci) => [ri, ci, "supported", "supported", "supported", "supported"])) } } : {}) };
  }
}
async function drive(mode?: Mode, value = input()) {
  const engine = new Engine(mode), result = await engine.synthesize(value);
  const ledger = buildEvidenceLedger({ ...value, answer: result.answer, declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence,
    finalAssessment: [{ claim: value.subClaims[0], coverage: 0.9, coveredBy: ["S1"] }] });
  const delivered = deliverAnswerTable(value.answerTableRequest!, result.answerTable, ledger, selectCitedStatements(result.evidence, ledger));
  return { engine, result, delivered };
}
it("preserves both existing supplier calls, caps, factual context, rows and conclusions", async () => {
  const value = input(), base = new Engine(), plain = await base.synthesize({ ...value, answerTableRequest: undefined }), f = await drive();
  expect(f.engine.calls).toHaveLength(2); expect(f.engine.captured.map(row => row.cap)).toEqual(base.captured.map(row => row.cap));
  expect(f.engine.captured[1].packet.evidence).toEqual(base.captured[1].packet.evidence);
  expect(f.engine.captured[1].system).toContain(EVIDENCE_REVIEW_GUIDANCE);
  expect(Buffer.byteLength(f.engine.captured[1].system + JSON.stringify(f.engine.captured[1].packet)) + 1024).toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
  expect(f.result.evidence).toEqual(plain.evidence); expect(f.result.citedMarkers).toEqual(plain.citedMarkers); expect(f.delivered?.rows).toHaveLength(1);
});
it.each(["generation-input", "review-input"] as const)("retains unchanged factual request after %s refusal with no extra supplier attempt", async mode => {
  const base = new Engine(); await base.synthesize({ ...input(), answerTableRequest: undefined }); const f = await drive(mode);
  expect(f.engine.calls).toHaveLength(2); expect(f.delivered).toBeUndefined();
  const index = mode === "generation-input" ? 0 : 1; expect(f.engine.captured[index]).toEqual(base.captured[index]);
  expect(f.result.evidence[0].statementSupport).toBe(0.9);
});
it.each(["missing-review", "rejected-layout", "rejected-statement"] as const)("withholds unqualified table for %s", async mode => {
  const f = await drive(mode); expect(f.engine.calls).toHaveLength(2); expect(f.delivered).toBeUndefined();
});
it("retains unresolved evidence positions and never invents a review without facts", async () => {
  const f = await drive("invalid-first"); expect(f.result.answerTable?.packet.premises.map(row => row.id)).toEqual(["e2"]);
  expect(f.delivered?.rows).toHaveLength(1);
  const empty = await drive("no-evidence"); expect(empty.engine.calls).toHaveLength(1); expect(empty.delivered).toBeUndefined();
});
it.each(["legacy", "decision", "teaching", "changed-question"])("keeps protected %s input unchanged", async mode => {
  const value = input();
  if (mode === "legacy") value.generationFormat = undefined;
  if (mode === "decision") value.answerFormat = "decision-brief";
  if (mode === "teaching") value.teachingRequest = {} as NonNullable<SynthInput["teachingRequest"]>;
  if (mode === "changed-question") value.question += " changed";
  const engine = new Engine(); await engine.synthesize(value); expect(engine.captured[0].packet.answerTableRequest).toBeUndefined();
  expect(engine.captured[0].system).not.toContain("Also return answerTable");
});
it("does not retry output ceilings or admit review-stopped table content", async () => {
  const engine = new Engine("generation-limit"); await expect(engine.synthesize(input())).rejects.toBeInstanceOf(ReasoningOutputLimitError);
  expect(engine.calls).toHaveLength(1); const f = await drive("review-limit"); expect(f.engine.calls).toHaveLength(2);
  expect(f.result.synthesisFailure).toBe("review"); expect(f.delivered).toBeUndefined();
});
