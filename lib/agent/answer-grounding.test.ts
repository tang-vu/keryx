import { describe, expect, it } from "vitest";
import { buildEvidenceLedger, extractAnswerMarkers } from "./evidence-ledger";
import { finalizeGroundedAnswer } from "./answer-grounding";
import type { GatheredContent, ProposedEvidence } from "../llm/reasoning-engine";

// Synthetic passages exercise the retained two-paper failure shape, not scientific evidence.
const claims = ["First paper methods", "Second paper methods", "First paper evaluation", "Second paper evaluation", "Limitations"];
const sources: GatheredContent[] = [
  { marker: "S1", sourceId: "first", sourceName: "Synthetic first paper", sourceKind: "public-reference",
    text: "An external mediator observes the action. A benchmark exercises commands." },
  { marker: "S2", sourceId: "second", sourceName: "Synthetic second paper", sourceKind: "public-reference",
    text: "The protocol binds approval to the canonical action identity. Table 6 reports a matrix." },
];
const mixedDraft = "First paper uses a mediator [S1]. Second paper binds approval [S2]. Both fully evaluated every failure mode [S2].";
function ledger(proposedEvidence: ProposedEvidence[], answer = mixedDraft) {
  return buildEvidenceLedger({ subClaims: claims, gathered: sources, answer,
    declaredMarkers: ["S1", "S2"], proposedEvidence,
    finalAssessment: claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1", "S2"] })),
  });
}
const accepted = { claimIndex: 1, marker: "S2", quote: "The protocol binds approval to the canonical action identity.", support: 0.4 };

describe("qualified answer delivery", () => {
  it("withholds rejected-source prose and same-source unsupported assertions, preserving only admitted evidence", () => {
    const measured = ledger([
      { claimIndex: 0, marker: "S1", quote: "An external mediator observes the action.", support: 0.2 },
      accepted,
      { claimIndex: 3, marker: "S2", quote: "Table 6 reports a matrix.", support: 0.3 },
    ]);
    const before = JSON.stringify([...measured.acceptedMarkers, measured.evidence, measured.claimCoverage]);
    const result = finalizeGroundedAnswer({ question: "Compare two papers", answer: mixedDraft, ledger: measured });
    expect(result).not.toContain("uses a mediator");
    expect(result).not.toContain("fully evaluated");
    expect(result).not.toContain("Table 6");
    expect(result).toContain(accepted.quote);
    expect([...extractAnswerMarkers(result)]).toEqual(["S2"]);
    expect(result).toContain("Evidence gap");
    claims.forEach(claim => expect(result).toContain(claim));
    expect(JSON.stringify([...measured.acceptedMarkers, measured.evidence, measured.claimCoverage])).toBe(before);
    expect(measured.evidence.find(item => item.marker === "S2")?.qualifiesForReward).toBe(false);
  });

  it("keeps a fully qualified draft intact even when public evidence earns no reward", () => {
    const answer = "The protocol binds approval [S2].";
    const measured = buildEvidenceLedger({ subClaims: [claims[1]], gathered: sources, answer,
      declaredMarkers: ["S2"], proposedEvidence: [{ ...accepted, claimIndex: 0 }] });
    expect(measured.evidence[0].qualifiesForReward).toBe(false);
    expect(finalizeGroundedAnswer({ question: "How?", answer, ledger: measured })).toBe(answer);
  });

  it("keeps a fully qualified paid draft and its reward gate intact", () => {
    const answer = "The mediator observes the action [S1].";
    const measured = buildEvidenceLedger({ subClaims: [claims[0]], gathered: [{ ...sources[0], sourceKind: undefined }], answer,
      declaredMarkers: ["S1"], proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: "An external mediator observes the action.", support: 0.9 }] });
    expect(measured.evidence[0].qualifiesForReward).toBe(true);
    expect(finalizeGroundedAnswer({ question: "How?", answer, ledger: measured })).toBe(answer);
    expect(measured.evidence[0].qualifiesForReward).toBe(true);
  });

  it("preserves the legacy explicit reward qualification only when answer qualification is absent", () => {
    const answer = "The mediator observes the action [S1].";
    const measured = buildEvidenceLedger({ subClaims: [claims[0]], gathered: [{ ...sources[0], sourceKind: undefined }], answer,
      declaredMarkers: ["S1"], proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: "An external mediator observes the action.", support: 0.9 }] });
    delete measured.evidence[0].qualifiesForAnswer;
    expect(finalizeGroundedAnswer({ question: "How?", answer, ledger: measured })).toBe(answer);
    measured.evidence[0].qualifiesForAnswer = false;
    expect(finalizeGroundedAnswer({ question: "How?", answer, ledger: measured })).not.toContain("mediator observes");
  });

  it("rejects invalid evidence without substituting an invented attribution", () => {
    const measured = ledger([accepted, { claimIndex: 0, marker: "S1", quote: "A fabricated passage that is absent.", support: 1 }]);
    expect(measured.droppedEvidence).toBe(1);
    const answer = finalizeGroundedAnswer({ question: "Compare", answer: mixedDraft, ledger: measured });
    expect(answer).not.toContain("fabricated passage");
    expect([...extractAnswerMarkers(answer)]).toEqual(["S2"]);
  });

  it("returns a completed no-support report when all support is withheld", () => {
    const measured = ledger([{ ...accepted, support: 0 }]);
    const answer = finalizeGroundedAnswer({ question: "Compare", answer: mixedDraft, ledger: measured });
    expect(answer).toContain("No supported answer");
    expect(answer).not.toContain(accepted.quote);
    expect([...extractAnswerMarkers(answer)]).toEqual([]);
  });

  it("uses Vietnamese for the fallback and evidence gaps", () => {
    const answer = finalizeGroundedAnswer({ question: "So sánh hai bài nghiên cứu, trả lời bằng tiếng Việt.",
      answer: mixedDraft, ledger: ledger([accepted]) });
    expect(answer).toContain("Bản nháp");
    expect(answer).toContain("Thiếu bằng chứng");
    expect(answer).not.toContain("Evidence gap");
  });

  it("does not create citation controls from quoted source text or question text", () => {
    const quote = "Source text includes [S99] and <script> markup.";
    const measured = buildEvidenceLedger({ subClaims: ["What about [S98]?"],
      gathered: [{ ...sources[1], text: quote }], answer: "An assertion [S2] plus rejected [S1].",
      declaredMarkers: ["S2"], proposedEvidence: [{ ...accepted, claimIndex: 0, quote }],
    });
    const answer = finalizeGroundedAnswer({ question: "Compare", answer: "An assertion [S2] plus rejected [S1].", ledger: measured });
    expect([...extractAnswerMarkers(answer)]).toEqual(["S2"]);
    expect(answer).toContain("[\u200bS99]");
    expect(answer).toContain("<script>");
  });
});
