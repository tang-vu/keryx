import { describe, expect, it } from "vitest";
import { discussionDoesNotMeetDocumentRequest, isRecognizedDiscussionUrl, requestsOfficialDocumentation, requestedSourceUrls } from "./source-requirements";

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

describe("caller-supplied source URL leads", () => {
  it("retains exact query/fragment scope and parses ordinary prose and Markdown closers", () => {
    const question = "Use https://www.sqlite.org/wal.html and [synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous). Also https://docs.example/path(foo)?v=1#section.";
    expect(requestedSourceUrls(question)).toEqual({ urls: ["https://www.sqlite.org/wal.html",
      "https://www.sqlite.org/pragma.html#pragma_synchronous", "https://docs.example/path(foo)?v=1#section"], omitted: 0 });
    expect(requestedSourceUrls('Read `https://docs.example/path.` and <https://docs.example/other?q=a;b#frag.>')).toEqual({
      urls: ["https://docs.example/path.", "https://docs.example/other?q=a;b#frag."], omitted: 0 });
  });

  it("deduplicates identical supplied URLs and reports the finite eight-lead boundary", () => {
    const urls = Array.from({ length: 10 }, (_, index) => `https://docs${index}.example/page`);
    expect(requestedSourceUrls(urls.join(" ") + " " + urls[0])).toEqual({ urls: urls.slice(0, 8), omitted: 2 });
  });

  it("treats HTTP URLs as leads without upgrading their scheme or inventing a URL from a domain", () => {
    expect(requestedSourceUrls("Read http://docs.example/original. The other domain is sqlite.org.")).toEqual({
      urls: ["http://docs.example/original"], omitted: 0 });
    expect(requestedSourceUrls("Use official SQLite documentation.").urls).toEqual([]);
  });

  it("bounds scanning and never admits a URL cut by the question bound", () => {
    const partial = "x".repeat(29980) + " https://docs.example/exact-version";
    expect(requestedSourceUrls(partial)).toEqual({ urls: [], omitted: 0, questionTruncated: true });
    const repeated = Array.from({ length: 17 }, () => "https://docs.example/first").join(" ") + " https://docs.example/unscanned";
    expect(requestedSourceUrls(repeated)).toEqual({ urls: ["https://docs.example/first"], omitted: 0, scanTruncated: true });
  });
});
