import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
const { transport, UnsafeTargetError } = vi.hoisted(() => ({ transport: vi.fn(), UnsafeTargetError: class UnsafeTargetError extends Error {} }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: transport, UnsafeTargetError }));
import { gatheredArticle, readArticle } from "./article-reader";
import { receiptAsset } from "../research-receipt-asset";

const requested = "https://original.example/manual";
const finalUrl = "https://cdn.example/v2/manual#server-choice";
const fact = "The synthetic limit applies to this version; retry may duplicate delivery. ";

it("keeps the caller's decoded inline heading selector through redirects, extraction and receipt provenance", async () => {
  const selected = `<h2>Before <span><dfn id="café">café 🌍</dfn></span> after</h2><p>${fact.repeat(4)}</p>`;
  const html = `<html><head><title>Original manual</title></head><body><main><p>Unrelated prefix 🌍.</p>${selected}<h2 id="server-choice">Other section</h2><p>Unrelated tail.</p></main></body></html>`;
  transport.mockResolvedValueOnce({ contentType: "text/html", finalUrl, bytes: new TextEncoder().encode(html) });
  const article = await readArticle(requested, undefined, { requestedUrls: [requested + "#caf%C3%A9"] });
  expect(article).toMatchObject({ kind: "html", finalUrl, title: "Original manual", truncated: true,
    htmlSectionScope: { format: "keryx-html-section-scope-v1", fragment: "café", headingLevel: 2,
      documentCharacters: html.length, documentSha256: createHash("sha256").update(html).digest("hex") } });
  expect(article.text).toContain("Before café 🌍 after");
  expect(article.text).toContain(fact.trim());
  expect(article.text).not.toMatch(/Unrelated|Other section/);
  expect(html.slice(article.htmlSectionScope!.htmlStart, article.htmlSectionScope!.htmlEnd)).toBe(selected);
  const gathered = gatheredArticle("public:inline", article);
  expect(gathered.itemUrl).toBe("https://cdn.example/v2/manual");
  expect(gathered.webProvenance?.truncated).toBe(true);
  expect(gathered.htmlTextLayout?.headings).toHaveLength(1);
  expect(receiptAsset(gathered).webProvenance?.htmlSectionScope).toEqual(article.htmlSectionScope);
  expect(transport).toHaveBeenLastCalledWith(requested, expect.objectContaining({ maxBytes: 2097152, timeoutMs: 8000, maxHops: 3, httpsOnly: true }));
});

it.each([
  `<h2><span hidden id="limits">Hidden</span></h2>`,
  `<h2><span id="limits">Limits</span></h2><div hidden id="limits"></div>`,
])("keeps invalid inline selectors as fixed extraction failures without falling back to unrelated content %#", async heading => {
  transport.mockResolvedValueOnce({ contentType: "text/html", finalUrl, bytes: new TextEncoder().encode(`<main>${heading}<p>${fact.repeat(4)}</p></main>`) });
  await expect(readArticle(requested, undefined, { requestedUrls: [requested + "#limits"] })).rejects.toMatchObject({
    code: "html-extraction-unavailable", message: "html-extraction-unavailable",
  });
});

it("keeps mixed whole-document and section requests in whole-document mode", async () => {
  const html = `<html><body><article><h2><span id="limits">Limits</span></h2><p>${fact.repeat(4)}</p><h2>Other section</h2><p>${"Other documented conditions remain relevant. ".repeat(8)}</p></article></body></html>`;
  transport.mockResolvedValueOnce({ contentType: "text/html", finalUrl, bytes: new TextEncoder().encode(html) });
  const article = await readArticle(requested, undefined, { requestedUrls: [requested, requested + "#limits"] });
  expect(article.text).toContain(fact.trim());
  expect(article.text).toContain("Other documented conditions");
  expect(article.htmlSectionScope).toBeUndefined();
  expect(receiptAsset(gatheredArticle("public:whole", article)).webProvenance?.htmlSectionScope).toBeUndefined();
});
