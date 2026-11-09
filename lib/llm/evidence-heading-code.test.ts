import { beforeAll, expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { MAX_RESEARCH_TARGETS } from "./research-target-limits";
import type { GatheredContent } from "./reasoning-engine";

const heading = "Orbit and Rotation";
const first = "The satellite rotates at the same rate as it circles the planet, so the same hemisphere faces the planet.";
const second = "The far hemisphere receives sunlight during part of its orbit; calling it always dark is misleading.";
const background = "Background. ".repeat(700);
const claims = ["Explain synchronous motion", "Is the darkness label accurate?"];
const question = (name: string) => `Explain ${name}: synchronous motion and darkness.`;
const body = `<p>Opening context.</p><p>${background}</p><a>${heading}</a>`;
let original: GatheredContent, styled: GatheredContent, duplicate: GatheredContent, multiple: GatheredContent;

async function read(html: string) {
  return { ...gatheredArticle("public:web:heading-fixture", await extractHtml(`<main>${html}</main>`, "https://docs.example.test/reference")), marker: "S1" };
}
beforeAll(async () => {
  original = await read(`${body}<h2>${heading}</h2><p>${first}</p><p>${second}</p><p>${background}</p><p>A unique lexicaltarget has a separate requested observation.</p>`);
  styled = await read(`${body}<span class="h2">${heading}</span><p>${first}</p><p>${second}</p><p>${background}</p>`);
  duplicate = await read(`<p>Opening context.</p>${Array.from({ length: 6 }, (_, i) => `<h2>Limits</h2><p>Observation ${i}: ${i === 5 ? "the late qualification matters" : "early context"}.</p><p>${background}</p>`).join("")}`);
  multiple = await read(`<p>Opening context.</p>${["Alpha", "Beta", "Gamma", "Delta"].map(name => `<h2>${name}</h2><p>${name} has a distinct bounded contextual detail.</p><p>${background}</p>`).join("")}<p>A unique lexicaltarget has the separately requested operational fact.</p>`);
}, 30_000);

function context(request: string, source = original, targets = claims) {
  const before = structuredClone(source), selected = evidenceContext(request, targets, [source]);
  expect(source).toEqual(before);
  const value = selected[0];
  expect(value.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(value.passages.length).toBeLessThanOrEqual(MAX_RESEARCH_TARGETS + 1);
  expect(value.candidateSelection!.nominated).toBeLessThanOrEqual(Math.ceil(source.text.length / 400) * (Math.max(1, targets.length) + 2) + 1);
  for (const passage of value.passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
  return selected;
}

it.each(["`", "``", "```"])("retains substantive observed heading context and exact quote options for %s delimiters", delimiter => {
  const selected = context(question(`${delimiter}${heading}${delimiter}`));
  expect(selected[0].passages.some(passage => passage.text.includes(first) && passage.text.includes(second))).toBe(true);
  expect(selected).toEqual(context(question(`"${heading}"`)));
  const quote = buildQuoteOptions(selected, [original]).find(option => option.text === first)!;
  expect(quote).toBeDefined();
  expect(original.text.slice(quote.start, quote.end)).toBe(first);
});

it("retains the existing double-quoted control on the same extracted document", () => {
  const selected = context(question(`"${heading}"`));
  expect(selected[0].passages.some(passage => passage.text.includes(first) && passage.text.includes(second))).toBe(true);
  const quote = buildQuoteOptions(selected, [original]).find(option => option.text === first)!;
  expect(quote).toBeDefined();
  expect(original.text.slice(quote.start, quote.end)).toBe(first);
});

it("keeps four code-delimited heading hints within the existing budget and leaves lexical room", () => {
  const selected = context("Explain `Alpha`, `Beta`, `Gamma`, `Delta` and lexicaltarget.", multiple, ["lexicaltarget"]);
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"])
    expect(selected[0].passages.some(passage => passage.text.includes(`${name} has a distinct bounded contextual detail.`))).toBe(true);
  expect(selected[0].passages.some(passage => passage.text.includes("separately requested operational fact"))).toBe(true);
});

it("keeps late duplicate headings as ambiguous bounded hints without claiming unique coverage", () => {
  const selected = context("Explain `Limits`.", duplicate, ["Contextual observations"]);
  expect(selected[0].passages.some(passage => passage.text.includes("the late qualification matters"))).toBe(true);
  expect(selected).toEqual(context('Explain "Limits".', duplicate, ["Contextual observations"]));
});

it.each([
  `Explain \`${heading}.`,
  `Explain \`\`${heading}\`.`,
  `Explain \`${heading}\ncontinued\`.`,
  `Explain \`${"Long ".repeat(30)}\`.`,
  `Explain:\n\`\`\`text\n\`${heading}\`\n\`\`\``,
  `Explain:\n~~~text\n\`${heading}\`\n~~~`,
  `Explain:\n\`\`\`text\n\`${heading}\``,
  `Explain:\r\`\`\`text\r\`${heading}\`\r\`\`\``,
  `Explain:\r\n~~~text\r\n\`${heading}\`\r\n~~~`,
  `    \`${heading}\``,
])("does not create a new hint from unmatched, multiline, long or block-code text: %j", request => {
  expect(context(request)).toEqual(context(request.replaceAll("`", "")));
});

it.each(["restored", "text", "pdf", "styled"])("does not invent an observed HTML heading from %s data", kind => {
  const value = kind === "restored" ? JSON.parse(JSON.stringify(original)) as GatheredContent : kind === "styled" ? styled
    : { ...original, webProvenance: { ...original.webProvenance!, extraction: kind as "text" | "pdf" } };
  expect(context(question(`\`${heading}\``), value)).toEqual(context(question(heading), value));
});

it("retains ordinary quote priority in a mixed request without changing either source or targets", () => {
  const selected = context('Explain "Alpha", `Beta`, "Gamma", `Delta` and lexicaltarget.', multiple, ["lexicaltarget"]);
  expect(selected).toEqual(context('Explain "Alpha", "Beta", "Gamma", "Delta" and lexicaltarget.', multiple, ["lexicaltarget"]));
});

it("does not use a code-delimited heading beyond the existing bounded question prefix", () => {
  const prefix = "x".repeat(8192);
  expect(context(prefix + question(`\`${heading}\``))).toEqual(context(prefix + question(heading)));
});

it("makes a complete quote available while retaining original ledger admission and public-source reward limits", () => {
  const request = question(`\`${heading}\``), selected = context(request);
  const quote = buildQuoteOptions(selected, [original]).find(option => option.text === first)!;
  expect(quote).toBeDefined();
  const input = { question: request, subClaims: claims, gathered: [original], answer: "A controlled fixture statement [S1].",
    declaredMarkers: ["S1"], proposedEvidence: [{ claimIndex: 0, marker: "S1", quote: quote.text,
      quoteSpan: { start: quote.start, end: quote.end }, support: 0.8 }],
    finalAssessment: claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) };
  const before = structuredClone(input), ledger = buildEvidenceLedger(input);
  expect(input).toEqual(before);
  expect(ledger.evidence[0]).toMatchObject({ support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false });
  expect(ledger.claimCoverage[0].coverage).toBe(0.8);
  for (const value of [
    { ...input, proposedEvidence: [] },
    { ...input, rewardAuthorizationAvailable: false },
    { ...input, proposedEvidence: [{ ...input.proposedEvidence[0], support: 0.1 }] },
    { ...input, gathered: [{ ...original, evidenceProvenance: "synthetic-demo" as const }] },
  ]) expect(buildEvidenceLedger(value).acceptedMarkers.size).toBe(0);
  const offset = first.indexOf("the same hemisphere"), suffix = first.slice(offset);
  expect(buildEvidenceLedger({ ...input, proposedEvidence: [{ ...input.proposedEvidence[0], quote: suffix,
    quoteSpan: { start: quote.start + offset, end: quote.end } }] }).acceptedMarkers.size).toBe(0);
});
