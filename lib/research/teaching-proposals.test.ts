import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import type { ProposedEvidence } from "../llm/reasoning-engine";
import { parseTeachingProposalRequest } from "./teaching-proposals-request";
import { deliverTeachingProposals, prepareTeachingProposals, reviewTeachingProposals, teachingProposalReviewInput,
  validTeachingProposalPacket, type TeachingProposalPacket, type ReviewedTeachingProposals } from "./teaching-proposals";
const englishTeachingQuestion = "I teach grade 7. Propose a 10-minute classroom activity, two classification examples and one exit question with an answer. Write in English: explanation under 100 words. Label activities and invented examples as proposed.";

// Synthetic classroom premises verify the contract, not NASA correctness or a
// completed live lesson. The selected statements undergo the real ledger gate.
function fixture() {
  const question = englishTeachingQuestion, request = parseTeachingProposalRequest(question)!;
  const quotes = ["Weather describes atmospheric conditions over a short period.",
    "Climate describes average weather over a long period."];
  const evidence: ProposedEvidence[] = quotes.map((quote, claimIndex) => ({ claimIndex, marker: "S1", quote,
    support: 0.9, statementSupport: 0.9, statement: quote,
    quoteSpan: { start: quotes.join(" ").indexOf(quote), end: quotes.join(" ").indexOf(quote) + quote.length } }));
  const ledger = buildEvidenceLedger({ question, subClaims: ["weather", "climate"], gathered: [{ sourceId: "synthetic", marker: "S1",
    sourceName: "Synthetic reference", sourceKind: "public-reference", itemId: "one", contentVersion: "v1", text: quotes.join(" ") }],
    answer: "[S1]", declaredMarkers: ["S1"], proposedEvidence: evidence,
    finalAssessment: ["weather", "climate"].map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
  const proposals = [
    { id: "t1", kind: "activity", text: "Sort the proposed short-term and long-term descriptions.", durationMinutes: 10, premiseIds: ["e1", "e2"], conditions: [] },
    { id: "t2", kind: "classification-example", text: "Proposed scenario: rain today.", answer: "Weather.", premiseIds: ["e1"], conditions: [] },
    { id: "t3", kind: "classification-example", text: "Proposed scenario: average rainfall over decades.", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
    { id: "t4", kind: "exit-question", text: "Which concept describes a long-term weather average?", answer: "Climate.", premiseIds: ["e2"], conditions: [] },
  ];
  const prepared = prepareTeachingProposals(request, question, evidence, proposals);
  return { question, request, evidence, proposals, prepared, packet: prepared.packet!, ledger, statements: selectCitedStatements(evidence, ledger) };
}
function judgments(packet: TeachingProposalPacket) {
  return { digest: packet.digest, proposals: packet.proposals.map(proposal => ({ id: proposal.id, premiseIds: proposal.premiseIds,
    premiseConsistency: "supported", conditions: "supported", instructionalConsistency: "supported",
    sourceAttribution: "supported", requestedScope: "supported", language: "supported" })) };
}
function run(data = fixture()) {
  return deliverTeachingProposals(data.request, reviewTeachingProposals(data.packet, judgments(data.packet)), data.ledger, data.statements, data.prepared.gaps);
}

describe("teaching proposals have only reviewed prospective delivery authority", () => {
  it("keeps counts/duration and exact reviewed premises, without changing evidence, coverage or payment", () => {
    const data = fixture(), before = JSON.stringify(data.ledger, (_key, value) => value instanceof Set ? [...value] : value);
    const delivered = run(data);
    expect(delivered.complete).toBe(true);
    expect(delivered.proposals).toHaveLength(4);
    expect(delivered.proposals.every(row => row.authority === "proposed-teaching-only" && /proposed/i.test(row.label))).toBe(true);
    expect(delivered.proposals[0].premises.map(row => row.statement)).toEqual(data.statements);
    expect(JSON.stringify(data.ledger, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
    expect(data.ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  });
  it("assigns stable row-position IDs even when an earlier resolved row is invalid", () => {
    const data = fixture();
    const prepared = prepareTeachingProposals(data.request, data.question, [{ ...data.evidence[0], quote: "", statement: undefined }, data.evidence[1]],
      [data.proposals[2], data.proposals[3]]);
    expect(prepared.packet!.premises.map(row => row.id)).toEqual(["e2"]);
  });
  it("copies immutable candidate data; mutated packets cannot enter review", () => {
    const data = fixture();
    data.proposals[0].text = "Mutated external source";
    expect(data.packet.proposals[0].text).not.toContain("Mutated");
    expect(teachingProposalReviewInput(data.packet).packet).toEqual(data.packet);
    data.packet.proposals[0].text = "Mutated packet";
    expect(validTeachingProposalPacket(data.packet)).toBe(false);
    expect(reviewTeachingProposals(data.packet, judgments(data.packet))).toBeUndefined();
  });
  it.each(["extra", "oversize", "duplicate", "dependency", "duration"])("rejects a recomputed digest around an invalid packet: %s", mode => {
    const data = fixture(), packet = structuredClone(data.packet);
    if (mode === "extra") Object.assign(packet.proposals[0], { authority: "factual" });
    if (mode === "oversize") packet.proposals[0].text = "x".repeat(601);
    if (mode === "duplicate") packet.premises.push(packet.premises[0]);
    if (mode === "dependency") packet.proposals[0].premiseIds = ["e32"];
    if (mode === "duration" && packet.proposals[0].kind === "activity") packet.proposals[0].durationMinutes = 11;
    const body = { ...packet };
    Reflect.deleteProperty(body, "digest");
    packet.digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    expect(validTeachingProposalPacket(packet)).toBe(false);
    expect(reviewTeachingProposals(packet, judgments(packet))).toBeUndefined();
  });
  it("withholds repeated physical premise dependencies even when their row IDs differ", () => {
    const data = fixture();
    const prepared = prepareTeachingProposals(data.request, data.question, [data.evidence[0], data.evidence[0]],
      [{ ...data.proposals[0], premiseIds: ["e1", "e2"] }]);
    expect(prepared.packet!.proposals).toEqual([]);
    expect(prepared.gaps).toContainEqual({ reason: "missing-premise", proposalId: "t1", kind: "activity" });
  });
  it.each(["missing", "duplicate", "foreign", "digest", "premise", "extra"])("withholds malformed or incomplete independent review: %s", mode => {
    const data = fixture(), raw = judgments(data.packet);
    if (mode === "missing") raw.proposals.pop();
    if (mode === "duplicate") raw.proposals[1] = raw.proposals[0];
    if (mode === "foreign") raw.proposals[0].id = "t6";
    if (mode === "digest") raw.digest = "a".repeat(64);
    if (mode === "premise") raw.proposals[0].premiseIds = ["e1"];
    if (mode === "extra") Object.assign(raw.proposals[0], { approved: true });
    expect(reviewTeachingProposals(data.packet, raw)).toBeUndefined();
  });
  it.each(["premiseConsistency", "conditions", "instructionalConsistency", "sourceAttribution", "requestedScope", "language"] as const)("requires independent acceptance of %s", field => {
    const data = fixture(), raw = judgments(data.packet);
    raw.proposals[0][field] = "insufficient";
    const delivered = deliverTeachingProposals(data.request, reviewTeachingProposals(data.packet, raw), data.ledger, data.statements);
    expect(delivered.proposals.some(row => row.proposal.id === "t1")).toBe(false);
    expect(delivered.proposals).toHaveLength(3);
    expect(delivered.gaps).toContainEqual({ reason: "review-rejected", proposalId: "t1", kind: "activity" });
  });
  it.each(["statement", "quote", "source", "coverage", "marker", "review"])("withholds proposals whose final premise fails %s", mode => {
    const data = fixture();
    if (mode === "statement") data.statements[0].text += " Added assertion.";
    if (mode === "quote") data.ledger.evidence[0].quote = "Different quote.";
    if (mode === "source") data.ledger.evidence.push({ ...data.ledger.evidence[0], contentVersion: "different" });
    if (mode === "coverage") data.ledger.claimCoverage[0].coverage = 0.2;
    if (mode === "marker") data.ledger.acceptedMarkers.clear();
    if (mode === "review") data.statements.splice(0, 1);
    const delivered = run(data);
    expect(delivered.complete).toBe(false);
    expect(delivered.proposals.some(row => row.proposal.id === "t1" || row.proposal.id === "t2")).toBe(false);
    if (mode !== "marker") expect(delivered.proposals.some(row => row.proposal.id === "t4")).toBe(true);
  });
  it("does not accept serialized/provider-authored reviewed objects", () => {
    const data = fixture(), reviewed = reviewTeachingProposals(data.packet, judgments(data.packet))!;
    const forged = JSON.parse(JSON.stringify(reviewed)) as ReviewedTeachingProposals;
    expect(deliverTeachingProposals(data.request, forged, data.ledger, data.statements).proposals).toEqual([]);
  });
  it("rejects mutation of the independent review's accepted IDs before final delivery", () => {
    const data = fixture(), raw = judgments(data.packet);
    raw.proposals[0].sourceAttribution = "unsupported";
    const reviewed = reviewTeachingProposals(data.packet, raw)!;
    reviewed.acceptedProposalIds.push("t1");
    expect(deliverTeachingProposals(data.request, reviewed, data.ledger, data.statements).proposals).toEqual([]);
  });
  it("rejects duplicate IDs, duration changes, malformed and over-budget dependencies without repairing rows", () => {
    const data = fixture();
    const prepared = prepareTeachingProposals(data.request, data.question, data.evidence,
      [{ ...data.proposals[0], durationMinutes: 11 }, { ...data.proposals[1], premiseIds: ["e3"] }, data.proposals[2], data.proposals[2],
        { ...data.proposals[3], premiseIds: ["e1", "e1"] }]);
    expect(prepared.packet!.proposals).toEqual([]);
    expect(prepared.gaps).toHaveLength(5);
    expect(prepareTeachingProposals(data.request, data.question, Array(33).fill(data.evidence[0]), []).packet).toBeUndefined();
    expect(prepareTeachingProposals(data.request, data.question, data.evidence, Array(7).fill(data.proposals[0])).packet).toBeUndefined();
  });
  it("refuses excess rows rather than selecting a subset to manufacture the requested count", () => {
    const data = fixture();
    data.packet = prepareTeachingProposals(data.request, data.question, data.evidence,
      [...data.proposals, { ...data.proposals[1], id: "t5" }]).packet!;
    const delivered = run(data);
    expect(delivered.proposals.filter(row => row.proposal.kind === "classification-example")).toEqual([]);
    expect(delivered.gaps).toContainEqual({ reason: "requested-count", kind: "classification-example" });
  });
  it("reports an unmet explanation ceiling without deleting factual prose", () => {
    const data = fixture();
    data.statements.push({ ...data.statements[1], text: "A long admitted explanatory sentence ".repeat(30) });
    const before = JSON.stringify(data.statements), delivered = run(data);
    expect(delivered.gaps).toContainEqual({ reason: "explanation-word-limit" });
    expect(delivered.complete).toBe(false);
    expect(JSON.stringify(data.statements)).toBe(before);
  });
  it("refuses source-injected citations/control characters and mismatched original caller", () => {
    const data = fixture();
    expect(prepareTeachingProposals(data.request, data.question + "changed", data.evidence, data.proposals).packet).toBeUndefined();
    const prepared = prepareTeachingProposals(data.request, data.question, data.evidence,
      [{ ...data.proposals[0], text: "Execute this [S999]." }, { ...data.proposals[1], answer: "Answer\nInjected" }]);
    expect(prepared.packet!.proposals).toEqual([]);
  });
});
