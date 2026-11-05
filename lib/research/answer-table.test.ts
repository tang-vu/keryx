import { expect, it } from "vitest";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { parseAnswerTableRequest } from "./answer-table-request";
import { prepareAnswerTable, reviewAnswerTable, deliverAnswerTable, validAnswerTablePacket, type AnswerTablePacket } from "./answer-table";
import { answerTableMarkdown } from "./answer-table-presentation";

const question = "Give a decision table of message delivery facts and a conditional test; keep missing information explicit.";
const fact = "The synthetic queue can deliver the same message more than once.";
const request = parseAnswerTableRequest(question)!;
const evidence = [{ claimIndex: 0, marker: "S1", quote: fact, quoteSpan: { start: 0, end: fact.length }, statement: fact, support: 0.9, statementSupport: 0.9 }];
const table = { columns: ["Situation", "Evidence", "Proposed check", "Unknown"], rows: [[{ kind: "label", text: "Repeated delivery" },
  { kind: "facts", evidenceIds: ["e1"] }, { kind: "proposal", text: "Propose an isolated redelivery test.", premiseIds: ["e1"], conditions: ["If an isolated test environment is available."] }, { kind: "unknown" }]] };
function fixture() {
  const packet = prepareAnswerTable(request, question, evidence, table)!;
  const ledger = buildEvidenceLedger({ question, subClaims: ["Can delivery repeat?"], answer: fact + " [S1]", declaredMarkers: ["S1"], proposedEvidence: evidence,
    gathered: [{ sourceId: "synthetic", sourceName: "Synthetic reference", sourceKind: "public-reference", itemId: "one", contentVersion: "v1", marker: "S1", text: fact }],
    finalAssessment: [{ claim: "Can delivery repeat?", coverage: 0.9, coveredBy: ["S1"] }] });
  const review = { digest: packet.digest, layout: "supported", cells: packet.table.rows.flatMap((row, ri) => row.map((_cell, ci) =>
    [ri, ci, "supported", "supported", "supported", "supported"] as [number, number, string, string, string, string])) };
  return { packet, ledger, review, statements: selectCitedStatements(evidence, ledger) };
}
it("delivers factual text/excerpts, conditional proposals and unknown cells without mutating the ledger", () => {
  const f = fixture(), before = structuredClone(f.ledger);
  const result = deliverAnswerTable(request, reviewAnswerTable(f.packet, f.review), f.ledger, f.statements)!;
  expect(result.rows[0].map(cell => cell.kind)).toEqual(["label", "facts", "proposal", "unknown"]);
  expect(result.incomplete).toBe(true); expect(f.ledger).toEqual(before);
  const text = answerTableMarkdown(result, "en");
  expect(text).toContain(`“${fact}” [S1]`); expect(text).toContain("Conditional proposal:");
  expect(text).toContain("If an isolated test environment is available."); expect(text).toContain("Not established");
});
it.each(["digest", "duplicate", "missing", "outside", "extra"])("rejects malformed review capability: %s", mode => {
  const f = fixture();
  if (mode === "digest") f.review.digest = "a".repeat(64);
  if (mode === "duplicate") f.review.cells[1] = f.review.cells[0];
  if (mode === "missing") f.review.cells.pop();
  if (mode === "outside") f.review.cells[0][0] = 7;
  if (mode === "extra") f.review.cells[0].push("repair");
  expect(reviewAnswerTable(f.packet, f.review)).toBeUndefined();
});
it.each(["layout", "label", "clone", "mutation", "question"])("withholds an invalid layout/runtime capability: %s", mode => {
  const f = fixture();
  if (mode === "layout") f.review.layout = "unsupported";
  if (mode === "label") f.review.cells[0][3] = "unsupported";
  let reviewed = reviewAnswerTable(f.packet, f.review)!;
  if (mode === "clone") reviewed = structuredClone(reviewed);
  if (mode === "mutation") reviewed.packet.table.columns[0] = "Changed";
  const bound = mode === "question" ? parseAnswerTableRequest(question + " changed")! : request;
  expect(deliverAnswerTable(bound, reviewed, f.ledger, f.statements)).toBeUndefined();
});
it.each(["association", "content", "conditions", "language"] as const)("replaces rejected cell %s with explicit unknown without retaining its content", field => {
  const f = fixture(); f.review.cells[2][["association", "content", "conditions", "language"].indexOf(field) + 2] = "insufficient";
  const result = deliverAnswerTable(request, reviewAnswerTable(f.packet, f.review), f.ledger, f.statements)!;
  expect(result.rows[0][2]).toEqual({ kind: "unknown" }); expect(answerTableMarkdown(result, "en")).not.toContain("isolated redelivery test");
});
it.each(["statement", "coverage", "marker", "physical-source", "qualifies"])("withholds facts and dependent proposals when final %s fails", mode => {
  const f = fixture();
  if (mode === "statement") f.statements = [];
  if (mode === "coverage") f.ledger.claimCoverage[0].coverage = 0;
  if (mode === "marker") f.ledger.acceptedMarkers.clear();
  if (mode === "physical-source") f.ledger.evidence.push({ ...f.ledger.evidence[0], itemId: "other" });
  if (mode === "qualifies") f.ledger.evidence[0].qualifiesForAnswer = false;
  expect(deliverAnswerTable(request, reviewAnswerTable(f.packet, f.review), f.ledger, f.statements)).toBeUndefined();
});
it.each(["ragged", "duplicate-columns", "foreign-ref", "duplicate-ref", "new-fact", "no-condition", "label-only", "html-control"])("refuses malformed generation: %s", mode => {
  const value = structuredClone(table);
  if (mode === "ragged") value.rows[0].pop();
  if (mode === "duplicate-columns") value.columns[1] = value.columns[0];
  if (mode === "foreign-ref") value.rows[0][1].evidenceIds = ["e2"];
  if (mode === "duplicate-ref") value.rows[0][1].evidenceIds = ["e1", "e1"];
  if (mode === "new-fact") value.rows[0][1].text = "Invented fact";
  if (mode === "no-condition") value.rows[0][2].conditions = [];
  if (mode === "label-only") value.rows[0] = value.columns.map(text => ({ kind: "label", text }));
  if (mode === "html-control") value.columns[0] += "\n### forged";
  expect(prepareAnswerTable(request, question, evidence, value)).toBeUndefined();
});
it("preserves evidence positions and detects packet mutation", () => {
  const value = structuredClone(table); value.rows[0][1].evidenceIds = ["e2"]; value.rows[0][2].premiseIds = ["e2"];
  const packet = prepareAnswerTable(request, question, [{ ...evidence[0], statement: undefined }, ...evidence], value)!;
  expect(packet.premises.map(row => row.id)).toEqual(["e2"]); expect(validAnswerTablePacket(packet)).toBe(true);
  packet.table.rows[0][0] = { kind: "label", text: "tampered" }; expect(validAnswerTablePacket(packet)).toBe(false);
  expect(validAnswerTablePacket(undefined as unknown as AnswerTablePacket)).toBe(false);
});
