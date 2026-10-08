import { describe, expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { evidenceContext } from "./evidence-context";
import { sourceHtmlLayout } from "./source-text-blocks";
import { buildQuoteOptions } from "./quote-options";

const opening = "Background without matching terms. ".repeat(75).slice(0, 2419);
const prerequisite = ("9. Prerequisite: Preserve the qualification before running the operation. " +
  "The earlier condition remains mandatory. ".repeat(6)).slice(0, 269) + "\n\n";
const footer = "Unrelated appendix material. ".repeat(80);

async function select(body: string) {
  const source = { ...gatheredArticle("public:web:mixed-role-fixture", await extractHtml(
    `<main><p>${opening}</p>${body}<p>${footer}</p></main>`, "https://example.com/mixed-roles")), marker: "S1" };
  const context = evidenceContext("target", ["target"], [source]);
  const pre = sourceHtmlLayout(source)!.preformatted[0]!;
  const passages = context[0].passages;
  for (const passage of passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
  expect(passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  return { source, context, pre, passages };
}

describe("enumeration barriers at observed HTML preformatted roles", () => {
  it("retains the preceding preformatted prerequisite when its last short item meets outside prose", async () => {
    const target = "1. target: Runs the operation.\n";
    const result = await select(`<pre>${prerequisite}${target}</pre><p>2. Unrelated ordinary prose.</p>`);
    expect(result.pre).toEqual({ start: 2420, end: 2722 });
    expect(result.passages.some(passage => passage.start <= result.pre.start && passage.end >= result.pre.end &&
      passage.text.includes(prerequisite + target))).toBe(true);
    const quote = buildQuoteOptions(result.context, [result.source]).find(option => option.text.includes("target: Runs"))!;
    expect(quote).toBeDefined();
    expect(quote.context).toContain(prerequisite);
  });

  it("does not group an ordinary item backward into the preceding observed pre region", async () => {
    const result = await select(`<pre>${prerequisite}1. Preformatted detail.\n</pre><p>2. target: Ordinary fact.</p>`);
    const targetPassages = result.passages.filter(passage => passage.text.includes("2. target: Ordinary fact."));
    expect(targetPassages).toHaveLength(1);
    expect(targetPassages[0]!.start).toBeGreaterThanOrEqual(result.pre.end);
    expect(targetPassages[0]!.text).not.toContain("1. Preformatted detail.");
  });

  it("does not group an ordinary item forward into the following observed pre region", async () => {
    const result = await select("<p>1. target: Ordinary fact.</p><pre>2. Preformatted detail.\n</pre>");
    const targetPassages = result.passages.filter(passage => passage.text.includes("1. target: Ordinary fact."));
    expect(targetPassages).toHaveLength(1);
    expect(targetPassages[0]!.end).toBeLessThanOrEqual(result.pre.start);
    expect(targetPassages[0]!.text).not.toContain("2. Preformatted detail.");
  });
});
