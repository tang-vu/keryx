import { expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { evidenceContext } from "./evidence-context";
import { sourceHtmlLayout, sourceTextBlocks } from "./source-text-blocks";
import { structuralContextSamples } from "./structural-context-sample";
import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import { buildQuoteOptions } from "./quote-options";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import type { GatheredContent } from "./reasoning-engine";

const names = ["knownalpha", "knownbeta", "knowngamma", "knowndelta"];
const lateFact = "The fictional lease expires after twenty minutes unless a fresh approval renews it.";
const nextFact = "The fictional audit preserves the original approval identity through recovery.";
const targets = (untranslated: string) => [...names, untranslated];
const copiedLayout = (source: GatheredContent) => ({ ...source,
  htmlTextLayout: JSON.parse(JSON.stringify(source.htmlTextLayout)) }) as GatheredContent;

async function source(options: { primary?: string; length?: number; late?: string; openingGap?: boolean; extra?: string } = {}) {
  const body = (name: string) => `${name} identifies one fictional control in this source.`.padEnd(options.length ?? 100, "q");
  const html = `<main><h1>Fictional manual</h1>
    ${options.openingGap ? `<p>${"neutral padding ".repeat(450)}</p>` : ""}
    ${options.primary ? `<p>${options.primary}</p>` : ""}<p>${body(names[0])}</p>
    <h2>First group</h2><p>${body(names[1])}</p><p>${body(names[2])}</p>
    <h2>Second group</h2><p>${body(names[3])}</p><p>${"neutral filler ".repeat(450)}</p>
    <h2>Later observations</h2><p>${options.late ?? lateFact}</p><p>${nextFact}</p>${options.extra ?? ""}</main>`;
  return { ...gatheredArticle("public:web:reserve-capacity", await extractHtml(html, "https://example.com/fictional-manual")), marker: "S1" };
}
function select(original: GatheredContent, claims: string[]) {
  const question = claims.join(" ");
  return { before: evidenceContext(question, claims, [copiedLayout(original)])[0],
    after: evidenceContext(question, claims, [original])[0] };
}
function bounds(original: GatheredContent, selected: ReturnType<typeof evidenceContext>[number], count: number) {
  expect(selected.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(MAX_RESEARCH_TARGETS + 1);
  expect(selected.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(original.text.length / 400) * (count + 2) + 1);
  expect(selected.candidateSelection!.retained).toBeLessThanOrEqual(1 + (count + 1) * 16);
  for (const p of selected.passages) expect(p.text).toBe(original.text.slice(p.start, p.end));
}

it.each(["未訳の条件は何ですか", "ما هي الشروط", "अज्ञात शर्त क्या है", "Điều kiện chưa dịch là gì"])(
  "replaces wholly covered primary samples with later intact body context for %s", async untranslated => {
    const original = await source(), claims = targets(untranslated), { before, after } = select(original, claims);
    const layout = sourceHtmlLayout(original)!;
    const primary = structuralContextSamples(original.text, sourceTextBlocks(original.text, "html", layout), layout, 600);
    expect(primary).toHaveLength(4);
    expect(primary.every(sample => before.passages.some(p => p.start <= sample.start && p.end >= sample.end))).toBe(true);
    expect(before.passages.some(p => p.text.includes(lateFact))).toBe(false);
    expect(after.passages.some(p => p.text.includes(lateFact))).toBe(true);
    for (const p of before.passages) expect(after.passages.some(q => q.start <= p.start && q.end >= p.end)).toBe(true);
    expect(after.candidateSelection!.nominated - before.candidateSelection!.nominated).toBeLessThanOrEqual(4);
    bounds(original, after, claims.length);
    const options = buildQuoteOptions([after], [original]);
    const quote = options.find(option => option.text === lateFact)!;
    expect(quote).toBeDefined();
    expect(original.text.slice(quote.start, quote.end)).toBe(lateFact);
    const ledger = buildEvidenceLedger({ subClaims: claims, gathered: [original], answer: "Unsupported conclusion [S1].",
      declaredMarkers: ["S1"], proposedEvidence: [],
      finalAssessment: claims.map(claim => ({ claim, coverage: 1, coveredBy: ["S1"] })) });
    expect(ledger.acceptedMarkers.size).toBe(0); // Retrieval cannot admit assertions or rewards.
  },
);

it("keeps effective original structural context before using a freed reserve slot", async () => {
  const primary = "The fictional primary safeguard remains necessary after a restart.";
  const original = await source({ primary }), claims = targets("未訳の条件"), { before, after } = select(original, claims);
  expect(before.passages.some(p => p.text.includes(primary))).toBe(false);
  expect(after.passages.some(p => p.text.includes(primary))).toBe(true);
  expect(after.passages.some(p => p.text.includes(lateFact))).toBe(true);
  for (const p of before.passages) expect(after.passages.some(q => q.start <= p.start && q.end >= p.end)).toBe(true);
  bounds(original, after, claims.length);
});

it("does not let a larger reserve block evict an effective primary sample", async () => {
  const primary = "The fictional original qualification remains necessary.".padEnd(200, "p");
  const larger = lateFact.padEnd(500, "z");
  const original = await source({ primary, length: 335, late: larger }), claims = targets("未訳の条件"), { before, after } = select(original, claims);
  expect(before.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeGreaterThan(1300);
  expect(after.passages.some(p => p.text.includes(primary))).toBe(true);
  expect(after.passages.some(p => p.text.includes(larger))).toBe(false);
  bounds(original, after, claims.length);
});

it("does not enlarge the fixed character budget to fit a reserve", async () => {
  const larger = lateFact.padEnd(300, "z");
  const original = await source({ length: 480, late: larger }), claims = targets("未訳の条件"), { before, after } = select(original, claims);
  expect(before.passages.reduce((sum, p) => sum + p.text.length, 0)).toBeGreaterThan(1800);
  expect(after.passages).toEqual(before.passages);
  bounds(original, after, claims.length);
});

it("does not enlarge the existing fixed passage slot budget", async () => {
  const words = Array.from({ length: MAX_RESEARCH_TARGETS }, (_, i) => `retainedtoken${i}`);
  const html = `<main><h1>Manual</h1><p>${"neutral padding ".repeat(150)}</p>` + words.map((word, i) =>
    `<h2>Section ${i}</h2><p>${word} preserves a fictional original control.</p><p>${"neutral padding ".repeat(150)}</p>`).join("") +
    `<h2>Later observation</h2><p>${lateFact}</p></main>`;
  const original = { ...gatheredArticle("public:web:full-slots", await extractHtml(html, "https://example.com/full-slots")), marker: "S1" };
  const claims = words.map((word, i) => i === 0 ? `${word} 未訳の条件` : word), { before, after } = select(original, claims);
  expect(before.passages).toHaveLength(MAX_RESEARCH_TARGETS + 1);
  expect(after.passages).toEqual(before.passages);
  bounds(original, after, claims.length);
});

it("leaves ASCII-only retrieval and unregistered role copies unchanged", async () => {
  const original = await source();
  const ascii = select(original, [...names, "unrepresented property"]);
  expect(ascii.after).toEqual(ascii.before);
  const claims = targets("未訳の条件"), copied = copiedLayout(original);
  expect(evidenceContext(claims.join(" "), claims, [copied])[0].passages.some(p => p.text.includes(lateFact))).toBe(false);
});

it("does not use a reserve from limited roles or isolate preformatted/enumerated qualifications", async () => {
  const limited = await source({ extra: "<h3>Other</h3>".repeat(513) }), claims = targets("未訳の条件");
  expect(limited.htmlTextLayout?.limited).toBe(true);
  expect(select(limited, claims).after.passages).toEqual(select(limited, claims).before.passages);
  const original = await source({ late: "", extra: `<pre>Fictional reserved rule.\n\nIts next line limits the rule.</pre>
    <p>1. A fictional numbered prerequisite applies.</p><p>2. The next item limits the prerequisite.</p>` });
  const selected = select(original, claims).after;
  expect(selected.passages.some(p => p.text.includes("Fictional reserved rule"))).toBe(false);
  expect(selected.passages.some(p => p.text.includes("numbered prerequisite"))).toBe(false);
  bounds(original, selected, claims.length);
});

async function manyBodies() {
  const facts = Array.from({ length: 12 }, (_, i) => `Fictional observation ${i} retains its own original condition.`);
  const html = `<main><h1>Observed manual</h1><p>${"neutral padding ".repeat(450)}</p>` + facts.map((fact, i) =>
    `<h2>Group ${i}</h2><p>${fact}</p>`).join("") + "</main>";
  return { facts, original: { ...gatheredArticle("public:web:bounded-candidates",
    await extractHtml(html, "https://example.com/bounded-candidates")), marker: "S1" } };
}

it("offers at most four uncovered structural bodies even when eight candidates fit", async () => {
  const { original, facts } = await manyBodies(), claims = ["未訳の条件"], selected = select(original, claims).after;
  const delivered = facts.filter(fact => selected.passages.some(p => p.text.includes(fact)));
  expect(delivered).toEqual(facts.slice(0, 4));
  bounds(original, selected, claims.length);
});

it("keeps the original four-candidate default and a fixed eight-offset reserve", async () => {
  const { original } = await manyBodies(), layout = sourceHtmlLayout(original)!;
  const blocks = sourceTextBlocks(original.text, "html", layout);
  const primary = structuralContextSamples(original.text, blocks, layout, 600);
  const candidates = structuralContextSamples(original.text, blocks, layout, 600, undefined, true);
  expect(primary).toHaveLength(4);
  expect(candidates).toHaveLength(8);
  expect(candidates.slice(0, 4)).toEqual(primary);
});

async function denseReserve() {
  const retained = "lexicallate requires an independently approved original before completion.";
  const html = `<main><h1>Observed manual</h1>` + names.map((name, i) =>
    `<h2>Control ${i}</h2><p>${name} preserves its fictional original approval.</p>`).join("") +
    `<p>${"neutral padding ".repeat(450)}</p><h2>Dense context</h2><p>${"A is yes. ".repeat(55)}</p>
    <p>${"B is here. ".repeat(50)}</p><h2>Final original</h2><p>${retained}</p></main>`;
  const original = { ...gatheredArticle("public:web:dense-reserve", await extractHtml(html, "https://example.com/dense-reserve")), marker: "S1" };
  const claims = [...names, "lexicallate", "未訳の条件"];
  return { original, retained, ...select(original, claims) };
}

it.each([
  {}, { includeShortBlocks: true }, { includeAdjacentSentences: true },
  { includeShortBlocks: true, includeAdjacentSentences: true },
])("keeps every original quote-menu span before dense reserve choices with %j", async policy => {
  const { original, retained, before, after } = await denseReserve();
  const oldOptions = buildQuoteOptions([before], [original], policy), newOptions = buildQuoteOptions([after], [original], policy);
  expect(oldOptions.some(option => option.text === retained)).toBe(true);
  expect(after.passages.some(p => p.text.includes("A is yes."))).toBe(true);
  for (const old of oldOptions) expect(newOptions.some(option => option.start === old.start && option.end === old.end && option.text === old.text)).toBe(true);
  expect(newOptions.slice(0, oldOptions.length)).toEqual(oldOptions);
  expect(newOptions.length).toBeLessThanOrEqual(64);
});

it("does not restore a removed original passage from private reserve ordering", async () => {
  const { original, retained, after } = await denseReserve();
  const removed = after.passages.findIndex(p => p.text.includes(retained));
  expect(removed).toBeGreaterThanOrEqual(0);
  after.passages.splice(removed, 1);
  expect(buildQuoteOptions([after], [original]).some(option => option.text === retained)).toBe(false);
});
