import { expect, it, vi } from "vitest";
import { discoverWeb } from "./discovery";
import { bodyIdentity, canonicalUrl, publisherGroup } from "./url-identity";
import { searxngProvider } from "./search-provider";

it("preserves publisher slots for requested documentation without extra searches or inventing a page", async () => {
  const search = vi.fn(async () => [
    { title: "Official-looking forum", url: "https://sqlite.org/forum/info/one", snippet: "A proposal" },
    { title: "Another forum", url: "https://sqlite.org/forum/info/two", snippet: "A question" },
    { title: "Backup documentation", url: "https://sqlite.org/backup.html", snippet: "An unread document preview" },
  ]);
  const result = await discoverWeb({ search }, "Use official SQLite documentation.", ["Explain backup"], true);
  expect(search).toHaveBeenCalledTimes(2);
  expect(result.withheldDiscussionPreviews).toBe(2);
  expect([...result.candidates.values()].map(c => c.item?.itemUrl)).toEqual(["https://sqlite.org/backup.html"]);
  const onlyForum = await discoverWeb({ search: async () => (await search()).slice(0, 2) }, "Dùng tài liệu chính thức SQLite.", [], true);
  expect(onlyForum.candidates.size).toBe(0);
  expect(onlyForum.withheldDiscussionPreviews).toBe(2);
});

it("bounds queries and candidates, groups subdomains and treats snippets only as previews", async () => {
  const search = vi.fn(async () => Array.from({ length: 50 }, (_, index) => ({ title: `page ${index}`, snippet: "<b>preview only</b>", url: `https://host${index}.example.com/${index}` })));
  const result = await discoverWeb({ search }, "query", ["claim one", "claim two", "claim three"], true);
  expect(search).toHaveBeenCalledTimes(2); expect(result.candidates.size).toBe(2);
  expect([...result.candidates.values()][0]).toMatchObject({ cached: false, fetchPrice: 0, preview: " preview only " });
  expect(result.attemptedQueries).toBe(2); expect(result.succeededQueries).toBe(2);
});
it("distinguishes unavailable, truncated and cancelled searches without invented attempts", async () => {
  const search = vi.fn(async () => { throw new Error("SECRET provider details"); });
  const result = await discoverWeb({ search }, "x".repeat(600), ["claim"], true);
  expect(result).toMatchObject({ attemptedQueries: 2, succeededQueries: 0, failedQueries: 2, truncatedQueries: true });
  const controller = new AbortController(); controller.abort();
  expect(await discoverWeb({ search }, "q", ["c"], false, controller.signal)).toMatchObject({ attemptedQueries: 0, cancelled: true });
});
it("canonicalizes tracking links and groups shared domains without claiming ownership", () => {
  expect(canonicalUrl("https://www.example.com/a?utm_source=x&b=1#frag")).toBe("https://www.example.com/a?b=1");
  expect(canonicalUrl("https://u:p@example.com")).toBeNull(); expect(canonicalUrl("http://example.com")).toBeNull();
  expect(publisherGroup("https://news.example.co.uk/a")).toBe("example.co.uk");
  expect(bodyIdentity("a\n b")).toBe(bodyIdentity("a b"));
});
it("only permits trusted HTTPS or exact loopback provider configuration", () => {
  for (const url of ["http://localhost:8080/search", "http://192.168.1.6:8080/search", "https://a:b@example.com/search", "file:///a", "https://example.com/search?token=secret"]) expect(() => searxngProvider(url)).toThrow();
  expect(searxngProvider("http://127.0.0.1:8080/search")).toBeDefined();
});
it("bounds provider response parsing, rejects unsafe result URLs and disables redirects", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [
    { url: "file:///private", title: "bad" }, { url: "https://publisher.example/a?utm_source=x", title: "Original", content: "<b>preview</b>" },
    ...Array.from({ length: 80 }, (_, index) => ({ url: `https://publisher.example/${index}`, title: "page" }))] })));
  try {
    const rows = await searxngProvider("http://127.0.0.1:8888/search").search("question");
    expect(rows.length).toBeLessThanOrEqual(40); expect(rows[0].url).toBe("https://publisher.example/a");
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
    request.mockResolvedValue(new Response("x".repeat(250001)));
    await expect(searxngProvider("http://127.0.0.1:8888/search").search("question")).rejects.toThrow("limit");
  } finally { request.mockRestore(); }
});
