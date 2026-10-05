import { expect, it, vi } from "vitest";
import { discoverWeb } from "./discovery";
import { bodyIdentity, canonicalUrl, publisherGroup } from "./url-identity";
import { searxngProvider } from "./search-provider";

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

it("searches every deep research target and shares the candidate cap between queries", async () => {
  const search = vi.fn(async (query: string) => Array.from({ length: 30 }, (_, index) => ({
    title: `${query} ${index}`, snippet: "preview", url: `https://${query.replace(/\W/g, "")}${index}.test/page`,
  })));
  const claims = Array.from({ length: 8 }, (_, index) => `claim ${index}`);
  const result = await discoverWeb({ search }, "question", claims, false);
  expect(search).toHaveBeenCalledTimes(9);
  expect(result.candidates.size).toBe(18);
  // No single query fills the cap: the last target is still represented.
  const names = [...result.candidates.values()].map(candidate => candidate.name);
  expect(names.filter(name => name.startsWith("question ")).length).toBe(2);
  expect(names.some(name => name.startsWith("claim 7 "))).toBe(true);
});
