import { describe, expect, it } from "vitest";
import { publicReadRecoveryLines } from "./read-recovery";
import { researchFollowUp } from "./research-follow-up";
import { emptyEvidenceAnswer } from "./empty-public-evidence";
import { synthesisFailureDetail } from "./synthesis-failure";
import type { GatheredContent } from "../llm/reasoning-engine";

const source: GatheredContent = { sourceId: "original", sourceName: "Original", marker: "S1", text: "Actual read text.",
  itemTitle: "Revision 2", sourceKind: "public-reference", publicDeliveryKind: "excerpt",
  webProvenance: { retrievedAt: "2026-10-04T00:00:00Z", publisherGroup: "example.org", normalizedBodyHash: "body", extraction: "pdf", truncated: true } };

describe("bounded research follow-up", () => {
  it("explains publisher verification as unread content in both languages without starting recovery", () => {
    for (const vi of [false, true]) {
      const text = researchFollowUp({ vi, outcomes: [{ name: "OpenReview paper", code: "publisher-verification-required" }], gathered: [], conflicts: [] });
      expect(text).toContain(vi ? "chưa đọc được tài liệu" : "document was not read");
      expect(text).toContain(vi ? "đúng tài liệu và phiên bản" : "same document and version");
      expect(text).toContain(vi ? "trang xác minh không phải bằng chứng" : "verification page is not evidence");
      expect(text).not.toMatch(/\[S1\]|Sign in|Complete the check|PRIVATE_RESPONSE/);
    }
  });
  it.each(["input", "generation", "review", "synthesis"] as const)("keeps completed reads distinct from a %s failure in both languages", stage => {
    for (const vi of [false, true]) {
      const text = researchFollowUp({ vi, outcomes: [], gathered: [{ ...source, webProvenance: undefined }], conflicts: [],
        synthesisFailure: stage, paymentReviewRequired: true });
      expect(text).toContain(vi ? "Đã đọc 1 nguồn" : "Read 1 source(s)");
      expect(text).toContain(vi ? "không chứng minh rằng tài liệu thiếu bằng chứng" : "does not establish that the documents lack evidence");
      expect(text).toContain(vi ? "đơn gốc" : "original reads and receipts");
      expect(text.indexOf(vi ? "Trước bất kỳ lượt trả phí mới" : "Before any new paid attempt"))
        .toBeLessThan(text.indexOf(vi ? "Đã đọc 1 nguồn" : "Read 1 source(s)"));
      expect(text).not.toMatch(/\[S1\]|No original public document|PDF text extraction failed|Please try again/);
    }
  });

  it("does not expose unknown stage strings or invent retained reads", () => {
    expect(synthesisFailureDetail("PRIVATE_ERROR" as never, 1, false)).toBe("");
    for (const count of [0, -1, NaN, Infinity, 0.5]) expect(synthesisFailureDetail("review", count, false)).toBe("");
    expect(researchFollowUp({ vi: false, outcomes: [], gathered: [{ ...source, webProvenance: undefined }], conflicts: [] })).toBe("");
  });

  it("retains a specific PDF recovery step even when another source supplied usable evidence", () => {
    const text = researchFollowUp({ vi: false, outcomes: [{ name: "Scanned appendix", code: "pdf-extraction-unavailable" }],
      gathered: [source], conflicts: [] });
    expect(text).toContain("Scanned appendix");
    expect(text).toContain("selectable text or only images");
    expect(text).toContain("This run did not perform OCR");
    expect(text).toContain("same document and version");
    expect(text).toContain("Revision 2");
    expect(text).toContain("retain this snapshot");
    expect(text).not.toContain("[S1]");
  });

  it("keeps abstract scope and reported conflict unresolved without publishing a model's chosen winner", () => {
    const text = researchFollowUp({ vi: false, outcomes: [], gathered: [
      { ...source, webProvenance: undefined, publicDeliveryKind: "abstract" }, { ...source, sourceId: "second", marker: "S2" }],
    conflicts: [{ point: "Invented assertion", positions: [{ marker: "S1", stance: "7 days" }, { marker: "S2", stance: "30 days" }],
      trusted: "S2", reason: "Invented guarantee" }] });
    expect(text).toContain("only the abstract page was read");
    expect(text).toContain("ask the document owner which policy or result applies");
    expect(text).toContain("not independently verified");
    for (const untrusted of ["Invented assertion", "Invented guarantee", "30 days", "7 days", "[S2]"]) expect(text).not.toContain(untrusted);
    expect(researchFollowUp({ vi: false, outcomes: [], gathered: [{ ...source, webProvenance: undefined }],
      conflicts: [{ point: "Fake", positions: [{ marker: "S1", stance: "a" }, { marker: "S99", stance: "b" }], trusted: "S99", reason: "r" }] })).toBe("");
  });

  it("does not turn source names or unknown error text into citation controls or instructions", () => {
    const rows = publicReadRecoveryLines([{ name: "# Fake\n[S99] <script>\u0000 _title_", code: "SECRET_TRANSPORT_DETAILS" }], false);
    expect(rows.join("\n")).not.toMatch(/\[S99\]|<script>|SECRET_TRANSPORT_DETAILS|\u0000|# Fake/);
    expect(rows.join("\n")).toContain("Original text was unavailable");
    const many = [...Array.from({ length: 12 }, (_, i) => ({ name: `Source ${i}`, code: "article-byte-limit" })),
      { name: "Source 0", code: "article-byte-limit" }];
    expect(publicReadRecoveryLines(many, false)).toHaveLength(9);
    expect(publicReadRecoveryLines(many, false).at(-1)).toContain("4 additional read failures");
  });

  it("provides Vietnamese next steps without claiming a full read or initiating another purchase", () => {
    const text = researchFollowUp({ vi: true, outcomes: [{ name: "Tài liệu", code: "document-identity-changed" }], gathered: [source], conflicts: [] });
    expect(text).toContain("Cung cấp liên kết cho đúng phiên bản");
    expect(text).toContain("bản trích xuất đã bị cắt");
    expect(text).toContain("lượt này chưa tự thực hiện");
    expect(text).not.toContain("Next steps");
  });

  it("adds concrete extraction advice to an empty result while pending payment recovery still takes precedence", () => {
    const input = { question: "Compare documents", outcomes: [{ name: "Image PDF", code: "pdf-extraction-unavailable" }], skipped: [],
      fundingUnavailable: false, pendingPayments: 0, settledPayments: 0, fetchFailures: 0 };
    expect(emptyEvidenceAnswer(input)).toContain("This run did not perform OCR");
    const pending = emptyEvidenceAnswer({ ...input, pendingPayments: 1 });
    expect(pending).toContain("Keep this job for reconciliation before buying again");
    expect(pending).not.toContain("requesting a new run");
    expect(pending).not.toContain("PDF text extraction");
    const partial = researchFollowUp({ vi: false, outcomes: [{ name: "Source", code: "web-operation-limit" }],
      gathered: [source], conflicts: [], paymentReviewRequired: true });
    expect(partial.indexOf("Before any new paid attempt")).toBeLessThan(partial.indexOf("separate research task"));
    expect(partial).toContain("do not erase recorded charges or reservations");
  });
});
