import { describe, expect, it } from "vitest";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

describe("quote selection", () => {
  it("offers separate exact sentences instead of requiring an overlong multi-sentence quote", () => {
    const first = "A citation qualifies only when its marker appears in the answer and the selected quotation directly supports the requested research question.";
    const second = "An access toll purchases content and does not guarantee that the source will qualify for a citation reward after the answer is assessed.";
    const text = `${first} ${second}`;
    expect(text.length).toBeGreaterThan(240);
    const options = buildQuoteOptions([{ marker: "S1", passages: [{ text }] }]);
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
    const options = buildQuoteOptions([{ marker: "S1", passages }]);
    expect(options.length).toBeLessThanOrEqual(64);
    for (const option of options) {
      expect(option.text.length).toBeGreaterThanOrEqual(8);
      expect(option.text.length).toBeLessThanOrEqual(240);
      expect(passages.some((passage) => passage.text.includes(option.text))).toBe(true);
      expect(option.text.isWellFormed()).toBe(true);
    }
    expect(options.reduce((sum, option) => sum + option.text.length, 0)).toBeLessThanOrEqual(passages.reduce((sum, passage) => sum + passage.text.length, 0));
  });

  it("rejects unknown IDs, cross-source selection, raw quotes and malformed entries", () => {
    const options = buildQuoteOptions([{ marker: "S1", passages: [{ text: "The original supported sentence." }] }]);
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
  });
});
