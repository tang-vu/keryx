import { describe, expect, it } from "vitest";
import { completeEvidenceSpans, isCompleteEvidenceSpan } from "./evidence-span";
import { HeuristicEngine } from "./heuristic-engine";
import type { GatheredContent } from "./reasoning-engine";

const source = (text: string): GatheredContent => ({ sourceId: "fixture", sourceName: "Synthetic fixture", marker: "S1", text });

describe("complete source-bound evidence spans", () => {
  it.each(["The operation is not safe.", "Does the proposed operation work?", "The text contains an emoji 😀.", "“The operation is bounded.”", "這是一個完整的測試句子。"])("preserves complete observed text: %s", quote => {
    const original = source(`  ${quote}  `);
    expect(completeEvidenceSpans(original)).toContainEqual({ start: 2, end: 2 + quote.length });
    expect(isCompleteEvidenceSpan(original, quote, { start: 2, end: 2 + quote.length })).toBe(true);
  });

  it("permits a bounded whole-sentence sequence without rewriting the gap", () => {
    const text = "The operation is allowed. It excludes retries.";
    expect(isCompleteEvidenceSpan(source(text), text, { start: 0, end: text.length })).toBe(true);
  });

  it.each([undefined, { start: -1, end: 20 }, { start: 0.5, end: 20 }, { start: 0, end: NaN },
    { start: 1, end: 20 }, { start: 0, end: 999 }])("refuses missing or malformed source binding %j", span => {
    expect(isCompleteEvidenceSpan(source("A complete sentence."), "A complete sentence.", span)).toBe(false);
  });

  it("refuses an internal sentence fragment and the retained Q3 incomplete ending", () => {
    const fragment = 'Basically, if you implement "copy the base SQLite file" via open()/read()/write()/close() the final close() on the original database file will drop all locks held by your process, even though SQLite obtained those locks via a completely';
    // The retained production excerpt ends here. No original continuation is asserted.
    expect(completeEvidenceSpans(source(fragment))).toEqual([]);
    // This continuation is explicitly fictional, used only to prove the cut boundary.
    const fictional = source(fragment + " fictional mechanism in this synthetic example.");
    expect(isCompleteEvidenceSpan(fictional, fragment, { start: 0, end: fragment.length })).toBe(false);
    const whole = source("A longer complete sentence includes this phrase.");
    expect(isCompleteEvidenceSpan(whole, "this phrase.", { start: 35, end: whole.text.length })).toBe(false);
  });

  it("does not normalize changed case, whitespace or compatibility characters", () => {
    const text = "The ﬁle remains intact.";
    for (const quote of [text.toUpperCase(), text.replace("ﬁ", "fi"), text.replace(" ", "  ")]) {
      expect(isCompleteEvidenceSpan(source(text), quote, { start: 0, end: text.length })).toBe(false);
    }
  });

  it("withholds long sentences but keeps a later complete short sentence", () => {
    const long = "Unqualified detail, ".repeat(25) + "with a final caveat.";
    const tail = "This is a complete limitation.";
    const original = source(long + " " + tail);
    expect(completeEvidenceSpans(original)).toEqual([{ start: long.length + 1, end: original.text.length }]);
  });

  it("rejects malformed UTF-16 and offsets splitting a surrogate pair", () => {
    expect(completeEvidenceSpans(source("A broken \ud800 source."))).toEqual([]);
    const original = source("😀 remains part of this sentence.");
    expect(isCompleteEvidenceSpan(original, original.text.slice(1), { start: 1, end: original.text.length })).toBe(false);
  });

  it("does not promote the final sentence at a known extraction cut", () => {
    const text = "The earlier sentence is complete. The last sentence may lack context.";
    const original = { ...source(text), webProvenance: { retrievedAt: "2026-10-05T00:00:00Z", publisherGroup: "example.test",
      normalizedBodyHash: "synthetic", extraction: "html" as const, truncated: true } };
    expect(completeEvidenceSpans(original)).toEqual([{ start: 0, end: "The earlier sentence is complete.".length }]);
  });

  it("does not scan beyond 200k or treat a scan-cut final fragment as complete", () => {
    const first = "The first sentence is available. ";
    const text = first + "X".repeat(200_000 - first.length - 9) + " Edgeend." + " A later sentence cannot be read.";
    expect(completeEvidenceSpans(source(text))).toEqual([{ start: 0, end: first.length - 1 }]);
  });

  it("preserves earlier complete sentences when the scan cap splits a valid surrogate pair", () => {
    const first = "The first sentence remains intact.";
    const prefix = first + " " + "X".repeat(199_999 - first.length - 1);
    const original = source(prefix + "😀 followed by unavailable text.");
    expect(original.text.charCodeAt(199_999)).toBe(0xd83d);
    expect(completeEvidenceSpans(original)).toEqual([{ start: 0, end: first.length }]);
    expect(isCompleteEvidenceSpan(original, first, { start: 0, end: first.length })).toBe(true);
    expect(completeEvidenceSpans(source(prefix + "\ud83dX malformed original."))).toEqual([]);
  });

  it("carries actual offsets through the heuristic engine and never slices a long candidate", async () => {
    const text = "A prior unrelated sentence. A retry operation never sends another payment.";
    const engine = new HeuristicEngine();
    const result = await engine.synthesize({ question: "retry operation payment", subClaims: ["retry operation payment"], gathered: [source(text)] });
    expect(result.evidence).toHaveLength(1);
    expect(isCompleteEvidenceSpan(source(text), result.evidence[0].quote, result.evidence[0].quoteSpan)).toBe(true);
    const long = "retry operation payment ".repeat(20) + "may fail.";
    const refused = await engine.synthesize({ question: "retry operation payment", subClaims: ["retry operation payment"], gathered: [source(long)] });
    expect(refused.evidence).toEqual([]);
  });
});
