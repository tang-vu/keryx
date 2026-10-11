import { describe, expect, it } from "vitest";
import { extractHtml } from "../web-research/html-reader";
import { gatheredArticle } from "../web-research/article-reader";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { JsonChatEngine } from "./json-chat-engine";
import type { GatheredContent } from "./reasoning-engine";

// Synthetic structural controls, not NASA facts or semantic supplier judgments.
const padding = "Unrelated background material and acknowledgements. ".repeat(90);
const targets = ["Khái niệm thứ nhất (alpha) là gì?", "Khái niệm thứ hai (beta) là gì?"];
const question = "Giải thích hai khái niệm đã yêu cầu.";
const rules = ["The first option has a bounded scope.", "It does not authorize a state change.",
  "The second option retains the original boundary."];
async function source(heading = "<h2>Alpha and Beta</h2>", suffix = "") {
  return { ...gatheredArticle("public:web:structural-control", await extractHtml(
    `<main><p>Opening context.</p><p>${padding}</p>${heading}${rules.map(rule => `<p>${rule}</p>`).join("")}<p>${padding}</p>${suffix}</main>`,
    "https://example.com/original")), marker: "S1" };
}
const unparenthesized = (claims: string[]) => claims.map(claim => claim.replaceAll("(", "").replaceAll(")", ""));
function selected(original: GatheredContent, claims = targets, caller = question) {
  return evidenceContext(caller, claims, [original])[0];
}
function bounded(original: GatheredContent, context: ReturnType<typeof selected>) {
  expect(context.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(context.passages.length).toBeLessThanOrEqual(9);
  for (const passage of context.passages) expect(passage.text).toBe(original.text.slice(passage.start, passage.end));
}

describe("explicit multilingual target glosses as structural retrieval hints", () => {
  it("keeps a unique observed heading's contiguous rules and qualification as complete source-bound options", async () => {
    const original = await source();
    const context = selected(original);
    bounded(original, context);
    expect(context.passages.some(passage => passage.text.includes(rules.join("\n")))).toBe(true);
    const options = buildQuoteOptions([context], [original]);
    for (const rule of rules) {
      const quote = options.find(option => option.text === rule)!;
      expect(quote).toBeDefined();
      expect(isCompleteEvidenceSpan(original, quote.text, quote)).toBe(true);
      expect(original.text.slice(quote.start, quote.end)).toBe(rule);
      expect(original.text.slice(quote.contextStart, quote.contextEnd)).toBe(quote.context);
    }
  });

  it.each(["<a>Alpha and Beta</a>", '<span class="h2">Alpha and Beta</span>',
    "<h2>Alpha and Beta</h2><h3>Alpha and Beta</h3>"])("does not reserve a section for unobserved or ambiguous headings: %s", async heading => {
    const original = await source(heading);
    expect(selected(original)).toEqual(selected(original, unparenthesized(targets)));
  });

  it("does not enroll restored layout JSON, changed source bytes, or non-HTML evidence", async () => {
    const original = await source();
    for (const altered of [JSON.parse(JSON.stringify(original)) as GatheredContent,
      { ...original, text: original.text + " Changed source." },
      { ...original, webProvenance: { ...original.webProvenance!, extraction: "text" as const } }]) {
      expect(selected(altered)).toEqual(selected(altered, unparenthesized(targets)));
    }
  });

  it("does not infer a unique heading when the real parser reports a limited role map", async () => {
    const original = await source("<h2>Alpha and Beta</h2>", "<h3>Other section</h3>".repeat(513));
    expect(original.htmlTextLayout?.limited).toBe(true);
    expect(selected(original)).toEqual(selected(original, unparenthesized(targets)));
  });

  it.each([
    ["Explain the first option (alpha).", "Explain the second option (beta)."],
    ["Explain the first option’s behavior (alpha).", "Explain the second option’s behavior (beta)."],
    ["Khái niệm thứ nhất (alpha beta) là gì?", "Khái niệm thứ hai là gì?"],
    ["Khái niệm thứ nhất (alpha) và (beta) là gì?", "Khái niệm thứ hai là gì?"],
    ["Theo publisher (alpha), mục thứ nhất là gì?", "Theo publisher (alpha), mục thứ hai là gì?"],
    ["Khái niệm thứ nhất (alphabeta) là gì?", "Khái niệm thứ hai (beta) là gì?"],
    ["Khái niệm thứ nhất (alpha) là gì?", "Khái niệm thứ hai (absent) là gì?"],
  ])("preserves lexical selection when distinct multilingual target glosses do not qualify: %j", async (first, second) => {
    const original = await source();
    const claims = [first, second];
    expect(selected(original, claims)).toEqual(selected(original, unparenthesized(claims)));
  });

  it("keeps the original lexical path when optional distinct gloss hints exceed its bound", async () => {
    const original = await source();
    const claims = [...targets, "Mục tiếp theo (gamma), (delta) và (epsilon) là gì?"];
    expect(selected(original, claims)).toEqual(selected(original, unparenthesized(claims)));
  });

  it("leaves explicit quoted-heading and URL-fragment hints in control", async () => {
    const original = await source("<h2>Alpha and Beta</h2>", "<h2>Requested Section</h2><p>Explicit requested content remains a bounded selection hint.</p>");
    for (const hinted of [original, { ...original, requestedSource: { urls: ["https://example.com/original#requested-section"] } } as GatheredContent]) {
      const caller = hinted === original ? 'Giải thích "Requested Section".' : question;
      expect(selected(hinted, targets, caller)).toEqual(selected(hinted, unparenthesized(targets), caller));
    }
  });

  it("uses identical bounded source neighborhoods for sufficiency, re-evaluation and synthesis", async () => {
    const original = await source();
    const packets: Record<string, unknown>[] = [];
    class CaptureEngine extends JsonChatEngine {
      readonly name = "synthetic-multilingual-context-parity";
      protected async chatJson(_model: string, _system: string, user: string) {
        packets.push(JSON.parse(user)); return {};
      }
    }
    const engine = new CaptureEngine(), input = { question, subClaims: targets, gathered: [original] };
    await engine.sufficiency(input);
    await engine.reevaluate({ ...input, skippedSources: [], remainingBudget: 0 });
    const output = await engine.synthesize(input);
    expect(packets).toHaveLength(3);
    expect(packets[0].gathered).toEqual(packets[1].gathered);
    expect(packets[0].gathered).toEqual(packets[2].sources);
    expect(JSON.stringify(packets[0].gathered)).toContain(rules[1]);
    const options = packets[2].quoteOptions as { text: string }[];
    expect(options.some(option => option.text.includes("a numerical outcome"))).toBe(false);
    expect(output.evidence).toEqual([]); expect(output.citedMarkers).toEqual([]);
    expect(output.answer).toBe(""); // Structural selection adds no factual admission.
  });
});
