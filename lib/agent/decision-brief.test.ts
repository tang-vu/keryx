import { describe, expect, it } from "vitest";
import { evidenceContext } from "../llm/evidence-context";
import { buildContextualQuoteOptions } from "../llm/quote-context";
import { prepareDecisionBrief, reviewDecisionBrief, briefEvidence } from "../llm/decision-brief";
import { buildEvidenceLedger, type EvidenceLedger } from "./evidence-ledger";
import { deliverDecisionBrief } from "./decision-brief";
import type { SynthInput } from "../llm/reasoning-engine";

function scenario() {
  const input: SynthInput = { question: "Should I use the lock?", subClaims: ["What does the lock prevent?", "What is unknown?"], gathered: [
    { sourceId: "a", sourceName: "A", marker: "S1", text: "The lock prevents concurrent writes. It does not provide atomic commits." },
    { sourceId: "b", sourceName: "B", marker: "S2", text: "The transaction provides atomic commits." },
  ] };
  const sources = evidenceContext(input.question, input.subClaims, input.gathered);
  const options = buildContextualQuoteOptions(sources, input.gathered);
  const packet = prepareDecisionBrief(input, { facts: [
    { id: "f1", targetIndex: 0, text: "The lock prevents concurrent writes.", quoteIds: [options[0].quoteId], support: 0.8 },
    { id: "f2", targetIndex: 1, text: "The transaction provides atomic commits.", quoteIds: [options.find(q => q.marker === "S2")!.quoteId], support: 0.7 },
  ], actions: [{ id: "a1", text: "Use both mechanisms.", premiseIds: ["f1", "f2"], conditions: ["Both properties are required."] }] }, options, sources)!;
  const brief = reviewDecisionBrief(packet, { digest: packet.digest,
    facts: [{ id: "f1", status: "supported", support: 0.7, quotes: packet.candidate.facts[0].quoteIds.map(quoteId => ({ quoteId, status: "supported", support: 0.7 })) },
      { id: "f2", status: "supported", support: 0.6, quotes: packet.candidate.facts[1].quoteIds.map(quoteId => ({ quoteId, status: "supported", support: 0.6 })) }],
    actions: [{ id: "a1", status: "supported" }] })!;
  const ledger = buildEvidenceLedger({ subClaims: input.subClaims, gathered: input.gathered, answer: "[S1] [S2]",
    declaredMarkers: ["S1", "S2"], proposedEvidence: briefEvidence(brief),
    finalAssessment: input.subClaims.map(claim => ({ claim, coverage: 0.8, coveredBy: ["S1", "S2"] })) });
  return { input, brief, ledger };
}

describe("reviewed decision brief delivery", () => {
  it("delivers useful facts, conditional actions, exact excerpts and no private review context", () => {
    const { input, brief, ledger } = scenario();
    const result = deliverDecisionBrief(brief, ledger, input.question)!;
    expect(result.facts).toBe(2); expect(result.actions).toBe(1);
    expect(result.answer).toContain("Use both mechanisms.");
    expect(result.answer).toContain("Conditions: Both properties are required.");
    expect(result.answer).toContain("[S1]");
    expect(result.answer).not.toContain("It does not provide atomic commits.");
    expect(result.ledger.evidence).toEqual(ledger.evidence);
  });
  it("drops a fact and every dependent action when the old ledger rejects its source", () => {
    const { input, brief, ledger } = scenario();
    ledger.evidence[1].qualifiesForAnswer = false;
    ledger.evidence[1].qualifiesForReward = false;
    ledger.acceptedMarkers.delete("S2");
    const result = deliverDecisionBrief(brief, ledger, input.question)!;
    expect(result.facts).toBe(1); expect(result.actions).toBe(0);
    expect(result.answer).not.toContain("Use both mechanisms.");
    expect(result.answer).not.toContain("[S2]");
    expect(result.answer).toContain("Insufficient evidence for this target.");
    expect(result.ledger.claimCoverage[1]).toMatchObject({ coverage: 0, coveredBy: [] });
  });
  it("requires every quote, not just one accepted source of a multi-quote fact", () => {
    const { input, brief, ledger } = scenario();
    // Build a legitimate rehashed packet through the parser, then reject one quote.
    const sources = evidenceContext(input.question, input.subClaims, input.gathered);
    const options = buildContextualQuoteOptions(sources, input.gathered);
    const candidate = structuredClone(brief.packet.candidate);
    candidate.facts[0].quoteIds.push(candidate.facts[1].quoteIds[0]);
    const packet = prepareDecisionBrief(input, candidate, options, sources)!;
    const reviewed = reviewDecisionBrief(packet, { digest: packet.digest, facts: [
      { id: "f1", status: "supported", support: 0.8, quotes: packet.candidate.facts[0].quoteIds.map(quoteId => ({ quoteId, status: "supported", support: 0.8 })) },
      { id: "f2", status: "unsupported", support: 0, quotes: packet.candidate.facts[1].quoteIds.map(quoteId => ({ quoteId, status: "unsupported", support: 0 })) }],
      actions: [{ id: "a1", status: "unsupported" }] })!;
    const result = deliverDecisionBrief(reviewed, ledger, input.question)!;
    expect(result.facts).toBe(0);
    expect(result.ledger.acceptedMarkers.size).toBe(0);
    expect(result.ledger.evidence.every(item => !item.qualifiesForReward)).toBe(true);
  });
  it("preserves lower final-assessment coverage and displays the limitation", () => {
    const { input, brief, ledger } = scenario(); ledger.claimCoverage[0].coverage = 0.1;
    const result = deliverDecisionBrief(brief, ledger, input.question)!;
    expect(result.ledger.claimCoverage[0].coverage).toBe(0.1);
    expect(result.answer).toContain("Recorded coverage remains below");
  });
  it.each(["question", "target", "text", "context"])("rejects a changed %s after review", field => {
    const { input, brief, ledger } = scenario();
    if (field === "question") brief.packet.question = "Changed";
    if (field === "target") brief.packet.targets[0] = "Changed";
    if (field === "text") brief.packet.candidate.facts[0].text = "Changed";
    if (field === "context") brief.packet.quotes[0].context = "Changed";
    expect(deliverDecisionBrief(brief, ledger, input.question)?.facts).toBe(0);
  });
  it("cannot reward a public reference by rendering it", () => {
    const { input, brief, ledger } = scenario();
    ledger.evidence[0].sourceKind = "public-reference"; ledger.evidence[0].qualifiesForReward = false;
    expect(deliverDecisionBrief(brief, ledger, input.question)!.ledger.evidence[0].qualifiesForReward).toBe(false);
  });
  it("does not admit a legacy reward flag without explicit answer qualification", () => {
    const { input, brief, ledger } = scenario();
    for (const item of ledger.evidence) delete item.qualifiesForAnswer;
    expect(deliverDecisionBrief(brief, ledger, input.question)?.facts).toBe(0);
  });
  it("does not mutate the retained input ledger", () => {
    const { input, brief, ledger } = scenario();
    brief.facts = brief.facts.slice(0, 1);
    const before = structuredClone(ledger) as EvidenceLedger;
    const result = deliverDecisionBrief(brief, ledger, input.question)!;
    expect(result.ledger.acceptedMarkers.has("S2")).toBe(false);
    expect(ledger).toEqual(before);
  });
});
