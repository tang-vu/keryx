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

it("admits supplied SQLite/PostgreSQL originals even when search omits them or fails", async () => {
  const urls = ["https://www.sqlite.org/wal.html", "https://www.sqlite.org/pragma.html#pragma_synchronous",
    "https://www.postgresql.org/docs/current/sql-select.html"];
  const search = vi.fn(async (query: string) => {
    if (query === "second query") throw new Error("provider unavailable");
    return [{ url: "https://secondary.example/article", title: "Secondary", snippet: "unread secondary snippet" }];
  });
  const result = await discoverWeb({ search }, `Use ${urls.join(" and ")} to explain concurrency.`, ["second query"], true);
  expect([...result.candidates.values()].slice(0, 3).map(candidate => candidate.item?.itemUrl)).toEqual(urls);
  expect(result.requestedSources).toHaveLength(3);
  expect(result.failedQueries).toBe(1);
  expect(result.succeededQueries).toBe(1);
  for (const candidate of [...result.candidates.values()].slice(0, 3)) {
    expect(candidate).toMatchObject({ sourceKind: "public-reference", fetchPrice: 0, cached: false,
      item: { contentVersion: "unread" }, tags: ["public-web", "requested-source"] });
    expect(candidate.description).toContain("no official authorship or document contents established");
    expect(candidate.preview).not.toContain("secondary snippet");
  }
});

it("admits bounded supplied leads without a configured provider and makes no search/fetch calls", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    const result = await discoverWeb(null, "Read https://docs.example/manual#scope.", ["https://invented.example/by-model"], false);
    expect(result.candidates.size).toBe(1);
    expect(result.queries).toBe(0); expect(result.attemptedQueries).toBe(0);
    expect([...result.candidates.values()][0].item?.itemUrl).toBe("https://docs.example/manual#scope");
    expect([...result.candidates.values()][0].preview).toContain("bounded whole document");
    expect(fetch).not.toHaveBeenCalled();
    expect((await discoverWeb(null, "No supplied URL", ["https://invented.example/by-model"], false)).candidates.size).toBe(0);
  } finally { fetch.mockRestore(); }
});

it("deduplicates document bodies before publisher slots while retaining requested fragments", async () => {
  const search = vi.fn(async () => [
    { url: "https://docs.example/manual", title: "Provider duplicate", snippet: "must not replace supplied scope" },
    { url: "https://docs.example/other", title: "Other", snippet: "Preview" },
  ]);
  const result = await discoverWeb({ search }, "Read https://docs.example/manual#first and https://docs.example/manual#second", [], true);
  expect(result.candidates.size).toBe(2);
  expect(result.requestedSources[0].candidateId).toBe(result.requestedSources[1].candidateId);
  const original = [...result.candidates.values()][0];
  expect(original.item?.itemUrl).toBe("https://docs.example/manual#first");
  expect(original.preview).toContain("#second");
  expect(original.preview).not.toContain("must not replace supplied scope");
});

it("refuses unsafe supplied leads with bounded reasons and preserves publisher/total caps", async () => {
  const unsafe = ["http://docs.example/old", "https://user:password@docs.example/page", "https://127.0.0.1/private",
    "https://[::ffff:127.0.0.1]/private", "https://docs.example:3939/port", "https://%/malformed", "https://user:password@%/page"];
  const result = await discoverWeb(null, unsafe.join(" "), [], false);
  expect(result.candidates.size).toBe(0);
  expect(result.requestedSources.map(source => source.refusal)).toEqual(["https-required", "url-credentials",
    "non-public-literal-host", "non-public-literal-host", "unsupported-port", "invalid-url", "invalid-url"]);
  expect(JSON.stringify(result.requestedSources)).not.toContain("password");
  const urls = Array.from({ length: 10 }, (_, index) => `https://requested${index}.example/page`);
  const bounded = await discoverWeb({ search: async () => Array.from({ length: 40 }, (_, index) => ({
    url: `https://search${index}.example/page`, title: "Search lead", snippet: "Preview",
  })) }, urls.join(" "), [], false);
  expect(bounded.requestedSources).toHaveLength(8); expect(bounded.omittedRequestedSources).toBe(2);
  expect(bounded.candidates.size).toBe(24);
  const concentrated = await discoverWeb(null, "Read https://docs.example/one https://docs.example/two https://docs.example/three", [], false);
  expect(concentrated.candidates.size).toBe(2);
  expect(concentrated.requestedSources[2]).toMatchObject({ url: "https://docs.example/three", refusal: "publisher-candidate-limit" });
});

it("retains the official-document discussion gate and cancellation for supplied URLs", async () => {
  const docs = await discoverWeb(null, "Use official SQLite documentation at https://sqlite.org/forum/info/proposal", [], false);
  expect(docs.candidates.size).toBe(0);
  expect(docs.requestedSources[0].refusal).toBe("discussion-does-not-meet-document-request");
  const cancelled = await discoverWeb(null, "Read https://docs.example/manual", [], false, AbortSignal.abort());
  expect(cancelled.candidates.size).toBe(0);
  expect(cancelled.requestedSources[0].refusal).toBe("cancelled");
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
