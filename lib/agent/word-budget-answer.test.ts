import { describe, expect, it } from "vitest";
import rfc from "../../scripts/fixtures/deliverable-rfc-public-20261009.json";
import { compactWordBudgetAnswer, finishWordBudgetAnswer } from "./word-budget-answer";
import type { EvidenceLedger } from "./evidence-ledger";
import type { CitedStatement } from "./cited-statements";
import { completeAnswerWords } from "../research/answer-word-budget";
import { ordinaryConfidence } from "../research/confidence-copy";

// Recorded public renderer input only: this is not a replay of span admission or model review.
function recordedProjection() {
  const claims = ["Which fields require quotes?", "How are quotes escaped?", "Internet standard status"];
  const statements: CitedStatement[] = rfc.bindings.map((binding, index) => ({ claimIndex: index,
    marker: binding.marker, quote: binding.quote,
    text: rfc.answer.split("\n\n").find(paragraph => paragraph.includes(`[${binding.marker}] Source text:`) &&
      paragraph.includes(binding.quote.replace(/[\r\n]+/g, " ")))!.split(" [S1] Source text:")[0] }));
  const ledger: EvidenceLedger = { evidence: rfc.bindings.map((binding, index) => ({ ...binding,
    claim: claims[index], sourceName: "Recorded public RFC source", support: 1 })), claimCoverage: claims.map((claim, claimIndex) => ({ claimIndex, claim,
      coverage: 1, coveredBy: ["S1"] })), acceptedMarkers: new Set(["S1"]), droppedEvidence: 0, droppedCitations: [] };
  return { ledger, statements, confidence: ordinaryConfidence("en", "summary",
    "1 evidence-verified source cover every sub-claim, but corroboration or support strength is limited"),
  suffix: rfc.answer.slice(rfc.answer.indexOf("### Supplied original source status")) };
}

describe("complete-answer word-budget projection", () => {
  it("fits the retained three RFC pairs plus confidence and original status within180, keeping evidence bytes/flags", () => {
    const data = recordedProjection();
    const snapshot = () => JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value);
    const before = snapshot();
    const compact = compactWordBudgetAnswer(data.ledger, data.statements, data.confidence)! + "\n\n" + data.suffix;
    const delivered = finishWordBudgetAnswer(rfc.answer, compact, 180);
    expect(delivered.outcome).toBe("compact");
    expect(completeAnswerWords(delivered.answer)).toBeLessThanOrEqual(180);
    expect(delivered.words).toBe(178);
    for (const statement of data.statements) {
      const paragraph = delivered.answer.split("\n\n").find(row => row.includes(statement.text));
      expect(paragraph).toContain(`[${statement.marker}] Source text: “${statement.quote.replace(/[\r\n]+/g, " ")}”`);
    }
    expect(delivered.answer).toContain(data.confidence.reason);
    expect(delivered.answer).toContain(data.suffix);
    expect(delivered.answer).toContain("Grounding proves neither truth nor entailment.");
    expect(delivered.answer).toContain("Sources may conflict; payment states remain in receipts.");
    expect(snapshot()).toBe(before);
    expect(data.ledger.evidence.every(item => item.qualifiesForAnswer && !item.qualifiesForReward)).toBe(true);
  });
  it("retains gaps, partial assessments and extra qualified excerpts even when they prevent fitting", () => {
    const data = recordedProjection();
    data.ledger.claimCoverage[0].coverage = 0.2;
    data.ledger.claimCoverage.push({ claimIndex: 3, claim: "Missing requested qualification", coverage: 0, coveredBy: [] });
    data.ledger.evidence.push({ ...data.ledger.evidence[0], quote: "An additional qualifying excerpt stays visible." });
    const compact = compactWordBudgetAnswer(data.ledger, data.statements, data.confidence)!;
    expect(compact).toContain("below the support threshold");
    expect(compact).toContain("Missing requested qualification");
    expect(compact).toContain("no qualifying excerpt");
    expect(compact).toContain("An additional qualifying excerpt stays visible.");
    const full = "Full retained answer " + compact;
    expect(finishWordBudgetAnswer(full, compact, 1)).toMatchObject({ outcome: "unmet",
      answer: expect.stringContaining(full) });
  });
  it("counts ALL operational suffixes, refuses insufficient limits, and preserves an already-fitting answer", () => {
    const data = recordedProjection(), compact = compactWordBudgetAnswer(data.ledger, data.statements, data.confidence)!;
    const notices = "\n\n" + data.suffix + "\n\nRecency observation: qualification unverified. Funding readiness unknown; no new paid attempts.";
    const full = rfc.answer + notices;
    const candidate = compact + notices;
    const delivered = finishWordBudgetAnswer(full, candidate, completeAnswerWords(compact));
    expect(delivered.outcome).toBe("unmet");
    expect(delivered.answer).toContain(full);
    expect(delivered.words).toBe(completeAnswerWords(delivered.answer));
    expect(finishWordBudgetAnswer("Kept", undefined, 180)).toEqual({ answer: "Kept", outcome: "unchanged", words: 1 });
    expect(compactWordBudgetAnswer(data.ledger, [], data.confidence)).toBeUndefined();
  });
});
