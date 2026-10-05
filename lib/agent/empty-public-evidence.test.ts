import { describe, expect, it } from "vitest";
import { emptyEvidenceAnswer, emptyPublicEvidenceDetail, researchResponseLanguage } from "./empty-public-evidence";
import type { Decision } from "../types";

const skipped: Decision[] = [{ sourceId: "source", sourceName: "Synthetic source", action: "SKIP", expectedValue: 0.1,
  price: 0, confidence: 0.5, rationale: "Below the public attention floor", targets: [0] }];
const empty = { question: "What supports this decision?", outcomes: [], skipped, fundingUnavailable: false,
  pendingPayments: 0, settledPayments: 0, fetchFailures: 0 };

describe("empty evidence details", () => {
  it("recognizes already-supplied originals and directs recovery to the recorded refusal or failure", () => {
    const answer = emptyEvidenceAnswer({ ...empty, question: "Use https://www.sqlite.org/wal.html to decide.",
      outcomes: [{ name: "Requested SQLite original", code: "html-extraction-unavailable" }] });
    expect(answer).toContain("Source URLs were already supplied in the question");
    expect(answer).toContain("html-extraction-unavailable");
    expect(answer).toContain("recorded discovery refusal, SKIP or read failure");
    expect(answer).not.toContain("supply a relevant original source URL");
    const vi = emptyPublicEvidenceDetail([], [], { question: "Use https://docs.example/manual. Answer in Vietnamese." });
    expect(vi).toContain("URL nguồn đã được cung cấp");
  });
  it("keeps unavailable search distinct from evidence absence and extraction failure", () => {
    const unavailable = emptyEvidenceAnswer({ ...empty, discovery: { status: "completed", attemptedQueries: 2, succeededQueries: 0, failedQueries: 2 } });
    expect(unavailable).toContain("2 queries attempted, 0 succeeded, 2 unavailable");
    expect(unavailable).toContain("Below the public attention floor");
    expect(unavailable).toContain("does not establish that no relevant evidence exists");
    const failedRead = emptyEvidenceAnswer({ ...empty, discovery: { status: "completed", attemptedQueries: 2, succeededQueries: 2, failedQueries: 0 },
      outcomes: [{ name: "Original", code: "pdf-extraction-unavailable" }] });
    expect(failedRead).toContain("2 succeeded, 0 unavailable");
    expect(failedRead).toContain("pdf-extraction-unavailable");
    expect(failedRead).not.toContain("Below the public attention floor");
  });

  it("uses Vietnamese and relevant general-source recovery for an ordinary research question", () => {
    const answer = emptyEvidenceAnswer({ ...empty, question: "So sánh SQLite và PostgreSQL cho nhóm năm người. Trả lời bằng tiếng Việt.",
      discovery: { status: "unavailable" } });
    expect(answer).toContain("Chưa có câu trả lời");
    expect(answer).toContain("không khả dụng");
    expect(answer).toContain("URL tài liệu gốc");
    expect(answer).not.toMatch(/DOI|arXiv|No supported answer/);
  });

  it("restricts DOI/arXiv advice to scholarly intent and never recommends paying more for a free limit", () => {
    const answer = emptyPublicEvidenceDetail([{ name: "Original", code: "web-operation-limit" }], skipped,
      { question: "Compare arXiv:2606.02668v1 and arXiv:2607.13716v1" });
    expect(answer).toContain("versioned arXiv target");
    expect(answer).toContain("A larger source budget does not resolve");
    const general = emptyPublicEvidenceDetail([], [], { question: "How do I grow tomatoes?" });
    expect(general).not.toMatch(/DOI|arXiv/);
  });

  it.each([
    ["Answer in Vietnamese.", "vi"],
    ["Tôi cần nghiên cứu cà chua.", "vi"],
    ["Tôi cần nghiên cứu. Answer in English.", "en"],
    ["Nghiên cứu này, trả lời bằng tiếng Anh.", "en"],
    ["Compare a paper by Nguyễn.", "en"],
    ["Compare French and Vietnamese literature.", "en"],
    ["Ne pas répondre en anglais; répondez en français.", "en"],
    ["Answer in English. Then respond in Vietnamese.", "vi"],
  ])("chooses output language for %s", (question, language) => {
    expect(researchResponseLanguage(question)).toBe(language);
  });

  it("retains pending, settled, failed and unknown-funding distinctions in both languages", () => {
    for (const question of [empty.question, "Trả lời bằng tiếng Việt."]) {
      const vi = researchResponseLanguage(question) === "vi";
      const pending = emptyEvidenceAnswer({ ...empty, question, pendingPayments: 1, settledPayments: 1 });
      expect(pending).toContain(vi ? "đang chờ" : "pending");
      expect(pending).toContain(vi ? "vẫn được giữ" : "stay reserved");
      const settled = emptyEvidenceAnswer({ ...empty, question, settledPayments: 1 });
      expect(settled).toContain(vi ? "đã hoàn tất" : "settled");
      const funding = emptyEvidenceAnswer({ ...empty, question, fundingUnavailable: true });
      expect(funding).toContain(vi ? "vẫn chưa rõ" : "remain unknown");
      const failed = emptyEvidenceAnswer({ ...empty, question, fetchFailures: 1 });
      expect(failed).toContain(vi ? "chưa có thanh toán nguồn nào được xác nhận" : "no source payment was confirmed");
    }
  });

  it("bounds and sanitizes recorded names, failure codes and skip rationales", () => {
    const answer = emptyPublicEvidenceDetail(Array.from({ length: 5 }, () => ({ name: "x\n".repeat(500), code: "y\r".repeat(100) })), []);
    expect(answer).not.toMatch(/[\r\n]/);
    expect(answer.length).toBeLessThan(1400);
  });

  it("does not invent search counts when telemetry is absent or malformed", () => {
    expect(emptyPublicEvidenceDetail([], [])).not.toContain("queries attempted");
    expect(emptyPublicEvidenceDetail([], [], { discovery: { status: "completed", attemptedQueries: -1, succeededQueries: 1, failedQueries: 0 } })).not.toContain("queries attempted");
    expect(emptyPublicEvidenceDetail([], [], { discovery: { status: "withheld" } })).toContain("withheld");
    expect(emptyPublicEvidenceDetail([], [], { discovery: { status: "not-configured" } })).toContain("not configured");
  });
});
