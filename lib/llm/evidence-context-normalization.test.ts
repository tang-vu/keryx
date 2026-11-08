import { describe, expect, it } from "vitest";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { JsonChatEngine } from "./json-chat-engine";
import type { GatheredContent } from "./reasoning-engine";

const spellings = ["résumé", "khí hậu", "über", "άδεια"];
const forms = ["NFC", "NFD"] as const;
function fixture(term: string) {
  const line = "Unrelated background material remains unchanged.\n";
  let prefix = "😀 Opening context.\n" + line.repeat(100);
  // Put a short paragraph strictly between fixed bucket starts. A compact
  // lexical anchor must nominate it; generic line samples cannot stand in for it.
  while (prefix.length % 400 < 100 || prefix.length % 400 > 250) prefix += line;
  const rule = `The ${term} policy requires two reviews before approval.`;
  const text = prefix + rule + "\n" + line.repeat(100);
  const source: GatheredContent = { sourceId: "normalization-control", sourceName: "Synthetic policy", marker: "S1", text };
  return { source, rule, start: prefix.length };
}
function bounded(source: GatheredContent, context: ReturnType<typeof evidenceContext>[number]) {
  expect(context.passages.length).toBeLessThanOrEqual(9);
  expect(context.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(context.candidateSelection?.nominated).toBeLessThanOrEqual(Math.ceil(context.scannedCharacters / 400) * 3 + 1);
  expect(context.candidateSelection?.retained).toBeLessThanOrEqual(33);
  for (const passage of context.passages) expect(passage.text).toBe(source.text.slice(passage.start, passage.end));
}

describe("canonical-equivalent terms in bounded source context", () => {
  for (const term of spellings) for (const sourceForm of forms) for (const queryForm of forms) {
    it(`retains ${term}: source ${sourceForm}, query ${queryForm}`, () => {
      const { source, rule, start } = fixture(term.normalize(sourceForm));
      const before = JSON.stringify(source), target = term.normalize(queryForm);
      const context = evidenceContext(`${target}?`, [target], [source])[0];
      bounded(source, context);
      expect(context.passages.some(passage => passage.text.includes(rule))).toBe(true);
      const quote = buildQuoteOptions([context], [source]).find(option => option.text === rule);
      expect(quote).toBeDefined();
      expect(quote?.start).toBe(start); expect(quote?.end).toBe(start + rule.length);
      expect(isCompleteEvidenceSpan(source, rule, quote)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
    });
  }

  it.each(["किताब", "कि"])("keeps attached marks in a word that NFKC cannot compose: %s", term => {
    const { source, rule } = fixture(term);
    const context = evidenceContext(`${term}?`, [term], [source])[0];
    bounded(source, context);
    expect(context.passages.some(passage => passage.text.includes(rule))).toBe(true);
  });

  it.each(["resume", "sum", "unrelatedword", "\u0301\u0308"])("does not equate different words or standalone marks: %s", target => {
    const { source, rule } = fixture("résumé".normalize("NFD"));
    const context = evidenceContext(`${target}?`, [target], [source])[0];
    bounded(source, context);
    expect(context.passages.some(passage => passage.text.includes(rule))).toBe(false);
  });

  it("keeps the existing NFKC compatibility matching", () => {
    const { source, rule } = fixture("ｒｅｓｕｍｅ");
    const context = evidenceContext("resume?", ["resume"], [source])[0];
    bounded(source, context);
    expect(context.passages.some(passage => passage.text.includes(rule))).toBe(true);
  });

  it("uses the same exact-source context in all three model steps without admitting a claim", async () => {
    const target = "résumé", { source, rule } = fixture(target.normalize("NFD"));
    const before = JSON.stringify(source), packets: Record<string, unknown>[] = [];
    class CaptureEngine extends JsonChatEngine {
      readonly name = "synthetic-normalization-context";
      protected async chatJson(_model: string, _system: string, user: string) {
        packets.push(JSON.parse(user)); return {};
      }
    }
    const engine = new CaptureEngine(), input = { question: `${target}?`, subClaims: [target], gathered: [source] };
    await engine.sufficiency(input);
    await engine.reevaluate({ ...input, skippedSources: [], remainingBudget: 0 });
    const output = await engine.synthesize(input);
    expect(packets).toHaveLength(3);
    expect(packets[0].gathered).toEqual(packets[1].gathered);
    expect(packets[0].gathered).toEqual(packets[2].sources);
    expect(JSON.stringify(packets[0].gathered)).toContain(rule);
    expect((packets[2].quoteOptions as { text: string }[]).some(option => option.text === rule)).toBe(true);
    expect(output.evidence).toEqual([]); expect(output.citedMarkers).toEqual([]);
    expect(output.answer).toBe(""); expect(JSON.stringify(source)).toBe(before);
  });
});
