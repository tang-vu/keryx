import { describe, expect, it } from "vitest";
import { buildEvidenceLedger, extractAnswerMarkers } from "./evidence-ledger";
import { finalizeGroundedAnswer } from "./answer-grounding";
import { selectCitedStatements } from "./cited-statements";
import { applyEvidenceReview } from "../llm/evidence-review";
import { resolveQuoteEvidence, buildQuoteOptions } from "../llm/quote-options";
import { evidenceContext } from "../llm/evidence-context";
import { JsonChatEngine } from "../llm/json-chat-engine";
import type { GatheredContent, ProposedEvidence } from "../llm/reasoning-engine";

// Synthetic passages; they exercise the delivery boundary, not any real document.
const claims = ["How is approval bound?", "What does the evaluation cover?"];
const bindQuote = "The protocol binds approval to the canonical action identity.";
const benchQuote = "The benchmark includes ten commands.";
const sources: GatheredContent[] = [
  { marker: "S1", sourceId: "paper", sourceName: "Synthetic paper", sourceKind: "public-reference",
    text: `${bindQuote} ${benchQuote}` },
];
const bind: ProposedEvidence = { claimIndex: 0, marker: "S1", quote: bindQuote,
  quoteSpan: { start: 0, end: bindQuote.length }, support: 0.9,
  statement: "Approval is bound to the canonical identity of the action.", statementSupport: 0.9 };
const bench: ProposedEvidence = { claimIndex: 1, marker: "S1", quote: benchQuote,
  quoteSpan: { start: bindQuote.length + 1, end: bindQuote.length + 1 + benchQuote.length }, support: 0.9,
  statement: "The evaluation eliminates every known attack.", statementSupport: 0.2 };

function ledgerFor(proposals: ProposedEvidence[]) {
  return buildEvidenceLedger({ subClaims: claims, gathered: sources, answer: "Draft [S1].",
    declaredMarkers: ["S1"], proposedEvidence: proposals,
    finalAssessment: claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
}

describe("cited statement delivery", () => {
  it("delivers a reviewed sentence above its excerpt and withholds one the review did not accept", () => {
    const ledger = ledgerFor([bind, bench]);
    const statements = selectCitedStatements([bind, bench], ledger);
    expect(statements.map(item => item.text)).toEqual([bind.statement]);
    const answer = finalizeGroundedAnswer({ question: "Compare", answer: "Draft [S1].", ledger, statements });
    expect(answer).toContain("Model-written summary with sentence-level citations.");
    expect(answer).toContain(`${bind.statement} [S1] Source text: “${bindQuote}”`);
    expect(answer).not.toContain(`- “${bindQuote}” [S1]`);
    // The unsupported sentence is gone; its literal excerpt is still shown for the target.
    expect(answer).not.toContain("eliminates every known attack");
    expect(answer).toContain(`- “${benchQuote}” [S1]`);
    expect(answer.indexOf(bind.statement!)).toBeLessThan(answer.indexOf(`“${bindQuote}”`));
    expect([...extractAnswerMarkers(answer)]).toEqual(["S1"]);
  });

  it("falls back to excerpt-only delivery when no sentence survives", () => {
    const ledger = ledgerFor([bind, bench]);
    const excerptOnly = finalizeGroundedAnswer({ question: "Compare", answer: "Draft [S1].", ledger });
    expect(finalizeGroundedAnswer({ question: "Compare", answer: "Draft [S1].", ledger, statements: [] })).toBe(excerptOnly);
    expect(excerptOnly).toContain("Source excerpts only.");
    expect(excerptOnly).not.toContain(bind.statement);
  });

  it.each([
    ["below the statement threshold", { ...bind, statementSupport: 0.69 }],
    ["without a review score", { ...bind, statementSupport: undefined }],
    ["whose excerpt fell below the excerpt gate", { ...bind, support: 0.3 }],
    ["whose quote is not in the source", { ...bind, quote: "Approval is always safe.", quoteSpan: undefined }],
    ["with an empty sentence", { ...bind, statement: "   " }],
  ])("withholds a sentence %s", (_name, proposal) => {
    expect(selectCitedStatements([proposal], ledgerFor([proposal]))).toEqual([]);
  });

  it("ignores a statement whose excerpt is absent from the supplied ledger", () => {
    const ledger = ledgerFor([bench]);
    const forged = [{ claimIndex: 0, marker: "S1", quote: bindQuote, text: "Approval is unconditionally safe." }];
    const answer = finalizeGroundedAnswer({ question: "Compare", answer: "Draft [S1].", ledger, statements: forged });
    expect(answer).not.toContain("unconditionally safe");
    expect(answer).toContain("Source excerpts only.");
  });

  it("lets one excerpt carry one sentence and removes embedded citation markers", () => {
    const many = Array.from({ length: 6 }, (_, index): ProposedEvidence => ({ ...bind,
      statement: `Approval binding detail number ${index} [S9].` }));
    const ledger = ledgerFor([bind]);
    // One qualifying excerpt can carry one sentence, regardless of how many were proposed for it.
    const selected = selectCitedStatements(many, ledger);
    expect(selected).toHaveLength(1);
    expect(selected[0].text).toBe("Approval binding detail number 0.");
  });

  it("answers in Vietnamese for a Vietnamese question", () => {
    const ledger = ledgerFor([bind]);
    const answer = finalizeGroundedAnswer({ question: "So sánh hai bài nghiên cứu, trả lời bằng tiếng Việt.",
      answer: "Draft [S1].", ledger, statements: selectCitedStatements([bind], ledger) });
    expect(answer).toContain("Tóm tắt do mô hình viết, trích dẫn theo từng câu.");
    expect(answer).toContain("Nguyên văn nguồn: “");
  });
});

describe("statement review authority", () => {
  const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote: bindQuote, support: 0.9, statement: bind.statement };
  it("takes statement support only from an unambiguous review of the same row", () => {
    expect(applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.9, statementSupport: 0.8 }] })[0].statementSupport).toBe(0.8);
    expect(applyEvidenceReview([{ ...proposal, statementSupport: 1 }], { reviews: [{ index: 0, support: 0.9 }] })[0].statementSupport).toBe(0);
    expect(applyEvidenceReview([{ ...proposal, statementSupport: 1 }], undefined)[0].statementSupport).toBe(0);
    expect(applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.9, statementSupport: 1 },
      { index: 0, support: 0.9, statementSupport: 1 }] })[0].statementSupport).toBe(0);
  });
  it("never attaches statement support to a row without a statement", () => {
    const [reviewed] = applyEvidenceReview([{ claimIndex: 0, marker: "S1", quote: bindQuote, support: 0.9 }],
      { reviews: [{ index: 0, support: 0.9, statementSupport: 1 }] });
    expect(reviewed).not.toHaveProperty("statementSupport");
  });
  it("drops a sentence proposed for an unknown or mismatched quote", () => {
    const options = buildQuoteOptions(evidenceContext("How?", claims, sources), sources);
    const [unknown, wrongMarker] = resolveQuoteEvidence([
      { claimIndex: 0, marker: "S1", quoteId: "missing", support: 1, statement: bind.statement },
      { claimIndex: 0, marker: "S2", quoteId: options[0].quoteId, support: 1, statement: bind.statement },
    ], options);
    expect(unknown.statement).toBeUndefined();
    expect(wrongMarker.statement).toBeUndefined();
  });
});

describe("synthesis with cited statements", () => {
  class Engine extends JsonChatEngine {
    readonly name = "test";
    requests: string[] = [];
    constructor(private readonly review: (rows: { index: number; statement?: string }[]) => unknown) { super(); }
    protected async chatJson(_model: string, _system: string, user: string) {
      this.requests.push(user);
      const input = JSON.parse(user) as { quoteOptions?: { quoteId: string; marker: string; text: string }[];
        evidence?: { index: number; statement?: string }[] };
      if (input.evidence) return this.review(input.evidence) as Record<string, unknown>;
      const option = input.quoteOptions!.find(item => item.text === bindQuote)!;
      return { answer: "Draft [S1].", citedMarkers: ["S1"], evidence: [
        { claimIndex: 0, marker: "S1", quoteId: option.quoteId, support: 0.9, statement: bind.statement }] };
    }
  }
  const input = { question: "How is approval bound?", subClaims: claims, gathered: sources };

  it("sends each sentence to the reviewer and returns its reviewed support", async () => {
    const engine = new Engine(rows => ({ reviews: rows.map(row => ({ index: row.index, support: 0.9, statementSupport: 0.85 })) }));
    const result = await engine.synthesize(input);
    expect(JSON.parse(engine.requests[1]).evidence[0].statement).toBe(bind.statement);
    expect(result.evidence[0]).toMatchObject({ statement: bind.statement, statementSupport: 0.85, quote: bindQuote });
    const ledger = buildEvidenceLedger({ subClaims: claims, gathered: sources, answer: result.answer,
      declaredMarkers: result.citedMarkers, proposedEvidence: result.evidence,
      finalAssessment: claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
    expect(selectCitedStatements(result.evidence, ledger)).toHaveLength(1);
  });

  it("delivers no sentence when the review call fails", async () => {
    const engine = new Engine(() => { throw new Error("review timeout"); });
    const result = await engine.synthesize(input);
    expect(result.evidenceReview).toBe("unavailable");
    expect(result.evidence[0].statementSupport).toBe(0);
  });
});
