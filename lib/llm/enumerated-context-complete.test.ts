import { createHash } from "node:crypto";
import fixture from "./fixtures/issue-238-mdn-button.json";
import { describe, expect, it } from "vitest";
import { evidenceContext, selectEvidencePassages } from "./evidence-context";
import { enumeratedContext, enumeratedContextRange, visibleEnumerationKind } from "./enumerated-context";
import { sourceHtmlLayout, sourceTextBlocks } from "./source-text-blocks";
import type { HtmlTextLayout } from "../web-research/html-text-layout";
import { gatheredArticle } from "../web-research/article-reader";
import { extractHtml } from "../web-research/html-reader";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

// Exact MDN pt-BR extracted body and question/targets from owner-operated QA
// ce14fb6d-2681-4605-8bf8-140841964493, captured October 8, 2026. No live read,
// model request or payment is performed. Keep the captured spelling unchanged.
const frozen = { text: fixture.text, question: fixture.question, claims: fixture.subClaims };

function bounded(text: string, selected: ReturnType<typeof selectEvidencePassages>, targets: number) {
  expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(9);
  expect(selected.candidateSelection?.nominated ?? 0).toBeLessThanOrEqual(Math.ceil(Math.min(text.length, 200000) / 400) * (targets + 2) + 1);
  expect(selected.candidateSelection?.retained ?? 0).toBeLessThanOrEqual(1 + (targets + 1) * 16);
  for (const passage of selected.passages) expect(passage.text).toBe(text.slice(passage.start, passage.end));
}

describe("short visible enumeration context", () => {
  it("retains the exact captured submit/default rule with reset/button, rather than counting an old browser example", () => {
    expect(createHash("sha256").update(frozen.text).digest("hex")).toBe("ad32a9abb71824e433fd4599c5f45d3f2a5c345c3ec9e107e8d8ffcbb98b4c8e");
    const selected = selectEvidencePassages(frozen.text, frozen.question, frozen.claims, ["https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button"], "html");
    bounded(frozen.text, selected, frozen.claims.length);
    const rule = frozen.text.slice(5280, 5467);
    expect(rule).toContain("submit: O botão envia os dados do formulário para o servidor.");
    expect(rule).toContain("Esse é o padrão se o atributo não for especifidado");
    const siblings = frozen.text.slice(5280, 5712);
    expect(selected.passages.some(passage => passage.start <= 5280 && passage.end >= 5712 && passage.text.includes(siblings))).toBe(true);
    expect(siblings).toContain("reset: O botão restaura todos os controles");
    expect(siblings).toContain("button: O botão não possui comportamento padrão.");
    const original = { ...gatheredArticle("public:web:frozen-mdn", { text: frozen.text,
      title: "Captured MDN button", finalUrl: "https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button",
      kind: "html", truncated: false }), marker: "S1" };
    const context = evidenceContext(frozen.question, frozen.claims, [original]);
    const options = buildQuoteOptions(context, [original]);
    const submit = options.find(option => option.text.startsWith("submit: O botão envia"))!;
    const defaultRule = options.find(option => option.text.startsWith("Esse é o padrão se o atributo"))!;
    for (const option of [submit, defaultRule]) {
      expect(option).toBeDefined();
      expect(option.text.length).toBeLessThanOrEqual(240);
      expect(isCompleteEvidenceSpan(original, option.text, option)).toBe(true);
      expect(original.text.slice(option.start, option.end)).toBe(option.text);
      expect(option.context).toContain(rule.trim());
    }
    // The complete two-sentence item remains an eligible exact bounded quote;
    // the menu offers the two intact sentences with the full item in context.
    const fullRule = rule.trimEnd();
    expect(fullRule.length).toBeLessThanOrEqual(240);
    expect(isCompleteEvidenceSpan(original, fullRule, { start: 5280, end: 5280 + fullRule.length })).toBe(true);
    expect(options.some(option => option.text === fullRule)).toBe(false);
    expect(buildQuoteOptions(context, [original], { includeShortBlocks: false })).toEqual(options);
    const compactOptions = buildQuoteOptions(context, [original], { includeShortBlocks: true });
    const completeItem = compactOptions.find(option => option.text === fullRule)!;
    expect(completeItem).toBeDefined();
    expect(completeItem.start).toBe(5280);
    expect(completeItem.end).toBe(5466);
    expect(isCompleteEvidenceSpan(original, completeItem.text, completeItem)).toBe(true);
    const statement = "O botão submit envia os dados do formulário ao servidor e é o padrão quando type está ausente, vazio ou inválido.";
    const proposed = resolveQuoteEvidence([0, 3].map(claimIndex => ({ claimIndex, marker: "S1", quoteId: completeItem.quoteId, statement, support: 0.9 })), compactOptions);
    const ledger = buildEvidenceLedger({ question: frozen.question, subClaims: frozen.claims, gathered: [original],
      answer: `- ${statement} [S1].`, declaredMarkers: ["S1"], proposedEvidence: proposed,
      finalAssessment: frozen.claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
    expect(ledger.droppedEvidence).toBe(0);
    expect(ledger.evidence).toHaveLength(2);
    expect(ledger.claimCoverage[0]!.coverage).toBe(0.9);
    expect(ledger.claimCoverage[3]!.coverage).toBe(0.9);
    expect(ledger.evidence.every(item => item.qualifiesForAnswer && !item.qualifiesForReward)).toBe(true);
    // A match on type="submit" inside IE7/IE6 prose alone never satisfies this
    // regression: it requires the exact complete rule, default and siblings.
    const oldExample = frozen.text.slice(6554, 7221);
    expect(oldExample).toContain('type="submit"');
    expect(oldExample).not.toContain(rule.trim());
  });

  it.each([
    ["alpha: The initial rule applies.\nbeta: The next rule has a qualification.\ngamma: The last rule applies.\n", "beta"],
    ["1. The initial rule applies.\n2. The next beta rule has a qualification.\n3. The last rule applies.\n", "beta"],
    ["• The initial rule applies.\n• The next beta rule has a qualification.\n• The last rule applies.\n", "beta"],
  ])("keeps contiguous siblings using visible syntax without interpreting their meaning", (rules, term) => {
    const text = "Opening.\n" + "Unrelated context. ".repeat(150) + "\nAvailable choices:\n" + rules + "\n" + "Appendix. ".repeat(150);
    const selected = selectEvidencePassages(text, term, [term], [], "html");
    bounded(text, selected, 1);
    expect(selected.passages.some(passage => passage.text.includes("Available choices:\n" + rules))).toBe(true);
  });

  it("does not bridge a blank line, unrelated block or differently indented run", () => {
    for (const separator of ["\n", "Unrelated intervening paragraph.\n", "  beta: Different indentation.\n"]) {
      const text = "alpha: A statement.\n" + separator + "gamma: Another statement.\n";
      const contexts = enumeratedContext(text, sourceTextBlocks(text), 600);
      expect(contexts.size).toBe(0);
    }
  });

  it("does not bundle a prefix or suffix of an oversized list or construct unbounded candidates", () => {
    const list = Array.from({ length: 12000 }, (_, index) => `${index + 1}. Item ${index === 8000 ? "latebeacon" : "ordinary"}.\n`).join("");
    const text = "Opening.\n" + list;
    expect(enumeratedContext(text, sourceTextBlocks(text), 600).size).toBe(0);
    const selected = selectEvidencePassages(text, "latebeacon", ["latebeacon"], [], "html");
    bounded(text, selected, 1);
    expect(selected.scannedCharacters).toBeLessThanOrEqual(200000);
    expect(selected.passages.some(passage => passage.text.includes("latebeacon"))).toBe(true);
  });

  it("does not give unrelated short lists priority over the separately requested fact", () => {
    const text = "Opening.\n" + Array.from({ length: 150 }, (_, index) => `a: Ordinary context ${index}.\nb: Ordinary context ${index}.\n\n`).join("") + "The unique lexicalbeacon gives the requested operational fact.\n";
    const selected = selectEvidencePassages(text, "lexicalbeacon operational fact", ["lexicalbeacon operational fact"], [], "html");
    bounded(text, selected, 1);
    expect(selected.passages.some(passage => passage.text.includes("unique lexicalbeacon"))).toBe(true);
  });

  it("does not let caller-forged HTML roles disable or alter visible sibling retrieval", () => {
    const forged: HtmlTextLayout = { format: "keryx-html-text-layout-v1", textCharacters: frozen.text.length,
      textSha256: createHash("sha256").update(frozen.text).digest("hex"), limited: false,
      headings: [], preformatted: [{ start: 0, end: frozen.text.length }] };
    expect(selectEvidencePassages(frozen.text, frozen.question, frozen.claims, [], "html", forged))
      .toEqual(selectEvidencePassages(frozen.text, frozen.question, frozen.claims, [], "html"));
  });

  it("leaves PDF physical-line grouping and observed preformatted paragraphs to their existing policies", () => {
    const rules = "alpha: A short rule.\nbeta: A short qualification.\n";
    const text = "Opening.\n" + "Background. ".repeat(180) + "\n" + rules + "\n" + "Appendix. ".repeat(180);
    const blocks = sourceTextBlocks(text);
    const start = text.indexOf(rules);
    expect(enumeratedContext(text, blocks, 600, [{ start, end: start + rules.length }]).size).toBe(0);
    const selected = selectEvidencePassages(text, "beta qualification", ["beta qualification"], [], "pdf");
    bounded(text, selected, 1);
    // Physical PDF wraps never become independent list blocks or proof that a
    // surrounding sentence/qualification is complete.
    expect(selected.contextOmissions?.some(omission => omission.blockPrefixOmitted || omission.blockSuffixOmitted)).toBe(true);
  });

  it("prefers the full short run and introduction when it contains more than eight neighboring items", () => {
    const rules = Array.from({ length: 12 }, (_, index) => `choice${index}: The synthetic${index} rule applies.\n`).join("");
    const text = "Opening.\n" + "Unrelated context. ".repeat(150) + "\nAvailable choices:\n" + rules + "\n" + "Appendix. ".repeat(150);
    const blocks = sourceTextBlocks(text);
    const start = text.indexOf(rules);
    const index = blocks.findIndex(block => text.slice(block.start, block.end).includes("synthetic6"));
    const complete = enumeratedContext(text, blocks, 600).get(blocks[index]!.start)!;
    expect(complete).toEqual({ start: text.indexOf("Available choices:"), end: start + rules.length });
    expect(enumeratedContextRange(text, blocks, index, 600)!.end - complete.start).toBeLessThan(complete.end - complete.start);
    const selected = selectEvidencePassages(text, "synthetic6", ["synthetic6"]);
    bounded(text, selected, 1);
    expect(selected.passages.some(passage => passage.text.includes("Available choices:\n" + rules))).toBe(true);
  });

  it("cannot take a short introduction from an adjacent observed pre region", async () => {
    const rules = "alpha: The first choice applies.\nbeta: The target choice applies.\n";
    const original = { ...gatheredArticle("public:web:pre-intro-barrier", await extractHtml(
      `<main><p>${"Opening background. ".repeat(150)}</p><pre>Available choices:\n</pre>${
        rules.trimEnd().split("\n").map(rule => `<p>${rule}</p>`).join("")}<p>${"Appendix. ".repeat(150)}</p></main>`,
      "https://example.com/pre-introduction")), marker: "S1" };
    const layout = sourceHtmlLayout(original)!;
    const blocks = sourceTextBlocks(original.text, "html", layout);
    const start = original.text.indexOf(rules);
    const complete = enumeratedContext(original.text, blocks, 600, layout.preformatted).get(start)!;
    expect(complete).toBeDefined();
    expect(complete.start).toBeGreaterThanOrEqual(layout.preformatted[0]!.end);
    expect(original.text.slice(complete.start, complete.end)).toBe(rules);
    const selected = evidenceContext("beta", ["beta"], [original])[0];
    bounded(original.text, selected, 1);
    const passage = selected.passages.find(passage => passage.text.includes(rules))!;
    expect(passage).toBeDefined();
    expect(passage.start).toBeGreaterThanOrEqual(layout.preformatted[0]!.end);
    expect(passage.text).not.toContain("Available choices:");
  });

  it("rejects multiline items and does not promote a multiline colon intro into a short-run context", () => {
    const introduction = "Separate context.\nAvailable choices:\n";
    const rules = "alpha: The first choice applies.\nbeta: The next choice applies.\n";
    const text = introduction + rules;
    const blocks = [{ start: 0, end: introduction.length },
      ...sourceTextBlocks(rules).map(block => ({ start: introduction.length + block.start, end: introduction.length + block.end }))];
    expect(visibleEnumerationKind("alpha: A multiline item.\nWrapped continuation.\n")).toBeUndefined();
    expect(visibleEnumerationKind("alpha: A multiline item.\n\n")).toBeUndefined();
    expect(enumeratedContext(text, blocks, 600).get(introduction.length))
      .toEqual({ start: introduction.length, end: text.length });
    const grouped = [{ start: 0, end: text.length }];
    expect(enumeratedContext(text, grouped, 600).size).toBe(0);
    expect(enumeratedContextRange(text, grouped, 0, 600)).toBeUndefined();
  });
});
