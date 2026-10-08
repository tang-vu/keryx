import { describe, expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { observedHtmlTextLayout, validHtmlTextLayout } from "../web-research/html-text-layout";
import { evidenceContext, selectEvidencePassages } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { completeEvidenceSpans, isCompleteEvidenceSpan } from "./evidence-span";
import { sourceHtmlLayout, sourceTextBlocks } from "./source-text-blocks";
import type { GatheredContent } from "./reasoning-engine";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

const padding = "Background material without the requested operational terms. ".repeat(70);
const rule5 = "   5.  A value can be enclosed in delimiters. If a value is not enclosed,\n       then a delimiter must not appear inside that value.\n\n       sample,value\n\n";
const rule6 = "   6.  Values containing commas, line breaks or delimiters must be\n       enclosed in delimiters. For example:\n\n       \"sample,example\"\n\n";
const rule7 = "   7.  If delimiters enclose a value, an embedded delimiter is escaped\n       by placing a second delimiter immediately before it. For example:\n\n       \"sample\"\"example\"\n\n";
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
async function source(html: string): Promise<GatheredContent> {
  return { ...gatheredArticle("public:web:fixture", await extractHtml(html, "https://example.com/original")), marker: "S1" };
}
function bounded(original: GatheredContent, selected: ReturnType<typeof evidenceContext>[number]) {
  expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(9);
  expect(selected.candidateSelection?.nominated ?? 0).toBeLessThanOrEqual(Math.ceil(original.text.length / 400) * 5 + 1);
  for (const passage of selected.passages) expect(passage.text).toBe(original.text.slice(passage.start, passage.end));
}

describe("observed HTML text layout", () => {
  it("records exact visible pre and h1–h6 roles without promoting a TOC, class or hidden title", async () => {
    const original = await source(`<main>\n<a>Orbit and Rotation</a><span class="h2">Styled label</span><h3 hidden>Hidden heading</h3><h3>Orbit <em>and</em> Rotation</h3><p>${padding}</p><pre>  ${escape(rule6)}\n</pre></main>`);
    const layout = sourceHtmlLayout(original)!;
    expect(layout.headings.map(region => original.text.slice(region.start, region.end))).toEqual(["Orbit and Rotation"]);
    expect(layout.preformatted).toHaveLength(1);
    expect(original.text.slice(layout.preformatted[0]!.start, layout.preformatted[0]!.end)).toContain(rule6.trimEnd());
    expect(layout.textSha256).toBe(original.contentVersion);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.preformatted[0])).toBe(true);
  });

  it.each(["\n", "\r", "\r\n"])("retains complete wrapped rules and original review context for %j", async lineBreak => {
    // HTML standard parsing normalizes CR and CRLF to LF. Quote offsets bind to
    // that actual extracted text, never to the downloaded HTML byte offsets.
    const rules = `${rule5}${rule6}${rule7}`.replaceAll("\n", lineBreak);
    const original = await source(`<main><p>${padding}</p><pre>${escape(rules)}</pre><p>${padding}</p></main>`);
    const claims = ["Which values containing commas require enclosing delimiters?", "How is an embedded delimiter escaped?", "What restriction applies if a value is not enclosed?"];
    const selected = evidenceContext("Explain enclosed and unquoted values, comma handling and escaped delimiters.", claims, [original]);
    bounded(original, selected[0]);
    const passages = selected[0].passages.map(passage => passage.text).join("\n");
    expect(passages).toContain(rule5.trimEnd());
    expect(passages).toContain(rule6.trimEnd());
    expect(passages).toContain(rule7.trimEnd());
    const options = buildQuoteOptions(selected, [original]);
    const embedded = options.find(option => option.text.includes("an embedded delimiter is escaped"))!;
    expect(embedded.text).toContain("If delimiters enclose a value");
    expect(embedded.text).toContain("\n");
    expect(original.text.slice(embedded.start, embedded.end)).toBe(embedded.text);
    expect(isCompleteEvidenceSpan(original, embedded.text, embedded)).toBe(true);
    expect(embedded.context).toContain('"sample""example"');
    expect(original.text.slice(embedded.contextStart, embedded.contextEnd)).toBe(embedded.context);
    const suffix = embedded.text.slice(embedded.text.indexOf("an embedded"));
    expect(isCompleteEvidenceSpan(original, suffix, { start: embedded.start + embedded.text.indexOf("an embedded"), end: embedded.end })).toBe(false);
    const ledger = buildEvidenceLedger({ subClaims: [claims[1]!], gathered: [original],
      answer: "An embedded delimiter is escaped [S1].", declaredMarkers: ["S1"],
      proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: suffix,
        quoteSpan: { start: embedded.start + embedded.text.indexOf("an embedded"), end: embedded.end }, support: 1 }],
      finalAssessment: [{ claim: claims[1]!, coverage: 1, coveredBy: ["S1"] }] });
    expect(ledger.acceptedMarkers.size).toBe(0);
    expect(ledger.droppedEvidence).toBe(1);
    const blocks = sourceTextBlocks(original.text, "html", sourceHtmlLayout(original));
    expect(blocks.some(block => original.text.slice(block.start, block.end).includes(rule6.trimEnd()))).toBe(true);
  });

  it("selects substantive English heading contents for a Spanish request, with lexical room remaining", async () => {
    const facts = "The satellite rotates at the same rate as it circles the planet, so the same hemisphere faces the planet.\nThe far hemisphere receives sunlight during part of its orbit; calling it always dark is misleading.\n";
    const original = await source(`<main><h1>Satellite facts</h1><a>Orbit and Rotation</a><p>${padding}</p><h3>Orbit and Rotation</h3>${facts.trimEnd().split("\n").map(fact => `<p>${fact}</p>`).join("")}<p>${padding}</p><p>A distinct lexicaltarget retains important requested details.</p></main>`);
    const selected = evidenceContext('En español, explique "Orbit and Rotation" y lexicaltarget.', ["¿Gira sobre su eje?", "¿Por qué vemos el mismo hemisferio?", "lexicaltarget"], [original]);
    bounded(original, selected[0]);
    expect(selected[0].passages.some(passage => passage.text.includes(facts.trimEnd()))).toBe(true);
    expect(selected[0].passages.some(passage => passage.text.includes("A distinct lexicaltarget"))).toBe(true);
    expect(buildQuoteOptions(selected, [original]).some(option => option.text.includes("same hemisphere"))).toBe(true);
  });

  it("keeps duplicate actual headings as bounded hints, with no uniqueness or full-coverage claim", async () => {
    const original = await source(`<main><p>${padding}</p><h2>Limits</h2><p>First contextual observation, without proof of complete coverage.</p><p>${padding}</p><h2>Limits</h2><p>Second contextual observation, whose qualification also matters.</p><p>${padding}</p></main>`);
    const selected = evidenceContext('Explain "Limits".', ["Contextual observations"], [original]);
    bounded(original, selected[0]);
    expect(selected[0].passages.some(passage => passage.text.includes("First contextual"))).toBe(true);
    expect(selected[0].passages.some(passage => passage.text.includes("Second contextual"))).toBe(true);
  });

  it("preserves numbered heading identity without broadening fragment hints", async () => {
    const original = await source(`<main><p>${padding}</p><h2>3. Definition</h2><p>Different numbered section.</p><p>${padding}</p><h2>2. Definition</h2><p>The requested numbered section contains this original observation.</p><p>${padding}</p></main>`);
    const selected = evidenceContext('Explique "2. Definition".', ["Explique"], [original]);
    expect(selected[0].passages.some(passage => passage.text.includes("The requested numbered section"))).toBe(true);
    expect(selected[0].passages.some(passage => passage.text.includes("Different numbered section"))).toBe(false);
    bounded(original, selected[0]);
  });

  it("reserves a lexical selection slot when four named hints split at short block boundaries", async () => {
    const headings = ["Alpha", "Beta", "Gamma", "Delta"];
    const original = await source(`<main><p>Opening context.</p>${headings.map(name => `<h2>${name}</h2><p>${"Ordinary context. ".repeat(18)}</p><p>${padding}</p>`).join("")}<p>A unique lexicaltarget has the separately requested operational fact.</p></main>`);
    const selected = evidenceContext('Explain "Alpha", "Beta", "Gamma", "Delta" and lexicaltarget.', ["lexicaltarget"], [original]);
    bounded(original, selected[0]);
    expect(selected[0].passages.some(passage => passage.text.includes("unique lexicaltarget"))).toBe(true);
  });

  it("samples late duplicate headings rather than silently exhausting hints on the first four", async () => {
    const original = await source(`<main><p>Opening.</p>${Array.from({ length: 6 }, (_, index) => `<h2>Limits</h2><p>Observation number ${index}: ${index === 5 ? "the late qualification matters" : "early contextual detail"}.</p><p>${padding}</p>`).join("")}</main>`);
    const selected = evidenceContext('Explique "Limits".', ["Explique"], [original]);
    bounded(original, selected[0]);
    expect(selected[0].passages.some(passage => passage.text.includes("the late qualification matters"))).toBe(true);
  });

  it.each(["&#13;", "&#13;&#10;", "\n", "\r\n"])("retains blank pre separators before a short complete sentence for %s", async separator => {
    const quote = "A complete independent sentence remains available.";
    const original = await source(`<main><pre>${"unpunctuated ".repeat(30)}${separator}${separator}${quote}</pre></main>`);
    const spans = completeEvidenceSpans(original);
    expect(spans.some(span => original.text.slice(span.start, span.end) === quote)).toBe(true);
    const options = buildQuoteOptions(evidenceContext("available sentence", ["available sentence"], [original]), [original]);
    expect(options.some(option => option.text === quote)).toBe(true);
  });

  it("keeps entity-generated CRLF wraps distinct from a blank paragraph separator", async () => {
    const original = await source(`<main><pre>${escape(rule7).replaceAll("\n", "&#13;&#10;")}</pre></main>`);
    const options = buildQuoteOptions(evidenceContext("escaped embedded delimiter", ["escaped embedded delimiter"], [original]), [original]);
    const quote = options.find(option => option.text.includes("an embedded delimiter is escaped"))!;
    expect(quote.text).toContain("If delimiters enclose a value");
    expect(quote.text).toContain("\r\n");
    expect(quote.context).toContain('"sample""example"');
    expect(isCompleteEvidenceSpan(original, quote.text, quote)).toBe(true);
  });

  it("does not activate restored JSON, changed bodies/versions or non-HTML sources", async () => {
    const original = await source(`<main><pre>${rule7}</pre><p>${padding}</p></main>`);
    const clone = JSON.parse(JSON.stringify(original)) as GatheredContent;
    expect(validHtmlTextLayout(clone.text, clone.htmlTextLayout)).toBe(true);
    expect(observedHtmlTextLayout(clone.text, clone.htmlTextLayout)).toBeUndefined();
    expect(sourceHtmlLayout(clone)).toBeUndefined();
    expect(sourceHtmlLayout({ ...original, text: original.text.replace("escaped", "changed") })).toBeUndefined();
    expect(sourceHtmlLayout({ ...original, contentVersion: "different" })).toBeUndefined();
    expect(sourceHtmlLayout({ ...original, sourceKind: undefined })).toBeUndefined();
    expect(sourceHtmlLayout({ ...original, webProvenance: { ...original.webProvenance!, extraction: "text" } })).toBeUndefined();
    expect(completeEvidenceSpans(clone)).toEqual(completeEvidenceSpans({ ...clone, htmlTextLayout: undefined }));
    expect(selectEvidencePassages(clone.text, "escaped delimiter", [], [], "html", clone.htmlTextLayout))
      .toEqual(selectEvidencePassages(clone.text, "escaped delimiter", [], [], "html"));
  });

  it("rejects malformed/overlapping/over-cap ranges and preserves the complete source hash binding", async () => {
    const original = await source(`<main><h2>Limits</h2><pre>${rule7}</pre><p>${padding}</p></main>`);
    const layout = original.htmlTextLayout!;
    for (const invalid of [
      { ...layout, textCharacters: original.text.length - 1 }, { ...layout, textSha256: "f".repeat(64) },
      { ...layout, preformatted: [{ start: -1, end: 3 }] }, { ...layout, headings: [{ start: 0, end: NaN }] },
      { ...layout, headings: [{ start: 0, end: 10 }, { start: 3, end: 12 }] },
      { ...layout, headings: Array.from({ length: 513 }, () => ({ start: 0, end: 1 })) },
      { ...layout, preformatted: [{ start: 0, end: original.text.length + 1 }] },
    ]) expect(validHtmlTextLayout(original.text, invalid)).toBe(false);
  });

  it("withholds cut headings and unfinished wrapped quotes at the Unicode extraction edge", async () => {
    const original = await source(`<main><pre>${"x".repeat(59999)}🌍 unfinished sentence.</pre><h2>Unseen heading</h2></main>`);
    expect(original.text).toHaveLength(59999);
    expect(original.text.isWellFormed()).toBe(true);
    expect(original.webProvenance?.truncated).toBe(true);
    expect(original.htmlTextLayout?.headings).toEqual([]);
    expect(completeEvidenceSpans(original)).toEqual([]);
    expect(validHtmlTextLayout(original.text, original.htmlTextLayout)).toBe(true);
  });
});
