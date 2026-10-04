import { describe, expect, it } from "vitest";
import { discussionDoesNotMeetDocumentRequest, isRecognizedDiscussionUrl, requestsOfficialDocumentation } from "./source-requirements";

describe("explicit documentation requirements", () => {
  it.each([
    "Use official SQLite documentation.",
    "What should I check? Use the official Next.js docs and explain the limits.",
    "According to official systemd manuals, what happens on stop?",
    "Tôi cần sao lưu WAL. Dựa trên tài liệu chính thức SQLite, chỉ rõ điều kiện.",
    "Dùng tài liệu chính thức systemd.",
    "Theo tài liệu SQLite chính thức, cần kiểm tra gì?",
  ])("recognizes the explicit instruction: %s", question => expect(requestsOfficialDocumentation(question)).toBe(true));

  it.each([
    "Compare a forum proposal with official documentation.",
    "Don't use official documentation; summarize forum opinions.",
    "Không dùng tài liệu chính thức; tôi muốn đọc thảo luận.",
    'Explain the phrase "Use official documentation".',
    "Are official docs complete?",
    "Use official SQLite documentation for the guarantee. Then summarize user forum experiences.",
    "Use official SQLite documentation and compare it with user forum experiences.",
    "Dùng tài liệu chính thức SQLite và tóm tắt kinh nghiệm diễn đàn.",
  ])("does not infer a blanket requirement: %s", question => expect(requestsOfficialDocumentation(question)).toBe(false));

  it.each([
    "https://sqlite.org/forum/info/f7695281d872034d",
    "https://sqlite.org/%66orum/info/example",
    "https://github.com/vercel/next.js/issues/123",
    "https://github.com/systemd/systemd/discussions/123",
    "https://www.reddit.com/r/sqlite/comments/abc/example",
    "https://stackoverflow.com/questions/123/example",
    "https://dba.stackexchange.com/questions/123/example",
    "https://community.example.org/t/example/123",
  ])("recognizes discussion shape: %s", url => expect(isRecognizedDiscussionUrl(url)).toBe(true));

  it.each([
    "https://sqlite.org/backup.html",
    "https://sqlite.org/wal.html?next=/forum/info/proposal",
    "https://github.com/org/repo/blob/main/docs/issues.md",
    "https://sqlite.org.evil.example/backup.html",
    "https://unknown.example/article",
    "not a URL",
  ])("makes no positive authority claim for: %s", url => expect(isRecognizedDiscussionUrl(url)).toBe(false));

  it("retains the original request when decomposition omits the source requirement", () => {
    expect(discussionDoesNotMeetDocumentRequest("Use official SQLite documentation.", "https://sqlite.org/forum/info/proposal", "How do I copy a file?")).toBe(true);
    expect(discussionDoesNotMeetDocumentRequest("Compare backup choices.", "https://sqlite.org/forum/info/proposal", "According to official SQLite documentation, is this safe?")).toBe(true);
    expect(discussionDoesNotMeetDocumentRequest("Summarize this forum proposal.", "https://sqlite.org/forum/info/proposal")).toBe(false);
  });
  it("keeps independent forum targets in a mixed-source question", () => {
    const question = "Use official SQLite documentation for the guarantee. Then summarize user forum experiences.";
    const url = "https://sqlite.org/forum/info/proposal";
    expect(discussionDoesNotMeetDocumentRequest(question, url, "Summarize user forum experiences.")).toBe(false);
    expect(discussionDoesNotMeetDocumentRequest(question, url, "Use official SQLite documentation for the guarantee.")).toBe(true);
  });
});
