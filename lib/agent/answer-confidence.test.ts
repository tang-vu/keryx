import { describe, expect, it } from "vitest";
import { fixtureEvidenceSpans } from "../../test-support/evidence-fixtures";
import type { GatheredContent } from "../llm/reasoning-engine";
import { buildEvidenceLedger } from "./evidence-ledger";
import { selectCitedStatements } from "./cited-statements";
import { reviewedSummaryConfidence } from "./answer-confidence";

function fixture() {
  const sources: GatheredContent[] = [
    { marker: "S1", sourceId: "a", sourceName: "A", itemUrl: "https://a.example/approval",
      text: "The protocol binds approval to canonical action identity." },
    { marker: "S2", sourceId: "b", sourceName: "B", itemUrl: "https://b.example/approval",
      text: "Approval must be tied to the canonical identifier of an action." },
  ];
  const proposals = fixtureEvidenceSpans(sources, sources.map((source, index) => ({ claimIndex: 0,
    marker: source.marker, quote: source.text, support: 0.9, statementSupport: 0.9,
    statement: index ? "Action approval requires the canonical identifier." : "Approval is bound to the canonical identity of the action." })));
  const ledger = buildEvidenceLedger({ subClaims: ["How is approval bound?"], gathered: sources,
    answer: "Approval binding [S1] [S2].", declaredMarkers: ["S1", "S2"], proposedEvidence: proposals,
    finalAssessment: [{ claim: "How is approval bound?", coverage: 0.9, coveredBy: ["S1", "S2"] }] });
  return { ledger, sources, statements: selectCitedStatements(proposals, ledger),
    conflicts: [], finalAssessmentSufficient: true };
}

describe("confidence in delivered reviewed summaries", () => {
  it("distinguishes absent, singly supported and strongly corroborated sentences without changing the ledger", () => {
    const input = fixture(), before = JSON.stringify(input);
    expect(reviewedSummaryConfidence(input).level).toBe("High");
    expect(reviewedSummaryConfidence({ ...input, statements: input.statements.slice(0, 1) }).level).toBe("Moderate");
    expect(reviewedSummaryConfidence({ ...input, statements: [] }).level).toBe("Low");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("requires a reviewed sentence for every target even when the excerpt ledger claims full coverage", () => {
    const input = fixture();
    input.ledger.claimCoverage.push({ claimIndex: 1, claim: "What happens on failure?", coverage: 0.9, coveredBy: ["S1", "S2"] });
    expect(reviewedSummaryConfidence(input)).toMatchObject({ level: "Low", reason: expect.stringContaining("below the evidence threshold") });
    expect(reviewedSummaryConfidence({ ...fixture(), finalAssessmentSufficient: false }).level).toBe("Low");
  });

  it("cannot reuse hidden, unbound, weak or duplicate evidence as strong corroboration", () => {
    const input = fixture();
    const second = input.ledger.evidence.find(item => item.marker === "S2")!;
    second.support = 0.4;
    expect(reviewedSummaryConfidence(input).level).toBe("Moderate");
    second.support = 0.9;
    expect(reviewedSummaryConfidence({ ...input, statements: input.statements.map(statement =>
      statement.marker === "S2" ? { ...statement, quote: "An unbound quote" } : statement) }).level).toBe("Moderate");
    expect(reviewedSummaryConfidence({ ...input, sources: input.sources.map(source =>
      ({ ...source, itemUrl: `https://${source.sourceId}.same.example/approval` })) }).level).toBe("Moderate");
    expect(reviewedSummaryConfidence({ ...input, sources: input.sources.map(source =>
      ({ ...source, text: "Identical republished document." })) }).level).toBe("Moderate");
  });

  it("keeps unresolved disagreement Low and explained source preferences at Moderate", () => {
    const input = fixture(), conflict = { point: "approval", positions: [
      { marker: "S1", stance: "required" }, { marker: "S2", stance: "optional" }], trusted: "none", reason: "No precedence" };
    expect(reviewedSummaryConfidence({ ...input, conflicts: [conflict] }).level).toBe("Low");
    expect(reviewedSummaryConfidence({ ...input, conflicts: [{ ...conflict, trusted: "S1" }] }).level).toBe("Moderate");
  });

  it.each(["en", "vi", "pt", "es"] as const)("preserves factual limits and localized classifications in %s", language => {
    const input = fixture();
    expect(reviewedSummaryConfidence(input, language).level).toBe("High");
    input.sources[0].evidenceProvenance = "synthetic-demo";
    expect(reviewedSummaryConfidence(input, language).level).toBe("Low");
  });

  it("keeps Low when a synthetic further excerpt is delivered alongside real reviewed sentences", () => {
    const input = fixture();
    input.ledger.acceptedMarkers.add("S3");
    input.ledger.evidence.push({ ...input.ledger.evidence[0], marker: "S3", sourceId: "demo", evidenceProvenance: "synthetic-demo" });
    expect(reviewedSummaryConfidence(input)).toMatchObject({ level: "Low", reason: expect.stringContaining("synthetic") });
    input.ledger.evidence.at(-1)!.qualifiesForAnswer = false;
    expect(reviewedSummaryConfidence(input).level).toBe("Low");
    expect(reviewedSummaryConfidence({ ...fixture(), hasSyntheticDecision: true }).level).toBe("Low");
  });
});
