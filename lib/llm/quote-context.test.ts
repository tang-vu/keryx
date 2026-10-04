import { describe, expect, it } from "vitest";
import { evidenceContext } from "./evidence-context";
import { buildContextualQuoteOptions, type ContextualQuoteOption } from "./quote-context";
import type { GatheredContent } from "./reasoning-engine";

const gatheredSource = (text: string, marker = "S1"): GatheredContent => ({
  sourceId: `source-${marker}`, sourceName: "Internal fictional fixture", marker, text,
});

function selected(gathered: GatheredContent[], spans?: [number, number][]) {
  const sources = evidenceContext("What does the source state?", [], gathered);
  if (spans) sources[0].passages = spans.map(([start, end]) => ({ start, end, text: gathered[0].text.slice(start, end) }));
  return sources;
}

function exactOptions(options: ContextualQuoteOption[], gathered: GatheredContent[]) {
  for (const option of options) {
    const original = gathered.find(source => source.marker === option.marker)!;
    expect(option.text).toBe(original.text.slice(option.start, option.end));
    expect(option.context).toBe(original.text.slice(option.contextStart, option.contextEnd));
    expect(option.start).toBeGreaterThanOrEqual(option.contextStart);
    expect(option.end).toBeLessThanOrEqual(option.contextEnd);
    expect(option.text.length).toBeGreaterThanOrEqual(8);
    expect(option.text.length).toBeLessThanOrEqual(240);
    expect(option.context.length).toBeLessThanOrEqual(1200);
    expect(option.contextEnd).toBeLessThanOrEqual(200_000);
    expect(option.text.isWellFormed()).toBe(true);
    expect(option.context.isWellFormed()).toBe(true);
    expect(option.prefixOmitted).toBe(option.contextStart > 0);
    expect(option.suffixOmitted).toBe(option.contextEnd < original.text.length);
  }
  expect(new Set(options.map(option => option.quoteId)).size).toBe(options.length);
}

describe("contextual quote provenance", () => {
  it("binds repeated identical quotes to their distinct neighbors without a text lookup", () => {
    const quote = "Delivery is guaranteed under this policy.";
    const firstPrefix = "Fictional version A applies only to archived jobs. ";
    const separator = "\n" + "Unrelated appendix. ".repeat(100) + "\n";
    const first = firstPrefix + quote + " It excludes retries.\n";
    const secondPrefix = "Fictional version B applies only to new jobs. ";
    const secondStart = first.length + separator.length + secondPrefix.length;
    const gathered = [gatheredSource(first + separator + secondPrefix + quote + " Retries are included.\n")];
    const sources = selected(gathered, [[firstPrefix.length, firstPrefix.length + quote.length], [secondStart, secondStart + quote.length]]);
    const options = buildContextualQuoteOptions(sources, gathered);
    expect(options.map(option => option.text)).toEqual([quote, quote]);
    expect(options.map(option => option.start)).toEqual([firstPrefix.length, secondStart]);
    expect(options[0].context).toContain("It excludes retries.");
    expect(options[0].context).not.toContain("Retries are included.");
    expect(options[1].context).toContain("Retries are included.");
    expect(options[1].context).not.toContain("It excludes retries.");
    exactOptions(options, gathered);
  });

  it("retains UTF-16 offsets through leading whitespace, emoji and non-Latin text", () => {
    const prefix = "\u{1F600} Outside passage.\n";
    const passage = " \t\u{1F680} The fictional limit is 12.\n\tDữ liệu không bảo đảm thành công.  ";
    const gathered = [gatheredSource(prefix + passage + "\nAfter passage.")];
    const options = buildContextualQuoteOptions(selected(gathered, [[prefix.length, prefix.length + passage.length]]), gathered);
    expect(options.map(option => option.text)).toEqual(["\u{1F680} The fictional limit is 12.", "Dữ liệu không bảo đảm thành công."]);
    expect(options[0].start).toBe(prefix.length + 2);
    exactOptions(options, gathered);
  });

  it("preserves short blocks and unlocked neighboring caveats beyond a selected generation passage", () => {
    const lead = "Earlier unrelated notes. ".repeat(140) + "\n";
    const block = "Fictional policy B\nThe queue delivers messages.\nIt may deliver a message more than once; handlers must tolerate duplicates.\n";
    const gathered = [gatheredSource(lead + block + "Later unrelated notes. ".repeat(140))];
    const start = lead.length + "Fictional policy B\n".length;
    const end = start + "The queue delivers messages.".length;
    const sources = selected(gathered, [[start, end]]);
    const options = buildContextualQuoteOptions(sources, gathered);
    expect(sources[0].passages[0].text).not.toContain("duplicates");
    expect(options).toHaveLength(1);
    expect(options[0].context).toContain(block);
    expect(options[0].prefixOmitted).toBe(true);
    expect(options[0].suffixOmitted).toBe(true);
    exactOptions(options, gathered);
  });

  it("keeps a complete 1,200-unit block even when the quote is near its edge", () => {
    const prefix = "Before.\n";
    const quote = "The exact internal quotation.";
    const block = quote + "x".repeat(1200 - quote.length - 1) + "\n";
    const gathered = [gatheredSource(prefix + block + "After.")];
    const options = buildContextualQuoteOptions(selected(gathered, [[prefix.length, prefix.length + quote.length]]), gathered);
    expect(options[0].context).toBe(block);
    expect(options[0].contextStart).toBe(prefix.length);
    exactOptions(options, gathered);
  });

  it("adds contiguous neighboring sentences within an overlong newline block", () => {
    const prefix = "Earlier irrelevant sentence. ".repeat(60);
    const quote = "The fictional grant lasts 12 hours.";
    const adjacent = " It does not renew automatically. The owner must approve a renewal.";
    const gathered = [gatheredSource(prefix + quote + adjacent + " Later irrelevant sentence.".repeat(60))];
    const options = buildContextualQuoteOptions(selected(gathered, [[prefix.length, prefix.length + quote.length]]), gathered);
    expect(options[0].context).toContain(quote + adjacent);
    exactOptions(options, gathered);
  });

  it("never combines separated passages into a quote or removes the gap from context", () => {
    const first = "The fictional trial was successful.";
    const gap = "\nIt excluded all retry and expiry cases.\n";
    const last = "The authors request more evaluation.";
    const gathered = [gatheredSource(first + gap + last)];
    const options = buildContextualQuoteOptions(selected(gathered, [[0, first.length], [first.length + gap.length, first.length + gap.length + last.length]]), gathered);
    expect(options.map(option => option.text)).toEqual([first, last]);
    expect(options.every(option => option.context.includes(gap))).toBe(true);
    exactOptions(options, gathered);
  });

  it("distinguishes locally complete gathered text from unread document completeness", () => {
    const source = gatheredSource("An internally supplied abstract excerpt only.");
    source.publicDeliveryKind = "abstract";
    const gathered = [source];
    const options = buildContextualQuoteOptions(selected(gathered), gathered);
    expect(options[0]).toMatchObject({ prefixOmitted: false, suffixOmitted: false, context: source.text });
    expect(options[0]).not.toHaveProperty("complete");
    expect(options[0]).not.toHaveProperty("deliveryKind");
    exactOptions(options, gathered);
  });

  it("uses overlapping exact chunks without splitting surrogate pairs or exceeding the quote cap", () => {
    const gathered = [gatheredSource("a" + "\u{1F600}".repeat(1000))];
    const options = buildContextualQuoteOptions(selected(gathered, [[0, gathered[0].text.length]]), gathered);
    expect(options.length).toBeGreaterThan(1);
    expect(options[1].start).toBeLessThan(options[0].end);
    exactOptions(options, gathered);
  });

  it.each([239, 240, 241])("enforces the 240-unit edge for a %i-unit unbroken sentence", length => {
    const gathered = [gatheredSource("x".repeat(length))];
    const options = buildContextualQuoteOptions(selected(gathered), gathered);
    expect(options[0].text.length).toBe(Math.min(length, 240));
    expect(options.at(-1)?.end).toBe(length);
    expect(options).toHaveLength(length > 240 ? 2 : 1);
    exactOptions(options, gathered);
  });

  it("trims a passage boundary inside a surrogate pair inward without moving it elsewhere", () => {
    const text = "\u{1F600} A complete fictional statement. \u{1F680}";
    const gathered = [gatheredSource(text)];
    const options = buildContextualQuoteOptions(selected(gathered, [[1, text.length - 1]]), gathered);
    expect(options.map(option => option.text)).toEqual(["A complete fictional statement."]);
    expect(options[0].start).toBe(3);
    exactOptions(options, gathered);
  });

  it("retains the 200k scan bound, end-of-prefix truncation and surrogate safety", () => {
    const prefix = "x".repeat(199_950) + "\n";
    const tail = "The observed statement is bounded.";
    const beforePair = prefix + tail + " ".repeat(199_999 - prefix.length - tail.length);
    const gathered = [gatheredSource(beforePair + "\u{1F600} Outside the scanned source prefix.")];
    const options = buildContextualQuoteOptions(selected(gathered, [[prefix.length, 200_000]]), gathered);
    expect(options[0].text).toBe(tail);
    expect(options[0].contextEnd).toBeLessThanOrEqual(199_999);
    expect(options[0].suffixOmitted).toBe(true);
    expect(options[0].context).not.toContain("Outside the scanned");
    exactOptions(options, gathered);
  });

  it("offers at most 64 quotes per source with unique local IDs and ignores short fragments", () => {
    const text = Array.from({ length: 70 }, (_, index) => `Statement ${index} is fictional.`).join(" ");
    const gathered = [gatheredSource(text), gatheredSource(text, "S2"), gatheredSource("Short.", "S3")];
    const options = buildContextualQuoteOptions(selected(gathered), gathered);
    expect(options.filter(option => option.marker === "S1")).toHaveLength(64);
    expect(options.filter(option => option.marker === "S2")).toHaveLength(64);
    expect(options.filter(option => option.marker === "S3")).toHaveLength(0);
    exactOptions(options, gathered);
  });

  it("deduplicates an identical span without collapsing identical text at different offsets", () => {
    const quote = "The exact repeated sentence.";
    const gathered = [gatheredSource(quote + "\n" + quote)];
    const spans: [number, number][] = [[0, quote.length], [0, quote.length], [quote.length + 1, quote.length * 2 + 1]];
    const options = buildContextualQuoteOptions(selected(gathered, spans), gathered);
    expect(options).toHaveLength(2);
    expect(options.map(option => option.start)).toEqual([0, quote.length + 1]);
    exactOptions(options, gathered);
  });

  it.each([
    ["negative", -1, 20], ["reversed", 20, 1], ["fractional", 0.5, 20],
    ["nonfinite", 0, Infinity], ["out of source", 0, 1000],
  ])("refuses %s passage ranges", (_label, start, end) => {
    const gathered = [gatheredSource("The original fictional statement.")];
    const sources = selected(gathered);
    sources[0].passages[0] = { start: start as number, end: end as number, text: "invalid" };
    expect(() => buildContextualQuoteOptions(sources, gathered)).toThrow("passage range mismatch");
  });

  it("refuses an otherwise exact passage beyond the source scan cap", () => {
    const gathered = [gatheredSource("x".repeat(200_000) + "Outside the scan boundary.")];
    expect(() => buildContextualQuoteOptions(selected(gathered, [[200_000, gathered[0].text.length]]), gathered)).toThrow("passage range mismatch");
  });

  it("refuses a quoted string at the wrong offset even if the string occurs elsewhere", () => {
    const gathered = [gatheredSource("An unrelated opening. The exact source quotation.")];
    const sources = selected(gathered);
    sources[0].passages = [{ start: 0, end: "The exact source quotation.".length, text: "The exact source quotation." }];
    expect(() => buildContextualQuoteOptions(sources, gathered)).toThrow("passage text mismatch");
  });

  it("rejects invalid binding after 64 valid quotes instead of silently stopping validation", () => {
    const text = "A fictional original sentence. ".repeat(80);
    const gathered = [gatheredSource(text)];
    const sources = selected(gathered, [[0, text.length]]);
    sources[0].passages.push({ start: 0, end: 10, text: "fabricated" });
    expect(() => buildContextualQuoteOptions(sources, gathered)).toThrow("passage text mismatch");
  });

  it("refuses duplicate markers, absent sources, source identity or length mismatches", () => {
    const gathered = [gatheredSource("The original fictional statement.")];
    const sources = selected(gathered);
    expect(() => buildContextualQuoteOptions(sources, [...gathered, { ...gathered[0] }])).toThrow("ambiguous gathered marker");
    expect(() => buildContextualQuoteOptions([...sources, { ...sources[0] }], gathered)).toThrow("duplicate context marker");
    expect(() => buildContextualQuoteOptions(sources, [])).toThrow("source binding mismatch");
    expect(() => buildContextualQuoteOptions([{ ...sources[0], sourceId: "wrong-source" }], gathered)).toThrow("source binding mismatch");
    expect(() => buildContextualQuoteOptions([{ ...sources[0], originalCharacters: 0 }], gathered)).toThrow("source length mismatch");
    expect(() => buildContextualQuoteOptions([{ ...sources[0], scannedCharacters: 0 }], gathered)).toThrow("source length mismatch");
  });

  it("returns no options for an empty source and refuses malformed in-scan Unicode", () => {
    const gathered = [gatheredSource("")];
    expect(buildContextualQuoteOptions(selected(gathered), gathered)).toEqual([]);
    const malformed = [gatheredSource("A fictional \uDC00 malformed source.")];
    expect(() => buildContextualQuoteOptions(selected(malformed), malformed)).toThrow("malformed source Unicode");
    const malformedEnd = [gatheredSource("A fictional malformed ending.\uD800")];
    expect(() => buildContextualQuoteOptions(selected(malformedEnd), malformedEnd)).toThrow("malformed source Unicode");
  });
});
