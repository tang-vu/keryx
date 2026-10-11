import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import rfc from "./fixtures/issue-230-rfc4180.json";
import mdn from "./fixtures/issue-238-mdn-button.json";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { bodyIdentity, publisherGroup } from "../web-research/url-identity";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent } from "./reasoning-engine";

let original: GatheredContent;
beforeAll(async () => {
  original = { ...gatheredArticle("public:web:rfc4180-retained", await extractHtml(rfc.html, rfc.sourceUrl)), marker: "S1" };
  expect(createHash("sha256").update(rfc.html).digest("hex")).toBe(rfc.htmlSha256);
  expect(original.text).toBe(rfc.text);
  expect(original.contentVersion).toBe(rfc.contentVersion);
  expect(bodyIdentity(original.text)).toBe(rfc.normalizedBodyHash);
});

function bounded(source: GatheredContent, context: ReturnType<typeof evidenceContext>[number], targetCount: number) {
  expect(context.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(context.passages.length).toBeLessThanOrEqual(9);
  expect(context.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(source.text.length / 400) * (targetCount + 2) + 1);
  expect(context.candidateSelection!.retained).toBeLessThanOrEqual(1 + (targetCount + 1) * 16);
  for (const passage of context.passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
}

describe("retained original source units within the evidence budget", () => {
  it("keeps RFC rules 5–7, their wrapped conditions/examples and standards status for the actual original targets", () => {
    const context = evidenceContext(rfc.question, rfc.subClaims, [original])[0];
    bounded(original, context, rfc.subClaims.length);
    // The baseline selected rules 6–7 but displaced rule 5 with distant prose.
    expect(context.passages.some(passage => passage.start <= 3988 && passage.end >= 4732 &&
      passage.text.includes(rfc.text.slice(3988, 4732)))).toBe(true);
    const options = buildQuoteOptions([context], [original]);
    for (const [start, end] of [[376, 432], [3995, 4146], [4148, 4254], [4327, 4434], [4520, 4682]]) {
      const option = options.find(option => option.start === start && option.end === end)!;
      expect(option).toBeDefined();
      expect(option.text).toBe(rfc.text.slice(start, end));
      expect(isCompleteEvidenceSpan(original, option.text, option)).toBe(true);
    }
    const escaped = options.find(option => option.start === 4520)!;
    expect(escaped.context).toContain('"aaa","b""bb","ccc"');
    expect(original.text.slice(escaped.contextStart, escaped.contextEnd)).toBe(escaped.context);
  });

  it("rejects a severed RFC conditional and a quote glued across a gap even at proposed support 1", () => {
    const context = evidenceContext(rfc.question, rfc.subClaims, [original]);
    const suffixStart = rfc.text.indexOf("double quotes may not appear inside");
    const suffixEnd = rfc.text.indexOf(".  For example:", suffixStart) + 1;
    const ledger = buildEvidenceLedger({ question: rfc.question, subClaims: rfc.subClaims, gathered: [original],
      answer: "A proposed restriction [S1].", declaredMarkers: ["S1"],
      proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: rfc.text.slice(suffixStart, suffixEnd),
        quoteSpan: { start: suffixStart, end: suffixEnd }, support: 1 }],
      finalAssessment: [{ claim: rfc.subClaims[0], coverage: 1, coveredBy: ["S1"] }] });
    expect(ledger.droppedEvidence).toBe(1);
    expect(ledger.acceptedMarkers.size).toBe(0);
    const glued = rfc.text.slice(4148, 4254) + rfc.text.slice(4520, 4682);
    expect(isCompleteEvidenceSpan(original, glued, { start: 4148, end: 4682 })).toBe(false);
    expect(() => buildQuoteOptions([{ ...context[0], passages: [{ start: 4148, end: 4682, text: glued }] }], [original]))
      .toThrow(/passage text mismatch/);
  });

  it("cannot restore preformatted structural preference through copied layout metadata", () => {
    const copied = JSON.parse(JSON.stringify(original)) as GatheredContent;
    const context = evidenceContext(rfc.question, rfc.subClaims, [copied])[0];
    bounded(copied, context, rfc.subClaims.length);
    expect(context.passages.some(passage => passage.start <= 3988 && passage.end >= 4732)).toBe(false);
  });

  it("reserves room for a separately requested late fact after extending the RFC structural bundle", async () => {
    // Explicitly synthetic mutation, separate from the exact historical body above.
    const fact = "ZetaSpecific retains the independently requested late observation.";
    const mutated = { ...gatheredArticle("public:web:synthetic-extension", await extractHtml(
      `${rfc.html}<p>${fact}</p>`, rfc.sourceUrl)), marker: "S1" };
    expect(mutated.text).toContain(fact);
    const targets = [...rfc.subClaims, "ZetaSpecific observation"];
    const context = evidenceContext(rfc.question, targets, [mutated])[0];
    bounded(mutated, context, targets.length);
    expect(context.passages.some(passage => passage.text.includes(fact))).toBe(true);
    expect(context.passages.some(passage => passage.text.includes(rfc.text.slice(3988, 4732)))).toBe(true);
  });

  it("does not spend lexical target slots extending only generic opening context", async () => {
    const intro = Array.from({ length: 9 }, (_, index) =>
      (`Research background item${index}. ` + "General context and acknowledgements. ".repeat(10)).slice(0, 290) + "\n\n").join("");
    const facts = Array.from({ length: 8 }, (_, index) => `Dimension${index} has its separate supported observation.`);
    const source = { ...gatheredArticle("public:web:synthetic-opening", await extractHtml(
      `<main><pre>${intro}</pre>${facts.map(fact => `<p>${fact}</p>`).join("")}</main>`, "https://example.com/structural-opening")), marker: "S1" };
    const targets = facts.map((_, index) => `Research Dimension${index}`);
    const context = evidenceContext("Research eight distinct dimensions.", targets, [source])[0];
    bounded(source, context, targets.length);
    for (const fact of facts) expect(context.passages.some(passage => passage.text.includes(fact))).toBe(true);
  });

  it("keeps the genuine MDN type/default/sibling unit; obsolete submit tokens cannot replace its quote options", () => {
    const source: GatheredContent = { sourceId: "mdn-pt-button", sourceName: "MDN", marker: "S1", sourceKind: "public-reference",
      itemUrl: mdn.sourceUrl, text: mdn.text, contentVersion: mdn.contentVersion,
      webProvenance: { retrievedAt: mdn.capturedAt, publisherGroup: publisherGroup(mdn.sourceUrl),
        normalizedBodyHash: mdn.normalizedBodyHash, extraction: "html", truncated: false } };
    const context = evidenceContext(mdn.question, mdn.subClaims, [source]);
    bounded(source, context[0], mdn.subClaims.length);
    expect(context[0].passages.some(passage => passage.start <= 5238 && passage.end >= 5712)).toBe(true);
    const options = buildQuoteOptions(context, [source]);
    const quotes = [
      "submit: O botão envia os dados do formulário para o servidor.",
      "Esse é o padrão se o atributo não for especifidado, ou se o atributo é dinamicamente mudado para um valor vazio ou inválido.",
      "reset: O botão restaura todos os controles para seus valores iniciais.",
      "button: O botão não possui comportamento padrão.",
    ].map(text => {
      const start = mdn.text.indexOf(text), end = start + text.length;
      const option = options.find(option => option.start === start && option.end === end)!;
      expect(option).toBeDefined();
      expect(option.text).toBe(mdn.text.slice(start, end));
      expect(isCompleteEvidenceSpan(source, option.text, option)).toBe(true);
      return option;
    });
    const ledger = buildEvidenceLedger({ question: mdn.question, subClaims: mdn.subClaims, gathered: [source],
      answer: "Submit/default/reset/button [S1].", declaredMarkers: ["S1"],
      // Scores here are synthetic gate inputs, not independent semantic review.
      proposedEvidence: quotes.map((option, index) => ({ claimIndex: [0, 3, 1, 2][index], marker: "S1", quote: option.text,
        quoteSpan: { start: option.start, end: option.end }, support: 1 })),
      finalAssessment: mdn.subClaims.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    expect(ledger.evidence).toHaveLength(4);
    expect(ledger.evidence.every(record => record.qualifiesForAnswer && !record.qualifiesForReward)).toBe(true);
    const obsolete = { ...context[0], passages: [{ start: 6554, end: 6931, text: mdn.text.slice(6554, 6931) }] };
    expect(obsolete.passages[0].text).toContain('type="submit"');
    const obsoleteOptions = buildQuoteOptions([obsolete], [source]);
    expect(obsoleteOptions.some(option => quotes.some(quote => option.text === quote.text))).toBe(false);
  });
});
