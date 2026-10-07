import { describe, expect, it } from "vitest";
import { completeEvidenceSpans, isCompleteEvidenceSpan } from "./evidence-span";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { buildEvidenceReviewInput } from "./evidence-review-input";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent } from "./reasoning-engine";

// Invented text exercises structural binding only, never manuscript findings.
function pdf(text: string): GatheredContent {
  return { sourceId: "wrapped-source", sourceName: "Line-wrapped document", marker: "S1", text,
    itemUrl: "https://example.org/document.pdf", sourceKind: "public-reference",
    webProvenance: { retrievedAt: "2026-10-07T00:00:00Z", publisherGroup: "example.org",
      normalizedBodyHash: "fixture", extraction: "pdf", truncated: false } };
}

describe("observed PDF sentence boundaries", () => {
  it.each(["\n", "\r", "\r\n"])("keeps a wrapped sentence and refuses its suffix for %j", wrap => {
    const quote = `An approval must bind to the exact action${wrap}arguments before execution.`;
    const source = pdf(`${quote} A later limitation remains visible.`);
    expect(completeEvidenceSpans(source)).toContainEqual({ start: 0, end: quote.length });
    const suffix = "arguments before execution.", start = source.text.indexOf(suffix);
    expect(isCompleteEvidenceSpan(source, suffix, { start, end: start + suffix.length })).toBe(false);
    const options = buildQuoteOptions(evidenceContext("approval action arguments", [], [source]), [source]);
    expect(options.map(option => option.text)).toContain(quote);
    expect(options.map(option => option.text)).not.toContain(suffix);
    expect(isCompleteEvidenceSpan(source, quote.replace(/[\r\n]/g, " "), { start: 0, end: quote.length })).toBe(false);
  });

  it.each([239, 240, 241])("measures the %i-character quote in original UTF-16 text", length => {
    const prefix = "The approved action\r\n", quote = prefix + "x".repeat(length - prefix.length - 1) + ".";
    const source = pdf(quote + " A separate complete limitation remains.");
    const spans = completeEvidenceSpans(source);
    expect(spans.some(span => span.start === 0 && span.end === quote.length)).toBe(length <= 240);
    const options = buildQuoteOptions(evidenceContext("approved action", [], [source]), [source]);
    expect(options.some(option => option.text === quote)).toBe(length <= 240);
    expect(options.every(option => option.text.length <= 240)).toBe(true);
  });

  it("retains a late wrapped sentence and nearby caveat within existing context and review budgets", () => {
    const quote = "A nonce pins the selected action\narguments before execution.";
    const caveat = "This rule does not cover an unobserved execution path.";
    const text = "General background is unrelated. ".repeat(130) + "\n" + quote + " " + caveat + "\n" + "Unrelated background. ".repeat(110);
    const source = pdf(text), question = "nonce pins selected action arguments execution";
    const context = evidenceContext(question, [question], [source])[0];
    expect(context.passages.some(passage => passage.text.includes(quote) && passage.text.includes(caveat))).toBe(true);
    expect(context.passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const passage of context.passages) expect(passage.text).toBe(text.slice(passage.start, passage.end));
    expect(context.candidateSelection?.retained).toBeLessThanOrEqual(33);
    const options = buildQuoteOptions([context], [source]), option = options.find(value => value.text === quote)!;
    expect(option).toBeDefined();
    expect(option.context).toContain(caveat);
    expect(option.context.length).toBeLessThanOrEqual(1200);
    expect(option.context).toBe(text.slice(option.contextStart, option.contextEnd));
    const proposals = resolveQuoteEvidence([{ claimIndex: 0, marker: "S1", quoteId: option.quoteId, support: 0.8 }], options);
    const review = buildEvidenceReviewInput({ proposals, options, gathered: [source], subClaims: [question] });
    expect([...review.reviewedIndexes]).toEqual([0]);
    expect(JSON.parse(review.json).evidence[0].context.text).toContain(caveat);
    expect(source.webProvenance?.normalizedBodyHash).toBe("fixture");
  });

  it("never joins separately selected passages or recovers a repeated quote at another offset", () => {
    const quote = "An approval binds the exact\naction before execution.", source = pdf(`${quote} ${quote}`);
    const context = evidenceContext("approval action", [], [source])[0];
    const options = buildQuoteOptions([context], [source]).filter(option => option.text === quote);
    expect(options.map(option => option.start)).toEqual([0, quote.length + 1]);
    const split = quote.indexOf("\n");
    const fragments = { ...context, passages: [{ start: 0, end: split, text: quote.slice(0, split) },
      { start: split + 1, end: quote.length, text: quote.slice(split + 1) }] };
    expect(buildQuoteOptions([fragments], [source])).toEqual([]);
    expect(isCompleteEvidenceSpan(source, quote, { start: 1, end: quote.length + 1 })).toBe(false);
  });

  it("retains the existing unique physical-heading hint independently of PDF sentence blocks", () => {
    const rule = "Approvals bind the exact\narguments before execution.";
    const caveat = "An unobserved path remains outside this rule.";
    const source = { ...pdf("Background detail. ".repeat(300) + "\nRuntime boundary\n" + rule + " " + caveat + "\n" + "Background detail. ".repeat(100)),
      requestedSource: { urls: ["https://example.org/document.pdf#runtime-boundary"], readScope: "bounded-whole-document" as const } };
    const context = evidenceContext("Phân tích giới hạn", ["Phân tích giới hạn"], [source])[0];
    expect(context.passages.some(passage => passage.text.includes(rule) && passage.text.includes(caveat))).toBe(true);
    expect(context.passages.reduce((total, passage) => total + passage.text.length, 0)).toBeLessThanOrEqual(2000);
    for (const passage of context.passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
  });

  it("rejects a wrapped-line suffix at the ledger gate even when a caller proposes high support", () => {
    const quote = "An approval must bind the exact\naction before execution.", source = pdf(quote);
    const suffix = "action before execution.", start = quote.indexOf(suffix);
    const ledger = buildEvidenceLedger({ subClaims: ["What must approval bind?"], gathered: [source],
      answer: "An approval binds the action [S1].", declaredMarkers: ["S1"],
      proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: suffix, quoteSpan: { start, end: quote.length }, support: 1 }],
      finalAssessment: [{ claim: "What must approval bind?", coverage: 1, coveredBy: ["S1"] }] });
    expect(ledger.acceptedMarkers.size).toBe(0);
    expect(ledger.droppedEvidence).toBe(1);
  });

  it("withholds malformed and cut tails while preserving exact emoji offsets", () => {
    const quote = "The approved action\ncontains an emoji 😀.", source = pdf(quote);
    expect(completeEvidenceSpans(source)).toEqual([{ start: 0, end: quote.length }]);
    expect(completeEvidenceSpans(pdf(quote + "\ud800"))).toEqual([]);
    expect(completeEvidenceSpans({ ...source, webProvenance: { ...source.webProvenance!, truncated: true } })).toEqual([]);
    const first = "The first sentence remains available.", prefix = first + " " + "X".repeat(199_999 - first.length - 1);
    expect(completeEvidenceSpans(pdf(prefix + "😀 followed by unavailable words."))).toEqual([{ start: 0, end: first.length }]);
  });

  it("does not activate PDF boundary treatment from a title, URL or bibliography", () => {
    const text = "An approval must bind to the exact action\narguments before execution.";
    const ordinary = { ...pdf(text), webProvenance: undefined, sourceName: "PDF paper metadata" };
    expect(completeEvidenceSpans(ordinary)).toEqual(completeEvidenceSpans({ ...ordinary, itemUrl: "https://example.org/plain" }));
    const html = { ...ordinary, webProvenance: { ...pdf(text).webProvenance!, extraction: "html" as const } };
    expect(completeEvidenceSpans(html)).toEqual(completeEvidenceSpans(ordinary));
  });
});
