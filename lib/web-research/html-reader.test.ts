import { expect, it } from "vitest";
import { extractHtml } from "./html-reader";
import { acquireParserSlot } from "./parser-slots";
import { gatheredArticle } from "./article-reader";
const passage = "The original document states that readable public evidence remains distinct from a factual truth guarantee. ";
const html = `<html><head><title>Original title</title></head><body><script>process.exit(7)</script><img src="http://127.0.0.1/private"><article><h1>Original title</h1><p>${passage.repeat(12)}</p></article></body></html>`;
it("extracts original article text in a bounded inert child and snapshots provenance", async () => {
  const article = await extractHtml(html, "https://news.example.com/article");
  expect(article.text).toContain(passage.trim()); expect(article.text).not.toContain("process.exit");
  const read = gatheredArticle("public:web:test", article);
  expect(read).toMatchObject({ sourceKind: "public-reference", itemUrl: "https://news.example.com/article", publicDeliveryKind: "excerpt" });
  expect(read.webProvenance).toMatchObject({ publisherGroup: "example.com", extraction: "html", truncated: false });
  expect(read.contentVersion).toHaveLength(64);
});
it("rejects concurrent parser admission and releases after cancellation or failed extraction", async () => {
  const release = acquireParserSlot(); await expect(extractHtml(html, "https://example.com")).rejects.toThrow("busy"); release();
  const controller = new AbortController(); const reading = extractHtml(html, "https://example.com", controller.signal); controller.abort();
  await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  await expect(extractHtml("<html><body>login required</body></html>", "https://example.com")).rejects.toThrow();
  expect((await extractHtml(html, "https://example.com")).text).toContain(passage.trim());
});
