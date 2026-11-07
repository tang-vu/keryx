import { describe, expect, it } from "vitest";
import { researchFollowUp } from "./research-follow-up";
import type { GatheredContent } from "../llm/reasoning-engine";

const original: GatheredContent = { sourceId: "publisher", assetId: "public:web:original", sourceName: "Original", marker: "S1",
  itemTitle: "Original", itemUrl: "https://publisher.example/original", sourceKind: "public-reference", publicDeliveryKind: "excerpt",
  text: "Actual retained text with its original qualifications.",
  webProvenance: { retrievedAt: "2026-11-07T00:00:00Z", publisherGroup: "publisher.example", normalizedBodyHash: "body", extraction: "html", truncated: false } };
const failed = { name: "Original", assetId: "public:web:original", code: "html-extraction-unavailable" };

describe("follow-up after an accepted public read", () => {
  it.each([false, true])("omits obsolete read recovery without mutating history or source data (Vietnamese: %s)", vi => {
    const input = { vi, outcomes: [failed], gathered: [structuredClone(original)], conflicts: [] };
    const before = structuredClone(input);
    expect(researchFollowUp(input)).toBe("");
    expect(input).toEqual(before);
  });

  it("uses the document asset identity, including legacy public reads with sourceId only", () => {
    expect(researchFollowUp({ vi: false, outcomes: [failed], gathered: [{ ...original, assetId: undefined, sourceId: failed.assetId }], conflicts: [] })).toBe("");
  });

  it.each([
    { name: "another asset from the same source", read: { ...original, assetId: "public:web:other" } },
    { name: "an owned read sharing the identifier", read: { ...original, sourceKind: "owned" as GatheredContent["sourceKind"] } },
    { name: "a read without a recorded public kind", read: { ...original, sourceKind: undefined } },
    { name: "an empty body", read: { ...original, text: " \n\t" } },
  ])("retains failure guidance for $name", ({ read }) => {
    expect(researchFollowUp({ vi: false, outcomes: [failed], gathered: [read], conflicts: [] })).toContain("HTML text extraction failed");
  });

  it("never resolves an unidentified failure by a matching title or URL", () => {
    expect(researchFollowUp({ vi: false, outcomes: [{ ...failed, assetId: undefined }], gathered: [original], conflicts: [] })).toContain("HTML text extraction failed");
  });

  it("does not use a shared publisher identifier when a document asset is recorded", () => {
    expect(researchFollowUp({ vi: false, outcomes: [{ ...failed, assetId: original.sourceId }], gathered: [original], conflicts: [] })).toContain("HTML text extraction failed");
  });

  it("applies the follow-up row limit after resolving recovered attempts", () => {
    const text = researchFollowUp({ vi: false, outcomes: [...Array.from({ length: 12 }, () => ({ ...failed })),
      { ...failed, name: "Still unread", assetId: "public:web:unread", code: "pdf-extraction-unavailable" }], gathered: [original], conflicts: [] });
    expect(text).toContain("Still unread");
    expect(text).toContain("PDF text extraction failed");
    expect(text).not.toMatch(/HTML text extraction failed|additional read failures/);
  });

  it.each([false, true])("retains a different failed original with the same title (Vietnamese: %s)", vi => {
    const text = researchFollowUp({ vi, outcomes: [failed, { ...failed, assetId: "public:web:other", code: "publisher-verification-required" }], gathered: [original], conflicts: [] });
    expect(text).not.toContain(vi ? "Không trích xuất được văn bản trang HTML" : "HTML text extraction failed");
    expect(text).toContain(vi ? "trang xác minh không phải bằng chứng" : "verification page is not evidence");
  });

  it.each([false, true])("keeps current scope limits and payment recovery first (Vietnamese: %s)", vi => {
    const input = { vi, outcomes: [failed], gathered: [{ ...original, publicDeliveryKind: "abstract" as const,
      webProvenance: { ...original.webProvenance!, truncated: true } }], conflicts: [], paymentReviewRequired: true };
    const text = researchFollowUp(input);
    expect(text).not.toContain(vi ? "Không trích xuất được văn bản trang HTML" : "HTML text extraction failed");
    expect(text).toContain(vi ? "bản trích xuất đã bị cắt" : "the extracted text was truncated");
    expect(text).toContain(vi ? "nguồn chỉ cung cấp bản tóm tắt" : "the source supplied an abstract or summary");
    expect(text.indexOf(vi ? "Trước bất kỳ lượt trả phí mới" : "Before any new paid attempt"))
      .toBeLessThan(text.indexOf(vi ? "bản trích xuất đã bị cắt" : "the extracted text was truncated"));
  });

  it("retains the observed PDF page/OCR gap after a readable partial recovery", () => {
    const text = researchFollowUp({ vi: false, outcomes: [{ ...failed, code: "pdf-extraction-unavailable" }], gathered: [{ ...original,
      webProvenance: { ...original.webProvenance!, extraction: "pdf", truncated: true,
        pdfTextScope: { format: "keryx-pdf-text-scope-v1", pagesRead: 2, totalPages: 3, pagesWithoutText: [2], textLimitReached: false } } }], conflicts: [] });
    expect(text).not.toContain("PDF text extraction failed");
    expect(text).toContain("visited 2 of 3 pages");
    expect(text).toContain("visited pages 2");
    expect(text).toContain("did not perform OCR");
  });

  it.each(["input", "generation", "review", "synthesis"] as const)("retains a subsequent %s failure after recovery", synthesisFailure => {
    const text = researchFollowUp({ vi: false, outcomes: [failed], gathered: [original], conflicts: [], synthesisFailure });
    expect(text).not.toContain("HTML text extraction failed");
    expect(text).toContain("Read 1 source(s)");
    expect(text).toContain("does not establish that the documents lack evidence");
  });
});
