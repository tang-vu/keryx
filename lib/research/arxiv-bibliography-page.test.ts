import { expect, it } from "vitest";
import { observeArxivBibliographicPage } from "./arxiv-bibliography-page";
import { acquireParserSlot } from "../web-research/parser-slots";

const html = '<html><head><meta name="citation_title" content="Original title"></head><body><span class="arxivid">arXiv:2005.11401v4</span></body></html>';
it("shares bounded parser admission and releases it after abort or worker failure", async () => {
  const release = acquireParserSlot(); await expect(observeArxivBibliographicPage(html)).rejects.toThrow("busy"); release();
  const controller = new AbortController(), parsing = observeArxivBibliographicPage(html, controller.signal); controller.abort();
  await expect(parsing).rejects.toMatchObject({ name: "AbortError" });
  await expect(observeArxivBibliographicPage(`<html><head>${'<meta name="citation_author" content="name">'.repeat(151)}</head></html>`)).rejects.toThrow("invalid-metadata-read");
  expect((await observeArxivBibliographicPage(html)).versions[0].value).toBe("arXiv:2005.11401v4");
});

it("refuses excess input bytes and DOM observations without retaining a sliced metadata field", async () => {
  await expect(observeArxivBibliographicPage("é".repeat(125001))).rejects.toThrow("invalid-metadata-read");
  await expect(observeArxivBibliographicPage(`<body>${"<i>x</i>".repeat(12500)}</body>`)).rejects.toThrow("invalid-metadata-read");
  const page = await observeArxivBibliographicPage(`<head><meta name="citation_title" content="${"T".repeat(1201)}"></head>`);
  expect(page.metadata.citation_title?.[0]).toMatchObject({ overBound: true }); expect(page.metadata.citation_title?.[0].value).toBeUndefined();
  expect((await observeArxivBibliographicPage(html)).metadata.citation_title?.[0].value).toBe("Original title");
});
