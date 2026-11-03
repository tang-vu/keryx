import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import { prepareSpecialistBrief } from "./specialist-briefs";
import { parseWorkProductRequest } from "./work-product-request";
import { prepareWorkProduct, reviewWorkProduct, deliverWorkProduct, validWorkProductPacket, workProductReviewInput, type WorkProductPacket } from "./work-products";

// Synthetic premises and judgments verify contracts, not model quality or a live process.
const question = prepareSpecialistBrief({ track: "custom", decision: "Prepare a retry investigation checklist.", context: "Unknown provider capabilities.",
  sourceLeads: [], deliverable: "A proposed investigation checklist.", reviewCriteria: ["No exactly-once guarantee.", "Keep unknown provider behavior explicit."] }).request.question;
const request = parseWorkProductRequest(question)!;
const quote = "The example queue can deliver the same message more than once.";
const evidence: ProposedEvidence[] = [{ claimIndex: 0, marker: "S1", quote, quoteSpan: { start: 0, end: quote.length }, support: 0.9, statementSupport: 0.9, statement: quote }];
const sections = [{ id: "w1", heading: "Proposed duplicate-delivery check", text: "Propose a controlled duplicate-delivery test before choosing a retry procedure.", premiseIds: ["e1"], conditions: ["If a nonproduction test environment is available."] }];
function fixture(creator = false) {
  const packet = prepareWorkProduct(request, question, evidence, sections).packet!;
  const ledger = buildEvidenceLedger({ question, subClaims: ["Can messages repeat?"], answer: "Source finding [S1]", declaredMarkers: ["S1"],
    proposedEvidence: evidence, finalAssessment: [{ claim: "Can messages repeat?", coverage: 0.9, coveredBy: ["S1"] }],
    gathered: [{ sourceId: "synthetic", sourceName: "Synthetic example only", ...(creator ? {} : { sourceKind: "public-reference" as const }), marker: "S1", itemId: "one", contentVersion: "v1", text: quote }] });
  return { packet, ledger, statements: selectCitedStatements(evidence, ledger) };
}
function judgments(packet: WorkProductPacket) {
  return { digest: packet.digest, sections: packet.sections.map(row => ({ id: row.id, premiseIds: [...row.premiseIds], premiseConsistency: "supported", proposalOnly: "supported", scope: "supported", conditions: "supported", language: "supported" })),
    criteria: packet.request.criteria.map((_row, index) => ({ index, status: "supported" })) };
}
it("projects reviewed proposals only through unchanged final premises without changing the ledger", () => {
  const f = fixture(), before = JSON.stringify(f.ledger, (_k,v) => v instanceof Set ? [...v] : v);
  const value = reviewWorkProduct(f.packet, judgments(f.packet));
  const delivery = deliverWorkProduct(request, value, f.ledger, f.statements);
  expect(delivery.sections).toHaveLength(1); expect(delivery.criteriaReviewed).toBe(true);
  expect(delivery.sections[0].premises[0].statement.quote).toBe(quote);
  expect(JSON.stringify(f.ledger, (_k,v) => v instanceof Set ? [...v] : v)).toBe(before);
});
it("leaves an already reward-eligible creator ledger byte-identical without granting proposal rewards", () => {
  const f = fixture(true), before = JSON.stringify(f.ledger, (_k,v) => v instanceof Set ? [...v] : v);
  expect(f.ledger.evidence[0].qualifiesForReward).toBe(true);
  const delivered = deliverWorkProduct(request, reviewWorkProduct(f.packet, judgments(f.packet)), f.ledger, f.statements);
  expect(delivered.sections).toHaveLength(1);
  expect(JSON.stringify(f.ledger, (_k,v) => v instanceof Set ? [...v] : v)).toBe(before);
});
it.each(["statement", "coverage", "nonfinite", "marker", "quote", "identity"])("withdraws a proposal when its final %s changes", what => {
  const f = fixture(), value = reviewWorkProduct(f.packet, judgments(f.packet));
  if (what === "statement") f.statements[0].text += " Changed.";
  if (what === "coverage") f.ledger.claimCoverage[0].coverage = 0.39;
  if (what === "nonfinite") f.ledger.claimCoverage[0].coverage = NaN;
  if (what === "marker") f.ledger.acceptedMarkers.clear();
  if (what === "quote") f.ledger.evidence[0].quote += " Changed.";
  if (what === "identity") f.ledger.evidence.push({ ...f.ledger.evidence[0], contentVersion: "other-version" });
  const delivered = deliverWorkProduct(request, value, f.ledger, f.statements);
  expect(delivered.sections).toEqual([]); expect(delivered.gaps).toContain("final-premise-withheld"); expect(delivered.criteriaReviewed).toBe(false);
});
it.each([
  (v: ReturnType<typeof judgments>) => ({ ...v, digest: "a".repeat(64) }),
  (v: ReturnType<typeof judgments>) => ({ ...v, sections: [] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, sections: [...v.sections, v.sections[0]] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, sections: [{ ...v.sections[0], id: "w6" }] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, sections: [{ ...v.sections[0], premiseIds: ["e2"] }] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, criteria: [] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, criteria: [v.criteria[0], v.criteria[0]] }),
  (v: ReturnType<typeof judgments>) => ({ ...v, override: true }),
])("refuses incomplete, duplicate, foreign or changed review judgments", change => {
  const { packet } = fixture(); expect(reviewWorkProduct(packet, change(judgments(packet)))).toBeUndefined();
});
it.each(["premiseConsistency", "proposalOnly", "scope", "conditions", "language"] as const)("requires independent %s approval", key => {
  const f = fixture(), raw = judgments(f.packet); raw.sections[0][key] = "insufficient";
  const delivered = deliverWorkProduct(request, reviewWorkProduct(f.packet, raw), f.ledger, f.statements);
  expect(delivered.sections).toEqual([]); expect(delivered.gaps).toContain("review-rejected");
});
it("retains a useful admitted section when a criterion remains unmet, without claiming criteria completion", () => {
  const f = fixture(), raw = judgments(f.packet);raw.criteria[1].status = "insufficient";
  const delivered = deliverWorkProduct(request, reviewWorkProduct(f.packet, raw), f.ledger, f.statements);
  expect(delivered.sections).toHaveLength(1); expect(delivered.criteriaReviewed).toBe(false); expect(delivered.gaps).toContain("criteria-unmet");
});
it("will not restore a runtime review from JSON or promote a mutated review capability", () => {
  const f = fixture(), value = reviewWorkProduct(f.packet, judgments(f.packet))!;
  expect(deliverWorkProduct(request, JSON.parse(JSON.stringify(value)), f.ledger, f.statements).sections).toEqual([]);
  expect(deliverWorkProduct(request, {} as typeof value, f.ledger, f.statements).sections).toEqual([]);
  value.acceptedSectionIds.push("w6");
  expect(deliverWorkProduct(request, value, f.ledger, f.statements).sections).toEqual([]);
});
it("rejects mutated or rehashed invalid packets and does not expose mutable review-input aliases", () => {
  const f = fixture(), input = workProductReviewInput(f.packet);input.packet.sections[0].text = "changed";
  expect(f.packet.sections[0].text).toBe(sections[0].text);
  f.packet.sections[0].premiseIds = ["e32"];
  const { digest: _old, ...body } = f.packet;
  f.packet.digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  expect(validWorkProductPacket(f.packet)).toBe(false); expect(() => workProductReviewInput(f.packet)).toThrow();
});
it.each([
  [], Array(7).fill(sections[0]), [sections[0], sections[0]], [{ ...sections[0], text: "[S99]" }],
  [{ ...sections[0], text: "x".repeat(601) }], [{ ...sections[0], text: "lone\ud800surrogate" }],
  [{ ...sections[0], text: "new\nblock" }], [{ ...sections[0], premiseIds: ["e32"] }],
  [{ ...sections[0], premiseIds: ["e1", "e1"] }], [{ ...sections[0], payTo: "forbidden" }],
])("refuses malformed products without selecting an arbitrary truncated subset", raw => {
  expect(prepareWorkProduct(request, question, evidence, raw).packet).toBeUndefined();
});
it("preserves evidence row positions and rejects repeated physical premises under different row IDs", () => {
  const invalid = { ...evidence[0], statement: undefined };
  const packet = prepareWorkProduct(request, question, [invalid, ...evidence], [{ ...sections[0], premiseIds: ["e2"] }]).packet!;
  expect(packet.premises.map(row => row.id)).toEqual(["e2"]);
  expect(prepareWorkProduct(request, question, [...evidence, ...evidence], [{ ...sections[0], premiseIds: ["e1", "e2"] }]).packet).toBeUndefined();
});
