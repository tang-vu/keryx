import { afterEach, describe, expect, it, vi } from "vitest";
import { buildResearchReceipt } from "../research-receipt";
import { canonicalJson } from "../canonical-json";
import { createHash } from "node:crypto";
import type { Citation, EvidenceRecord, QueryRun } from "../types";
import { compareSavedResearch, MAX_COMPARISON_RECEIPT_BYTES, ReportComparisonError } from "./report-comparison";

const citation: Citation = { marker: "S1", sourceId: "public:original", sourceName: "Original publisher",
  itemId: "api", itemUrl: "https://publisher.example/api", itemTitle: "Versioned API documentation",
  contentVersion: "v1", sourceKind: "public-reference", weight: 1, reward: 0, rationale: "" };
function input(claims = ["How long is the buffer valid?"], fields: Partial<EvidenceRecord> = {}) {
  const run: QueryRun = { id: "saved-comparison-fixture", question: "Read the original", engine: "offline", budget: 0,
    answer: "The buffer is valid until the next call. [S1]", subClaims: claims, decisions: [], citations: [{ ...citation, ...fields }],
    evidence: claims.map((claim, claimIndex) => ({ ...citation, claim, claimIndex,
      quote: "The buffer is valid until the next call.", support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false, ...fields })),
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-25T00:00:00Z", paymentMode: "offline" };
  return buildResearchReceipt(run, []);
}
function signed(value: unknown): string {
  const receipt = structuredClone(value) as ReturnType<typeof input>;
  receipt.integrity.digest = `sha256:${createHash("sha256").update(canonicalJson(receipt.payload)).digest("hex")}`;
  return JSON.stringify(receipt);
}
afterEach(() => vi.unstubAllGlobals());

describe("local saved receipt comparison", () => {
  it("verifies both digests and keeps exact strings while ignoring marker order and retrieval time alone", async () => {
    const before = input(), after = input();
    const provenance = { extraction: "html" as const, truncated: false, publisherGroup: "publisher.example",
      normalizedBodyHash: "a".repeat(64), retrievedAt: "2026-10-24T00:00:00Z" };
    Object.assign(before.payload.claims[0].evidence[0], { webProvenance: provenance });
    Object.assign(after.payload.claims[0].evidence[0], { marker: "S9", webProvenance: { ...provenance, retrievedAt: "2026-10-25T00:00:00Z" } });
    after.payload.citations[0].marker = "S9";
    after.payload.dispatch.answer = after.payload.dispatch.answer.replace("[S1]", "[S9]");
    const first = signed(before), second = signed(after), result = await compareSavedResearch({ before: first, after: second });
    expect(result.availability).toBe("complete");
    expect(result.targets[0]).toMatchObject({ state: "same-recorded-excerpts", match: "exact-target-text", added: [], removed: [] });
    expect(result.targets[0].unchanged[0].before.context.retrievedAt).toBe(provenance.retrievedAt);
    expect(result.targets[0].unchanged[0].after.marker).toBe("S9");
    expect(result.targets[0].unchanged[0].after.context.retrievedAt).toBe("2026-10-25T00:00:00Z");
    expect(JSON.stringify(before)).not.toContain("S9");
    expect(result.notice).toContain("not origin, factual support, settlement or improvement");
  });

  it.each([
    { quote: "The buffer remains valid for two calls." },
    { contentVersion: "v2" },
    { itemUrl: "https://publisher.example/api?v=2" },
    { itemId: "another-api" },
  ])("compares retained rows when exact source content/identity changed: %j", async change => {
    const result = await compareSavedResearch({ before: JSON.stringify(input()), after: JSON.stringify(input(undefined, change)) });
    expect(result.targets[0].state).toBe("recorded-excerpts-changed");
    expect(result.summary).toMatchObject({ comparableTargets: 1, changedTargets: 1, addedRows: 1, removedRows: 1 });
    expect(result.targets[0].removed[0].contentVersion).toBe("v1");
    expect(result.targets[0].added[0]).toMatchObject(change);
  });

  it("detects reading-boundary changes without claiming the quote changed", async () => {
    const provenance = { extraction: "pdf" as const, truncated: true, publisherGroup: "publisher.example", retrievedAt: "2026-10-25T00:00:00Z",
      normalizedBodyHash: "a".repeat(64), pdfTextScope: { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3,
        totalPages: 10, pagesWithoutText: [2], textLimitReached: false } };
    const before = input(undefined, { webProvenance: provenance });
    const after = input(undefined, { webProvenance: { ...provenance, pdfTextScope: { ...provenance.pdfTextScope, pagesRead: 5 } } });
    const result = await compareSavedResearch({ before: JSON.stringify(before), after: JSON.stringify(after) });
    expect(result.targets[0].state).toBe("read-context-changed");
    expect(result.summary).toMatchObject({ addedRows: 0, removedRows: 0, contextChangedRows: 1 });
    expect(result.targets[0].contextChanged[0].before.context.pdfTextScope?.pagesRead).toBe(3);
    expect(result.targets[0].contextChanged[0].after.context.pdfTextScope?.pagesRead).toBe(5);
  });

  it("matches reordered unique target text without treating a changed question or answer as quality", async () => {
    const before = input(["Memory?", "Threading?"]), after = input(["Threading?", "Memory?"]);
    after.payload.dispatch.question = "A follow-up question"; after.payload.dispatch.answer = "A different recorded answer";
    const result = await compareSavedResearch({ before: JSON.stringify(before), after: signed(after) });
    expect(result.questionChanged).toBe(true); expect(result.answerChanged).toBe(true);
    expect(result.targets.map(row => [row.before?.claimIndex, row.after?.claimIndex])).toEqual([[0, 1], [1, 0]]);
    expect(result.summary.changedTargets).toBe(0);
    expect(result.order).toBe("caller-selected");
  });

  it("retains validated PDF page facts while marking conflicting clipping observations", async () => {
    const original = input();
    Object.assign(original.payload.claims[0].evidence[0], { webProvenance: { extraction: "pdf", truncated: false,
      pdfTextScope: { format: "keryx-pdf-text-scope-v1", pagesRead: 3, totalPages: 10, pagesWithoutText: [2], textLimitReached: false } } });
    const result = await compareSavedResearch({ before: signed(original), after: signed(original) });
    expect(result.before.targets[0].excerpts[0].context).toMatchObject({ truncated: false, clippingConflict: true,
      pdfTextScope: { pagesRead: 3, totalPages: 10, pagesWithoutText: [2] } });
  });

  it("observes HTML sections only for partial HTML and ignores malformed cross-format scope", async () => {
    const section = { format: "keryx-html-section-scope-v1", fragment: "methods", headingLevel: 2,
      htmlStart: 5, htmlEnd: 50, documentCharacters: 100, documentSha256: "c".repeat(64) };
    for (const [extraction, truncated, valid] of [["html", true, true], ["html", false, false], ["text", true, false]] as const) {
      const original = input(); Object.assign(original.payload.claims[0].evidence[0], { webProvenance: { extraction, truncated, htmlSectionScope: section,
        pdfTextScope: { pagesRead: "fabricated" } } });
      const result = await compareSavedResearch({ before: signed(original), after: signed(original) });
      const context = result.before.targets[0].excerpts[0].context;
      expect(context.htmlSectionScope).toEqual(valid ? section : undefined); expect(context.pdfTextScope).toBeUndefined();
    }
  });

  it("detects a recorded delivery-scope change with identical retained quote and source identity", async () => {
    const before = input(), after = input();
    Object.assign(before.payload.claims[0].evidence[0], { publicDeliveryKind: "abstract" });
    Object.assign(after.payload.claims[0].evidence[0], { publicDeliveryKind: "full_text" });
    const result = await compareSavedResearch({ before: signed(before), after: signed(after) });
    expect(result.targets[0].state).toBe("read-context-changed");
    expect(result.summary).toMatchObject({ addedRows: 0, removedRows: 0, contextChangedRows: 1 });
  });

  it("does not guess equivalence for duplicate/renamed targets and accepts an explicit one-to-one mapping", async () => {
    const before = JSON.stringify(input(["Memory?", "Memory?"])), after = JSON.stringify(input(["Lifetime?", "Memory?"]));
    const initial = await compareSavedResearch({ before, after });
    expect(initial.targets).toHaveLength(4);
    expect(initial.targets.every(row => row.match === "unmatched")).toBe(true);
    const mapped = await compareSavedResearch({ before, after, matches: [{ beforeClaimIndex: 0, afterClaimIndex: 0 }] });
    expect(mapped.targets[0]).toMatchObject({ match: "user-selected", state: "same-recorded-excerpts" });
    expect(mapped.targets).toHaveLength(3);
    expect((await compareSavedResearch({ before, after, matches: [] })).summary.comparableTargets).toBe(0);
  });

  it.each([
    [{ beforeClaimIndex: 0, afterClaimIndex: 0 }, { beforeClaimIndex: 0, afterClaimIndex: 1 }],
    [{ beforeClaimIndex: 0, afterClaimIndex: 0 }, { beforeClaimIndex: 1, afterClaimIndex: 0 }],
    [{ beforeClaimIndex: 2, afterClaimIndex: 0 }],
    [{ beforeClaimIndex: -1, afterClaimIndex: 0 }],
  ].map(matches => ({ matches })))("refuses ambiguous/nonexistent target mappings: %j", async ({ matches }) => {
    await expect(compareSavedResearch({ before: JSON.stringify(input(["A?", "B?"])), after: JSON.stringify(input(["A?", "B?"])), matches }))
      .rejects.toMatchObject({ code: "invalid-target-matches" });
  });

  it("keeps absent historical ledgers unknown rather than declaring new/lost evidence", async () => {
    const old = input(); Reflect.deleteProperty(old.payload, "claims");
    const result = await compareSavedResearch({ before: signed(old), after: JSON.stringify(input()) });
    expect(result.availability).toBe("unavailable");
    expect(result.before.ledgerAvailable).toBe(false);
    expect(result.targets[0].state).toBe("comparison-unavailable");
    expect(result.summary).toMatchObject({ addedRows: 0, removedRows: 0, unknownTargets: 1 });
  });

  it("keeps incomplete optional evidence unknown while displaying the valid retained rows", async () => {
    const old = input(); old.payload.claims[0].evidence.push({ ...old.payload.claims[0].evidence[0], quote: "x".repeat(241) });
    const result = await compareSavedResearch({ before: signed(old), after: JSON.stringify(input()) });
    expect(result.availability).toBe("partial");
    expect(result.targets[0]).toMatchObject({ state: "comparison-unavailable", added: [], removed: [] });
    expect(result.before.targets[0].excerpts).toHaveLength(1);
    expect(result.before.targets[0].excludedRows).toBe(1);
  });

  it("refuses mismatched citation versions and explicitly rejected evidence", async () => {
    const old = input(), next = input(); next.payload.claims[0].evidence[0].contentVersion = "uncited-version";
    const result = await compareSavedResearch({ before: JSON.stringify(old), after: signed(next) });
    expect(result.targets[0].added).toEqual([]); expect(result.targets[0].removed).toHaveLength(1);
    const rejected = input(undefined, { qualifiesForAnswer: false, qualifiesForReward: true });
    expect((await compareSavedResearch({ before: JSON.stringify(rejected), after: JSON.stringify(rejected) })).targets[0].state)
      .toBe("no-inspectable-excerpts");
  });

  it("labels synthetic rows and preserves duplicate rows as records rather than independent sources", async () => {
    const original = input(undefined, { evidenceProvenance: "synthetic-demo", qualifiesForAnswer: false, qualifiesForReward: false });
    const repeated = structuredClone(original); repeated.payload.claims[0].evidence.push(repeated.payload.claims[0].evidence[0]);
    const result = await compareSavedResearch({ before: JSON.stringify(original), after: signed(repeated) });
    expect(result.summary.addedRows).toBe(1); expect(result.summary.illustrativeRows).toBe(3);
    expect(result.targets[0].added[0].illustrative).toBe(true);
    expect(result.notice).toContain("not independent sources");
  });

  it("checks all original payload fields without exporting unrelated private/financial fields or making requests", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("No outbound I/O"); }));
    const receipt = input(); Object.assign(receipt.payload, { privateToken: "PRIVATE_SECRET", secretWallet: "PRIVATE_SIGNER" });
    const raw = signed(receipt), result = await compareSavedResearch({ before: raw, after: raw });
    expect(result.sameReceipt).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET"); expect(JSON.stringify(result)).not.toContain("PRIVATE_SIGNER");
    expect(fetch).not.toHaveBeenCalled();
    await expect(compareSavedResearch({ before: raw.replace("PRIVATE_SECRET", "ALTERED_SECRET"), after: raw }))
      .rejects.toMatchObject({ code: "invalid-receipt" });
  });

  it.each(["not JSON", "[]", "{}", "\"\\ud800\""])("refuses corrupt or unsupported receipt input: %j", async raw => {
    await expect(compareSavedResearch({ before: raw, after: JSON.stringify(input()) })).rejects.toBeInstanceOf(ReportComparisonError);
  });

  it("bounds input bytes before parsing and refuses ambiguous target indices or deep data", async () => {
    await expect(compareSavedResearch({ before: " ".repeat(MAX_COMPARISON_RECEIPT_BYTES + 1), after: JSON.stringify(input()) }))
      .rejects.toMatchObject({ code: "input-too-large" });
    await expect(compareSavedResearch({ before: "文".repeat(200_000), after: JSON.stringify(input()) }))
      .rejects.toMatchObject({ code: "input-too-large" });
    const repeated = input(["A?", "B?"]); repeated.payload.claims[1].claimIndex = 0;
    await expect(compareSavedResearch({ before: signed(repeated), after: JSON.stringify(input()) }))
      .rejects.toMatchObject({ code: "unsupported-report" });
    const deep = input(); let nested: unknown = null; for (let i = 0; i < 20; i++) nested = { child: nested };
    Object.assign(deep.payload, { nested });
    await expect(compareSavedResearch({ before: signed(deep), after: JSON.stringify(input()) }))
      .rejects.toMatchObject({ code: "invalid-receipt" });
  });

  it("accepts a UTF-8 BOM and retains exact multilingual quotation whitespace", async () => {
    const raw = JSON.stringify(input(["Khoảng thời gian?"], { quote: "  Tiếng Việt / 第二行\n\n" }));
    const result = await compareSavedResearch({ before: "\uFEFF" + raw, after: raw });
    expect(result.sameReceipt).toBe(true);
    expect(result.targets[0].unchanged[0].before.quote).toBe("  Tiếng Việt / 第二行\n\n");
  });
});
