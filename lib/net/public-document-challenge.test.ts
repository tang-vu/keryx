import { createServer, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ origin: "", lookup: vi.fn(),
  requests: [] as { url: string; method: string; headers: Record<string, string> }[],
  responses: [] as { reads: () => number; cancellations: () => number }[] }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", async importOriginal => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: async (input: Parameters<typeof actual.fetch>[0], init: Parameters<typeof actual.fetch>[1]) => {
    const logical = new URL(String(input));
    mocks.requests.push({ url: logical.href, method: init?.method ?? "GET", headers: init?.headers as Record<string, string> });
    // Only physical acquisition is redirected to our own ephemeral HTTP server.
    // The real public-URL/DNS admission, native Agent/fetch/headers/body and all
    // extraction/outcome code run; this is not public TLS/socket-pin acceptance.
    const response = await actual.fetch(mocks.origin + logical.pathname + logical.search, init);
    if (response.body) {
      const reader = vi.spyOn(response.body, "getReader"), cancel = vi.spyOn(response.body, "cancel");
      mocks.responses.push({ reads: () => reader.mock.calls.length, cancellations: () => cancel.mock.calls.length });
    }
    return response;
  } };
});

import { fetchPublicBytes, UnsafeTargetError } from "./public-fetch";
import { publicFetchFailure, safePublicFetchDiagnostic } from "./public-fetch-diagnostic";
import { readArticle, articleFailureCode, articleReadDiagnostic } from "../web-research/article-reader";
import { sourceReadDetail } from "../research/source-read-outcomes";

const url = "https://original.example/document?token=PRIVATE_QUERY";
const text = "This original discusses Cloudflare challenge pages and CAPTCHA verification as its research topic. ";
const html = `<html><head><title>Verification research</title></head><body><main><p>${text.repeat(5)}</p></main></body></html>`;
type Fixture = { status: number; headers: Record<string, string>; body: string; hold?: boolean; redirect?: boolean };
let fixture: Fixture, wireClosed = 0;
const openResponses = new Set<ServerResponse>();
const server = createServer((request, response) => {
  openResponses.add(response);
  response.on("close", () => { openResponses.delete(response); wireClosed++; });
  if (fixture.redirect && request.url?.startsWith("/redirect")) {
    response.writeHead(302, { location: "/document?token=PRIVATE_REDIRECT" }); response.end(); return;
  }
  response.writeHead(fixture.status, fixture.headers);
  if (fixture.hold) response.flushHeaders();
  else response.end(fixture.body);
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture port unavailable");
  mocks.origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.requests.length = 0; mocks.responses.length = 0; wireClosed = 0;
  fixture = { status: 200, headers: { "content-type": "text/html" }, body: html };
});
afterEach(() => { for (const response of openResponses) response.end(); });
afterAll(async () => {
  for (const response of openResponses) response.end();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
async function attempt<T>(operation: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try { return { value: await operation() }; } catch (error) { return { error }; }
}
function marked(status = 200, type = "text/html") {
  fixture = { status, headers: { "content-type": type, "cf-mitigated": "challenge",
    "cf-ray": "PRIVATE_RAY", "set-cookie": "PRIVATE_COOKIE", location: "/PRIVATE_FOLLOW" },
  body: html + "PRIVATE_CHALLENGE_BODY [S99]" };
}
function verification(error: unknown, article: boolean) {
  if (article) expect(error).toMatchObject({ code: "publisher-verification-required", message: "publisher-verification-required" });
  else expect(error).toBeInstanceOf(UnsafeTargetError);
  const diagnostic = article ? articleReadDiagnostic(error) : publicFetchFailure(error);
  expect(diagnostic).toEqual({ reason: "publisher-verification-required", elapsedMs: expect.any(Number) });
  expect(safePublicFetchDiagnostic(JSON.parse(JSON.stringify(diagnostic)))).toEqual(diagnostic);
  expect(JSON.stringify({ error, diagnostic })).not.toMatch(/PRIVATE|original\.example|S99|cf-ray|set-cookie/);
  expect(mocks.responses.at(-1)?.reads()).toBe(0);
  expect(mocks.responses.at(-1)?.cancellations()).toBe(1);
  expect(mocks.requests.every(request => request.method === "GET" && !Object.keys(request.headers).some(name => /cookie|authorization|signature/iu.test(name)))).toBe(true);
}

it.each([200, 203, 206, 302, 403, 503])("refuses native HTTP %s verification before reading/parsing/redirecting and retains the existing article outcome", async status => {
  marked(status);
  const result = await attempt(() => readArticle(url));
  verification(result.error, true);
  expect(result.value).toBeUndefined(); expect(mocks.requests).toHaveLength(1);
  const detail = sourceReadDetail("public:verification", "public", "failed", articleFailureCode(result.error), articleReadDiagnostic(result.error));
  expect(detail.sourceRead).toMatchObject({ protocol: "keryx-source-read-v1", status: "failed",
    failureCode: "publisher-verification-required", diagnostic: { reason: "publisher-verification-required" } });
  expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|original\.example|S99/);
});

it.each([
  { requireFullResponse: true },
  { allowedContentTypes: ["application/pdf"] },
  { maxBytes: 1 },
])("keeps a marked response unavailable before other document processing: %j", async limits => {
  marked(206);
  const result = await attempt(() => fetchPublicBytes(url, limits));
  verification(result.error, false); expect(result.value).toBeUndefined(); expect(mocks.requests).toHaveLength(1);
});

it.each([undefined, "", "none", "Challenge", "challenge-token"])("keeps real original text readable without the exact marker, even with Cloudflare/prose cues: %j", async marker => {
  Object.assign(fixture.headers, { server: "cloudflare", "cf-ray": "PRIVATE_RAY", ...(marker === undefined ? {} : { "cf-mitigated": marker }) });
  const result = await readArticle(url);
  expect(result).toMatchObject({ kind: "html", finalUrl: url, truncated: false });
  expect(result.text).toContain(text.trim()); expect(result.title).toBe("Verification research");
  expect(mocks.responses[0].reads()).toBe(1); expect(mocks.responses[0].cancellations()).toBe(0);
  expect(mocks.requests).toHaveLength(1);
});

it("uses native case-insensitive header names while retaining exact marker value semantics", async () => {
  marked(); delete fixture.headers["cf-mitigated"]; fixture.headers["CF-Mitigated"] = "challenge";
  verification((await attempt(() => readArticle(url))).error, true);
});

it("does not treat an ordinary URL/query as a verification signal", async () => {
  const requested = "https://original.example/challenge?cf-mitigated=challenge";
  const result = await readArticle(requested);
  expect(result.text).toContain(text.trim()); expect(result.finalUrl).toBe(requested);
  expect(mocks.requests).toHaveLength(1);
});

it("checks a marked terminal response after the ordinary redirect without a new retry", async () => {
  marked(); fixture.redirect = true;
  verification((await attempt(() => readArticle("https://original.example/redirect"))).error, true);
  expect(mocks.requests).toHaveLength(2); expect(mocks.lookup).toHaveBeenCalledTimes(2);
  expect(mocks.requests[1].url).toBe("https://original.example/document?token=PRIVATE_REDIRECT");
});

it("cancels a native body that has not reached EOF instead of waiting to consume verification text", async () => {
  marked(); fixture.hold = true;
  const result = await attempt(() => fetchPublicBytes(url, { timeoutMs: 1000 }));
  verification(result.error, false); expect(result.value).toBeUndefined();
  await vi.waitFor(() => expect(wireClosed).toBe(1));
  expect(mocks.requests).toHaveLength(1);
});

it("retains caller cancellation before DNS or any physical request", async () => {
  marked(); const controller = new AbortController(); controller.abort();
  const result = await attempt(() => readArticle(url, controller.signal));
  expect(result.error).toMatchObject({ code: "cancelled", diagnostic: { reason: "cancelled" } });
  expect(mocks.requests).toEqual([]); expect(mocks.lookup).not.toHaveBeenCalled();
});

it("retains the all-address SSRF refusal before any physical acquisition", async () => {
  marked(); mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  const result = await attempt(() => readArticle(url));
  expect(result.error).toMatchObject({ code: "transport-unavailable", diagnostic: { reason: "blocked-address" } });
  expect(mocks.requests).toEqual([]);
});

it("retains ordinary byte limits and fixed HTTP failure diagnostics when no marker was observed", async () => {
  const limited = await attempt(() => fetchPublicBytes(url, { maxBytes: 2 }));
  expect(publicFetchFailure(limited.error)?.reason).toBe("byte-limit");
  fixture.status = 403;
  const failed = await attempt(() => readArticle(url));
  expect(failed.error).toMatchObject({ code: "transport-unavailable",
    diagnostic: { reason: "http-status", httpStatus: 403 } });
  expect(mocks.requests).toHaveLength(2);
});
