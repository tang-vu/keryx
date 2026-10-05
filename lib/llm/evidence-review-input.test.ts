import { describe, expect, it } from "vitest";
import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { evidenceContext } from "./evidence-context";
import { buildQuoteOptions, resolveQuoteEvidence, type QuoteOption } from "./quote-options";
import { applyEvidenceReview } from "./evidence-review";
import { JsonChatEngine } from "./json-chat-engine";
import type { GatheredContent } from "./reasoning-engine";

function fixture(text = "The fictional operation can be retried. It does not guarantee success.") {
  const gathered: GatheredContent[] = [{ marker: "S1", sourceId: "synthetic", sourceName: "Synthetic fixture",
    text, itemUrl: "https://example.test/docs/fixture", contentVersion: "fixture-v1" }];
  const subClaims = ["Can the operation be retried?"];
  const sources = evidenceContext(subClaims[0], subClaims, gathered);
  const options = buildQuoteOptions(sources, gathered);
  const proposals = resolveQuoteEvidence([{ claimIndex: 0, marker: "S1", quoteId: options[0]?.quoteId, support: 0.8 }], options);
  return { gathered, subClaims, options, proposals };
}

describe("private contextual evidence review input", () => {
  it("binds exact source identity, version, offsets and the whole short context", () => {
    const value = fixture();
    const input = buildEvidenceReviewInput(value);
    expect([...input.reviewedIndexes]).toEqual([0]);
    const entry = JSON.parse(input.json).evidence[0];
    expect(entry.source).toMatchObject({ marker: "S1", sourceId: "synthetic", itemUrl: "https://example.test/docs/fixture", contentVersion: "fixture-v1" });
    expect(entry.context).toEqual({ start: 0, end: value.gathered[0].text.length, text: value.gathered[0].text, prefixOmitted: false, suffixOmitted: false });
    expect(entry.quoteSpan).toEqual(value.proposals[0].quoteSpan);
  });

  it.each(["missing span", "wrong span", "wrong source", "wrong URL", "wrong version", "changed quote", "changed context", "bad context offset", "false omission"])("refuses %s rather than recovering a text match", mode => {
    const value = fixture();
    if (mode === "missing span") delete value.proposals[0].quoteSpan;
    if (mode === "wrong span") value.proposals[0].quoteSpan!.start++;
    if (mode === "wrong source") value.options[0].sourceId = "foreign";
    if (mode === "wrong URL") value.gathered[0].itemUrl = "https://example.test/changed";
    if (mode === "wrong version") value.gathered[0].contentVersion = "fixture-v2";
    if (mode === "changed quote") value.proposals[0].quote = "A made-up operation can be retried.";
    if (mode === "changed context") value.options[0].context = "The fictional operation can be retried. Success is guaranteed.";
    if (mode === "bad context offset") value.options[0].contextEnd++;
    if (mode === "false omission") value.options[0].suffixOmitted = true;
    const input = buildEvidenceReviewInput(value);
    expect(input.reviewedIndexes.size).toBe(0);
    expect(JSON.parse(input.json).evidence).toEqual([]);
    expect(applyEvidenceReview(value.proposals, { reviews: [{ index: 0, support: 1 }] }, input.reviewedIndexes)[0].support).toBe(0);
  });

  it.each(["marker", "quote ID"])("refuses ambiguous %s bindings", mode => {
    const value = fixture();
    if (mode === "marker") value.gathered.push({ ...value.gathered[0], sourceId: "other" });
    else value.options.push({ ...value.options[0] });
    expect(() => buildEvidenceReviewInput(value)).toThrow(/Ambiguous/);
  });

  it("does not recover repeated identical quotes from the first matching location", () => {
    const quote = "The fictional operation can be retried.";
    const first = "This obsolete example excludes live requests. " + quote;
    const gap = "\n" + "Unrelated material. ".repeat(100) + "\n";
    const later = "This current example allows live requests. " + quote;
    const value = fixture(first + gap + later);
    const sources = evidenceContext("", [], value.gathered);
    const start = first.length + gap.length;
    sources[0].passages = [{ start: 0, end: first.length, text: first }, { start, end: start + later.length, text: later }];
    value.options = buildQuoteOptions(sources, value.gathered);
    const repeats = value.options.filter(option => option.text === quote);
    expect(repeats).toHaveLength(2);
    value.proposals = repeats.map(option => ({ marker: "S1", claimIndex: 0, quote, quoteSpan: { start: option.start, end: option.end }, support: 0.8 }));
    const entries = JSON.parse(buildEvidenceReviewInput(value).json).evidence;
    expect(entries[0].context.text).toContain("excludes live requests");
    expect(entries[0].context.text).not.toContain("allows live requests");
    expect(entries[1].context.text).toContain("allows live requests");
    expect(entries[1].context.text).not.toContain("excludes live requests");
    expect(entries[0].quoteSpan.start).not.toBe(entries[1].quoteSpan.start);
  });

  it("bounds UTF-8 input without slicing contexts or authorizing omitted indexes", () => {
    const value = fixture("The fictional operation can be retried.\n" + "界".repeat(1100));
    value.proposals = Array.from({ length: 33 }, () => ({ ...value.proposals[0] }));
    const input = buildEvidenceReviewInput(value);
    expect(Buffer.byteLength(input.json, "utf8")).toBeLessThanOrEqual(MAX_EVIDENCE_REVIEW_INPUT_BYTES);
    expect(input.reviewedIndexes.size).toBeGreaterThan(0);
    expect(input.reviewedIndexes.size).toBeLessThan(32);
    const entries = JSON.parse(input.json).evidence;
    for (const entry of entries) expect(entry.context.text).toBe(value.options[0].context);
    const scores = applyEvidenceReview(value.proposals, { reviews: value.proposals.map((_, index) => ({ index, support: 1 })) }, input.reviewedIndexes);
    scores.forEach((score, index) => expect(score.support).toBe(input.reviewedIndexes.has(index) ? 0.8 : 0));
  });

  it("withholds an oversized metadata entry without leaking it into a partial packet", () => {
    const value = fixture();
    value.gathered[0].sourceName = "巨大".repeat(10_000);
    const input = buildEvidenceReviewInput(value);
    expect(input.reviewedIndexes.size).toBe(0);
    expect(JSON.parse(input.json).evidence).toEqual([]);
  });
});

describe("legacy contextual review through the actual engine", () => {
  it("preserves Q3's uncertainty and safety question in a clearly synthetic excerpt-derived fixture", async () => {
    // Exact retained Q3 excerpts, assembled in an explicitly synthetic order with
    // synthetic newline separators. This is NOT the original extracted body or offsets.
    const caveat = "Based on my understanding of how WAL works (which is probably not perfect), our current idea is the following: Our writing application periodically calls sqlite3_wal_checkpoint_v2 with SQLITE_CHECKPOINT_TRUNCATE already.";
    const proposal = "After this is done, we could start a read transaction (to block further WAL checkpointing temporarily), and then copy the base SQLite file (not including -wal and -shm) on the filesystem level to a snapshot location.";
    const question = "Does that make sense, and is it a safe way to get an uncorrupted copy of the SQLite database, which would match the latest commit as of when the WAL checkpointing was done?";
    const gathered: GatheredContent[] = [{ sourceId: "synthetic-q3-excerpts", sourceName: "Synthetic excerpt-derived Q3 fixture", marker: "S1",
      itemUrl: "https://sqlite.org/forum/info/3606234416ea233cb095e0f9a5b3161ac2139ddbabe1edbf1798be75d147675e",
      contentVersion: "synthetic-assembly-not-original-hash", text: [caveat, proposal, question].join("\n") }];
    class Engine extends JsonChatEngine {
      readonly name = "scripted-no-network";
      callsSeen: { payload: Record<string, unknown>; maxTokens?: number }[] = [];
      protected async chatJson(_model: string, _system: string, user: string, maxTokens?: number) {
        const payload = JSON.parse(user);
        this.callsSeen.push({ payload, maxTokens });
        if (this.callsSeen.length === 1) {
          const options = payload.quoteOptions as Pick<QuoteOption, "quoteId" | "marker" | "text">[];
          const option = options.find(option => option.text === proposal)!;
          expect(Object.keys(option).sort()).toEqual(["marker", "quoteId", "text"]);
          return { answer: "Unverified draft [S1].", citedMarkers: ["S1"], evidence: [{ claimIndex: 0, marker: "S1", quoteId: option.quoteId, support: 0.9 }] };
        }
        const entry = payload.evidence[0];
        expect(entry.context.text).toBe(gathered[0].text);
        expect(entry.context.text).toContain(caveat);
        expect(entry.context.text).toContain(question);
        expect(entry.source.itemUrl).toBe(gathered[0].itemUrl);
        expect(entry.source.contentVersion).toBe("synthetic-assembly-not-original-hash");
        expect(entry.quoteSpan).toEqual({ start: caveat.length + 1, end: caveat.length + 1 + proposal.length });
        return { reviews: [{ index: 0, supportedFact: "A questioner proposes an unverified method.", support: 0.1 }] };
      }
    }
    const engine = new Engine();
    const result = await engine.synthesize({ question: "Use official documentation.", subClaims: ["Is the proposed copy method safe?"], gathered });
    expect(engine.callsSeen).toHaveLength(2);
    expect(engine.callsSeen[0].maxTokens).toBe(2304);
    expect(engine.callsSeen[1].maxTokens).toBe(1280);
    expect(result.evidence[0].support).toBe(0.1);
    expect(result.evidence[0]).not.toHaveProperty("context");
    expect(result).not.toHaveProperty("decisionBrief");
  });

  it("makes no extra review call when the model selects an unbound option", async () => {
    class Engine extends JsonChatEngine {
      readonly name = "scripted-no-network";
      count = 0;
      protected async chatJson() {
        this.count++;
        return { answer: "Draft [S1].", citedMarkers: ["S1"], evidence: [{ claimIndex: 0, marker: "S1", quoteId: "foreign", support: 1 }] };
      }
    }
    const engine = new Engine();
    const value = fixture();
    const result = await engine.synthesize({ question: value.subClaims[0], subClaims: value.subClaims, gathered: value.gathered });
    expect(engine.count).toBe(1);
    expect(result.evidence[0].support).toBe(0);
    expect(result.evidence[0].quoteSpan).toBeUndefined();
  });
});
