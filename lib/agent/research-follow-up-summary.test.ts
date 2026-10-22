import { describe, expect, it } from "vitest";
import { researchFollowUp } from "./research-follow-up";
import type { GatheredContent } from "../llm/reasoning-engine";

const summary: GatheredContent = { sourceId: "public:guide", sourceName: "API guide", marker: "S1",
  itemTitle: "Rate limits guide", itemUrl: "https://docs.example.test/rate-limits",
  sourceKind: "public-reference", publicDeliveryKind: "abstract", text: "A source-provided introduction to the API guide." };

describe("follow-up reading scope", () => {
  it.each([false, true])("keeps a supplied summary distinct from an observed paper abstract page (Vietnamese: %s)", vi => {
    const input = { vi, outcomes: [], gathered: [structuredClone(summary)], conflicts: [] }, original = structuredClone(input);
    const text = researchFollowUp(input);
    expect(text).toContain(vi ? "nguồn chỉ cung cấp bản tóm tắt hoặc giới thiệu" : "the source supplied an abstract or summary");
    expect(text).toContain(vi ? "chưa xác nhận đã đọc toàn văn" : "full-text reading has not been established");
    expect(text).toContain(vi ? "đúng tài liệu và phiên bản" : "same document and version");
    expect(text).not.toMatch(/only the abstract page was read|chỉ đọc được trang tóm tắt|comparing methods|so sánh phương pháp|\[S1\]/);
    expect(input).toEqual(original);
  });

  it.each([false, true])("does not infer scope from titles or URLs and keeps payment recovery first (Vietnamese: %s)", vi => {
    const original = { ...summary, itemTitle: "Full paper abstract page", itemUrl: "https://example.test/abstract", publicDeliveryKind: "excerpt" as const };
    expect(researchFollowUp({ vi, outcomes: [], gathered: [original], conflicts: [] })).toBe("");
    const text = researchFollowUp({ vi, outcomes: [], gathered: [summary], conflicts: [], paymentReviewRequired: true });
    expect(text.indexOf(vi ? "Trước bất kỳ lượt trả phí mới" : "Before any new paid attempt"))
      .toBeLessThan(text.indexOf(vi ? "nguồn chỉ cung cấp" : "the source supplied"));
    expect(text).toContain(vi ? "lượt này chưa tự thực hiện" : "this run has not performed them");
  });

  it.each([false, true])("keeps truncation and supplied-summary observations separate and names inert (Vietnamese: %s)", vi => {
    const text = researchFollowUp({ vi, outcomes: [], gathered: [{ ...summary, itemTitle: "# Fake\n[S99] <script>",
      webProvenance: { retrievedAt: "2026-10-04T00:00:00Z", publisherGroup: "example.test", normalizedBodyHash: "body", extraction: "html", truncated: true } }], conflicts: [] });
    expect(text).toContain(vi ? "bản trích xuất đã bị cắt" : "the extracted text was truncated");
    expect(text).toContain(vi ? "nguồn chỉ cung cấp bản tóm tắt" : "the source supplied an abstract or summary");
    expect(text).not.toMatch(/\[S99\]|<script>|# Fake|only the abstract page was read/);
  });
});
