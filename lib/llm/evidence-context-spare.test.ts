import { describe, expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent } from "./reasoning-engine";

// Frozen synthetic topics and translations. These are retrieval controls, not
// empirical source claims or a semantic model's usefulness judgments.
const cases = [
  { language: "Vietnamese", question: "Làm sao phục hồi mà không gửi lại giao dịch?",
    targets: ["Nhật ký giữ những gì?", "Phục hồi gửi yêu cầu nào?"],
    facts: ["The journal stores the original request and its deterministic identifier.",
      "Recovery sends only GET requests and never signs another payment authorization."] },
  { language: "Japanese", question: "保存した作業を再購入せずに復元する方法は？",
    targets: ["どの識別子を保持しますか？", "復元時に再送してよい要求は何ですか？"],
    facts: ["The archived task identifier remains bound to the original accepted request.",
      "A recovery lookup retrieves that task without submitting another purchase."] },
  { language: "Chinese", question: "盐碱环境中的根系如何工作？",
    targets: ["哪些根部变化帮助耐盐？", "研究证据有哪些局限？"],
    facts: ["The synthetic plant experiment records altered root growth under salt exposure.",
      "The controlled observations do not establish performance in coastal field conditions."] },
  { language: "Spanish", question: "¿Cómo se conserva una copia coherente y cómo se verifica la restauración?",
    targets: ["¿Qué garantiza la instantánea?", "¿Cómo se comprueba la restauración?"],
    facts: ["The snapshot represents one consistent database state while later writes continue.",
      "Verification opens the restored copy and checks its integrity before promotion."] },
] as const;
const padding = "Unrelated background and acknowledgements. ".repeat(90);
async function source(facts: readonly string[], extra = "", byline = "") {
  const html = `<main><h1>Original manual</h1>${byline}<h2>Index</h2><p>Recorded behavior</p><p>Limitations</p>
    <p>${padding}</p><h2>Recorded behavior</h2>${facts.map(fact => `<p>${fact}</p>`).join("")}
    <h2>Limitations</h2><p>${padding}</p>${extra}</main>`;
  return { ...gatheredArticle("public:web:spare-context", await extractHtml(html, "https://example.com/original")), marker: "S1" };
}
function lexicalOnly(original: GatheredContent) {
  return { ...original, htmlTextLayout: JSON.parse(JSON.stringify(original.htmlTextLayout)) } as GatheredContent;
}
function bounded(original: GatheredContent, selected: ReturnType<typeof evidenceContext>[number], targetCount: number) {
  expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(9);
  expect(selected.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(original.text.length / 400) * (targetCount + 2) + 1);
  expect(selected.candidateSelection!.retained).toBeLessThanOrEqual(1 + (targetCount + 1) * 16);
  for (const passage of selected.passages) expect(passage.text).toBe(original.text.slice(passage.start, passage.end));
}

describe("spare multilingual HTML context", () => {
  it.each(cases)("retains intact body evidence for an untranslated $language request within the existing nomination ceiling", async row => {
    const original = await source(row.facts);
    const before = evidenceContext(row.question, [...row.targets], [lexicalOnly(original)])[0];
    const after = evidenceContext(row.question, [...row.targets], [original])[0];
    for (const fact of row.facts) {
      expect(before.passages.some(passage => passage.text.includes(fact))).toBe(false);
      expect(after.passages.some(passage => passage.text.includes(fact))).toBe(true);
    }
    expect(after.candidateSelection!.nominated - before.candidateSelection!.nominated).toBeLessThanOrEqual(4);
    bounded(original, after, row.targets.length);
    const options = buildQuoteOptions([after], [original]);
    for (const fact of row.facts) {
      const quote = options.find(option => option.text === fact)!;
      expect(quote).toBeDefined();
      expect(isCompleteEvidenceSpan(original, quote.text, quote)).toBe(true);
      expect(original.text.slice(quote.start, quote.end)).toBe(fact);
    }
    // Retrieval is not evidence admission, entailment, a payment or a reward.
    const ledger = buildEvidenceLedger({ subClaims: [...row.targets], gathered: [original],
      answer: "An unsupported numerical outcome [S1].", declaredMarkers: ["S1"], proposedEvidence: [],
      finalAssessment: row.targets.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    expect(ledger.acceptedMarkers.size).toBe(0);
  });

  it("preserves every existing lexical selection including a late independent target", async () => {
    const original = await source(cases[0].facts, "<h2>Later detail</h2><p>The separately requested lexicaltarget retains its original access restriction.</p>");
    const targets = ["lexicaltarget access restriction", "復元時の扱いは何ですか？"];
    const before = evidenceContext("Explain lexicaltarget and 復元時の扱い", targets, [lexicalOnly(original)])[0];
    const after = evidenceContext("Explain lexicaltarget and 復元時の扱い", targets, [original])[0];
    expect(before.passages.some(passage => passage.text.includes("lexicaltarget"))).toBe(true);
    for (const selected of before.passages)
      expect(after.passages.some(passage => passage.start <= selected.start && passage.end >= selected.end)).toBe(true);
    expect(after.candidateSelection!.nominated - before.candidateSelection!.nominated).toBeLessThanOrEqual(4);
    bounded(original, after, targets.length);
  });

  it("prefers intact body context ahead of a short byline and date within the spare nomination allowance", async () => {
    const original = await source(cases[1].facts, "", "<p>Manual Team</p><p>January 2020</p>");
    const selected = evidenceContext(cases[1].question, [...cases[1].targets], [original])[0];
    for (const fact of cases[1].facts) expect(selected.passages.some(passage => passage.text.includes(fact))).toBe(true);
    bounded(original, selected, cases[1].targets.length);
  });

  it("does not enroll copied, changed or non-HTML role metadata", async () => {
    const original = await source(cases[0].facts);
    for (const altered of [lexicalOnly(original), { ...original, text: original.text + " Changed body." },
      { ...original, webProvenance: { ...original.webProvenance!, extraction: "text" as const } }]) {
      const selected = evidenceContext(cases[0].question, [...cases[0].targets], [altered])[0];
      expect(selected.passages.some(passage => passage.text.includes(cases[0].facts[0]))).toBe(false);
    }
  });

  it("leaves ASCII-only retrieval unchanged", async () => {
    const original = await source(cases[0].facts);
    expect(evidenceContext("Explain the unavailable property", ["unavailable property"], [original]))
      .toEqual(evidenceContext("Explain the unavailable property", ["unavailable property"], [lexicalOnly(original)]));
  });

  it("withholds the structural sample when the real parser reports limited roles", async () => {
    const original = await source(cases[1].facts, "<h3>Other section</h3>".repeat(513));
    expect(original.htmlTextLayout?.limited).toBe(true);
    const observed = evidenceContext(cases[1].question, [...cases[1].targets], [original])[0];
    const baseline = evidenceContext(cases[1].question, [...cases[1].targets], [lexicalOnly(original)])[0];
    expect(observed.htmlStructureLimited).toBe(true);
    expect(observed.passages).toEqual(baseline.passages);
    expect(observed.candidateSelection).toEqual(baseline.candidateSelection);
  });

  it("does not sample isolated preformatted or enumerated rules without their context bundle", async () => {
    const html = `<main><h1>Manual</h1><p>${padding}</p><h2>Rules</h2>
      <pre>The first synthetic rule requires a condition.\n\nThe next line limits its scope.</pre>
      <p>1. The first numbered rule applies only in the stated context.</p>
      <p>2. The second numbered rule qualifies the earlier rule.</p><p>${padding}</p></main>`;
    const original = { ...gatheredArticle("public:web:rules", await extractHtml(html, "https://example.com/rules")), marker: "S1" };
    const selected = evidenceContext(cases[1].question, [...cases[1].targets], [original])[0];
    expect(selected.passages.some(passage => passage.text.includes("synthetic rule"))).toBe(false);
    expect(selected.passages.some(passage => passage.text.includes("numbered rule"))).toBe(false);
    bounded(original, selected, cases[1].targets.length);
  });
});
