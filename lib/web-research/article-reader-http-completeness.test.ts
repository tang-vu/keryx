import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), fetch: vi.fn(), close: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("undici", () => ({ fetch: mocks.fetch, Agent: class { async close() { mocks.close(); } } }));
import { readArticle, gatheredArticle } from "./article-reader";
import { receiptAsset } from "../research-receipt-asset";
import { pdfFixture } from "../../test-support/pdf-fixture";

const passage = "The received extract does not include the omitted continuation of this source. ";
const html = `<html><head><title>Observed original</title></head><body><main><p>${passage.repeat(4)}</p></main></body></html>`;
const formats = [
  { type: "text/html", bytes: Buffer.from(html), kind: "html" },
  { type: "application/xhtml+xml", bytes: Buffer.from(html), kind: "html" },
  { type: "text/plain", bytes: Buffer.from(passage.repeat(4)), kind: "text" },
  { type: "text/markdown", bytes: Buffer.from(`# Observed original\n\n${passage.repeat(4)}`), kind: "text" },
  { type: "application/pdf", bytes: pdfFixture([passage]), kind: "pdf" },
];
const url = "https://source.example/document";
beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.fetch.mockReset(); mocks.close.mockClear();
});

it.each(formats.flatMap(format => [
  { ...format, status: 206, ranged: false }, { ...format, status: 200, ranged: true }, { ...format, status: 200, ranged: false },
]))("carries $type status=$status ranged=$ranged through actual HTTP,extraction and public receipt", async ({ type, bytes, kind, status, ranged }) => {
  mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(bytes), { status,
    headers: { "content-type": type, ...(ranged ? { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length + 100}` } : {}) } }));
  const article = await readArticle(url), expectedPartial = status === 206 || ranged;
  expect(article).toMatchObject({ kind, finalUrl: url, truncated: expectedPartial });
  expect(article.text).toContain(passage.trim());
  const gathered = gatheredArticle("public:http-scope", article), asset = receiptAsset(gathered);
  expect(gathered.webProvenance?.truncated).toBe(expectedPartial);
  expect(asset.webProvenance?.truncated).toBe(expectedPartial); expect(gathered.text).toBe(article.text);
  if (kind === "pdf") expect(gathered.webProvenance?.pdfTextScope).toMatchObject({ pagesRead: 1, totalPages: 1, textLimitReached: false });
  expect(mocks.fetch).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});

it.each([false, true])("uses only final response scope after a redirect: terminal partial=%s", async partial => {
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/original", "content-range": "PRIVATE_REDIRECT_RANGE" } }))
    .mockResolvedValueOnce(new Response(html, { status: partial ? 206 : 200, headers: { "content-type": "text/html" } }));
  const article = await readArticle(url);
  expect(article).toMatchObject({ finalUrl: "https://source.example/original", truncated: partial });
  expect(article.text).toContain(passage.trim()); expect(JSON.stringify(receiptAsset(gatheredArticle("public:redirect", article)))).not.toContain("PRIVATE_REDIRECT_RANGE");
  expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.close).toHaveBeenCalledTimes(2);
});

it.each([false, true])("retains character-limit truncation with terminal HTTP partial=%s", async partial => {
  mocks.fetch.mockResolvedValueOnce(new Response(passage.repeat(1000), { status: partial ? 206 : 200, headers: { "content-type": "text/plain" } }));
  const article = await readArticle(url);
  expect(article.truncated).toBe(true); expect(article.text).toHaveLength(60000);
  expect(receiptAsset(gatheredArticle("public:limited", article)).webProvenance?.truncated).toBe(true);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
