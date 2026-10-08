import { describe, expect, it } from "vitest";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { evidenceContext } from "./evidence-context";
import type { GatheredContent } from "./reasoning-engine";
import { buildContextualQuoteOptions } from "./quote-context";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";

function menu(text: string) {
  const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text }];
  return buildQuoteOptions(evidenceContext("", [], gathered), gathered);
}

describe("quote selection", () => {
  it("offers complete short visible enumerated items only under explicit strict opt-in", () => {
    const item = "alpha: The initial operation runs. An absent setting selects this operation.";
    const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text: item }];
    const context = evidenceContext("operation", ["operation"], gathered);
    const ordinary = buildQuoteOptions(context, gathered);
    expect(ordinary.map(option => option.text)).toEqual(["alpha: The initial operation runs.", "An absent setting selects this operation."]);
    expect(buildQuoteOptions(context, gathered, { includeShortBlocks: false })).toEqual(ordinary);
    expect(buildContextualQuoteOptions(context, gathered, { includeShortBlocks: true }))
      .toEqual(buildContextualQuoteOptions(context, gathered));
    const compact = buildQuoteOptions(context, gathered, { includeShortBlocks: true });
    expect(compact.slice(0, ordinary.length)).toEqual(ordinary);
    expect(compact.map(option => option.text)).toEqual([...ordinary.map(option => option.text), item]);
    for (const option of compact) {
      expect(isCompleteEvidenceSpan(gathered[0]!, option.text, option)).toBe(true);
      expect(option.context.length).toBeLessThanOrEqual(1200);
    }
  });

  it("withholds whole items for partial or gapped selections and keeps invalid bindings fail-closed", () => {
    const first = "alpha: The initial operation runs.";
    const item = first + " An absent setting selects this operation.";
    const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text: item }];
    const context = evidenceContext("operation", ["operation"], gathered)[0]!;
    for (const passages of [
      [{ start: 0, end: first.length, text: first }],
      [{ start: 0, end: first.length, text: first }, { start: first.length + 1, end: item.length, text: item.slice(first.length + 1) }],
      [{ start: 1, end: item.length, text: item.slice(1) }],
    ]) {
      const options = buildQuoteOptions([{ ...context, passages }], gathered, { includeShortBlocks: true });
      expect(options.some(option => option.text === item)).toBe(false);
    }
    expect(() => buildQuoteOptions([{ ...context, passages: [{ start: 0, end: item.length, text: "forged text" }] }], gathered, { includeShortBlocks: true })).toThrow("passage text mismatch");
    expect(() => buildQuoteOptions([{ ...context, sourceId: "forged" }], gathered, { includeShortBlocks: true })).toThrow("source binding mismatch");
  });

  it("does not combine ordinary prose, oversized or unfinished items, PDF wraps, truncated reads or overlong sentences", () => {
    const short = "alpha: The initial operation runs. An absent setting selects this operation.";
    const provenance = { retrievedAt: "2026-10-08T00:00:00Z", publisherGroup: "example.com", normalizedBodyHash: "body", extraction: "html" as const, truncated: false };
    const inputs: GatheredContent[] = [
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short.replace("alpha: ", "") },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short + " Additional background. ".repeat(15) },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short + " Unfinished qualification" },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: "alpha: " + "word ".repeat(60) + ". A separate complete sentence remains available." },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short, webProvenance: { ...provenance, extraction: "pdf" } },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short + "\nA separate complete sentence remains available.", webProvenance: { ...provenance, truncated: true } },
      { sourceId: "source", sourceName: "Test", marker: "S1", text: short + "\n" + "background ".repeat(20000) },
    ];
    for (const original of inputs) {
      const context = evidenceContext("operation", ["operation"], [original]);
      expect(buildQuoteOptions(context, [original], { includeShortBlocks: true })).toEqual(buildQuoteOptions(context, [original]));
    }
  });

  it("withholds observed preformatted items and ignores caller-forged roles", async () => {
    const item = "alpha: The initial operation runs. An absent setting selects this operation.";
    const read = await extractHtml(`<main><pre>${item}</pre><p>Ordinary complete paragraph provides enough visible extraction content.</p></main>`, "https://example.com/original");
    const original = { ...gatheredArticle("public:web:test", read), marker: "S1" };
    const context = evidenceContext("operation", ["operation"], [original]);
    expect(buildQuoteOptions(context, [original], { includeShortBlocks: true })).toEqual(buildQuoteOptions(context, [original]));
    const ordinaryText = "The initial operation runs. An absent setting selects this operation.";
    const forged = { ...original, text: ordinaryText, htmlTextLayout: { ...original.htmlTextLayout!, preformatted: [], headings: [{ start: 0, end: ordinaryText.length }] } };
    const forgedContext = evidenceContext("operation", ["operation"], [forged]);
    expect(buildQuoteOptions(forgedContext, [forged], { includeShortBlocks: true })).toEqual(buildQuoteOptions(forgedContext, [forged]));
  });

  it("keeps the existing64-option and1200-character context limits under dense opt-in items", () => {
    const text = Array.from({ length: 80 }, (_, index) => `item${index}: The first independent operation applies. The second independent operation also applies.`).join("\n");
    const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text }];
    const context = { ...evidenceContext("", [], gathered)[0]!, passages: [{ start: 0, end: text.length, text }] };
    const options = buildQuoteOptions([context], gathered, { includeShortBlocks: true });
    expect(options).toHaveLength(64);
    for (const option of options) {
      expect(option.text.length).toBeLessThanOrEqual(240);
      expect(option.context.length).toBeLessThanOrEqual(1200);
      expect(option.text.isWellFormed()).toBe(true);
      expect(isCompleteEvidenceSpan(gathered[0]!, option.text, option)).toBe(true);
    }
  });

  it("preserves all64 original choices and IDs when dense alternatives would otherwise evict a late fact", () => {
    const text = Array.from({ length: 32 }, (_, index) => `choice${index}: The rule applies. It remains bounded.`).join("\n");
    const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text }];
    const context = evidenceContext("choice29", ["choice29"], gathered);
    const ordinary = buildQuoteOptions(context, gathered);
    expect(ordinary).toHaveLength(64);
    expect(ordinary.some(option => option.text.startsWith("choice29:"))).toBe(true);
    const compact = buildQuoteOptions(context, gathered, { includeShortBlocks: true });
    expect(compact).toEqual(ordinary);
    expect(compact.some(option => option.text.startsWith("choice29:"))).toBe(true);
  });

  it("retains Unicode validation and rejects fabricated whole-item menu selections", () => {
    const item = "alpha: The first operation applies. The second operation also applies.";
    const gathered = [{ sourceId: "source", sourceName: "Test", marker: "S1", text: item }];
    const options = buildQuoteOptions(evidenceContext("", [], gathered), gathered, { includeShortBlocks: true });
    const fullItem = options.find(option => option.text === item)!;
    expect(fullItem).toBeDefined();
    const forged = resolveQuoteEvidence([{ claimIndex: 0, marker: "S2", quoteId: fullItem.quoteId, support: 1 }], options);
    expect(forged[0]!.quote).toBe("");
    const malformed = [{ ...gathered[0]!, text: item + "\uD800" }];
    expect(() => buildQuoteOptions(evidenceContext("", [], malformed), malformed, { includeShortBlocks: true })).toThrow("malformed source Unicode");
  });

  it("offers separate exact sentences instead of requiring an overlong multi-sentence quote", () => {
    const first = "A citation qualifies only when its marker appears in the answer and the selected quotation directly supports the requested research question.";
    const second = "An access toll purchases content and does not guarantee that the source will qualify for a citation reward after the answer is assessed.";
    const text = `${first} ${second}`;
    expect(text.length).toBeGreaterThan(240);
    const options = menu(text);
    expect(options.map((option) => option.text)).toEqual([first, second]);
    const evidence = resolveQuoteEvidence([{ claimIndex: 0, marker: "S1", quoteId: options[0].quoteId, support: 0.8 }], options);
    const ledger = buildEvidenceLedger({ subClaims: ["When does a citation qualify?"],
      gathered: [{ sourceId: "source", sourceName: "Test", marker: "S1", text }],
      answer: "A citation requires support and an inline marker [S1].", declaredMarkers: ["S1"],
      proposedEvidence: evidence, finalAssessment: [{ claim: "When does a citation qualify?", coverage: 0.8, coveredBy: ["S1"] }],
    });
    expect(ledger.droppedEvidence).toBe(0);
    expect(ledger.claimCoverage[0].coverage).toBe(0.8);
  });

  it("does not join gaps or exceed the text/option bounds, including long unbroken Unicode", () => {
    const passages = [{ text: "First independent sentence." }, { text: "Different independent sentence." }, { text: "word ".repeat(110) }, { text: "😀".repeat(300) }];
    const options = menu(passages.map(passage => passage.text).join("\n"));
    expect(options.length).toBeLessThanOrEqual(64);
    for (const option of options) {
      expect(option.text.length).toBeGreaterThanOrEqual(8);
      expect(option.text.length).toBeLessThanOrEqual(240);
      expect(passages.some((passage) => passage.text.includes(option.text))).toBe(true);
      expect(option.text.isWellFormed()).toBe(true);
    }
    expect(options.reduce((sum, option) => sum + option.text.length, 0)).toBeLessThanOrEqual(64 * 240);
  });

  it("withholds an overlong sentence instead of presenting its middle as a standalone mechanism", () => {
    const prefix = "A synthetic introduction with no evidence for the target mechanism, ".repeat(3);
    const mechanism = "the mediator observes the exact action and renders approval from that observation while treating narration as untrusted data";
    const text = prefix + mechanism + ", followed by unrelated background words repeated to make the sentence longer than the public quotation limit.";
    expect(text.length).toBeGreaterThan(240);
    const next = "A separate complete sentence remains available.";
    const options = menu(text + " " + next);
    expect(options.map(option => option.text)).toEqual([next]);
  });

  it("rejects unknown IDs, cross-source selection, raw quotes and malformed entries", () => {
    const options = menu("The original supported sentence.");
    const rejected = resolveQuoteEvidence([
      { claimIndex: 0, marker: "S1", quoteId: "missing" },
      { claimIndex: 0, marker: "S2", quoteId: "q0_0" },
      { claimIndex: 0, marker: "S1", quote: "The original supported sentence." },
      null,
    ], options);
    expect(rejected.every((proposal) => proposal.quote === "")).toBe(true);
    expect(resolveQuoteEvidence(undefined, options)).toEqual([]);
    const valid = resolveQuoteEvidence([{ claimIndex: 0, marker: "S1", quoteId: "q0_0", quote: "injected replacement", support: 0.8 }], options);
    expect(valid[0].quote).toBe("The original supported sentence.");
    expect(valid[0].quoteSpan).toEqual({ start: 0, end: "The original supported sentence.".length });
  });
});
