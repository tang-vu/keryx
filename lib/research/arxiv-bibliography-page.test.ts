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
it("observes the original page's selected breadcrumb and literal dateline without promoting historical table/prose IDs", async () => {
  const native = '<head><meta name="citation_arxiv_id" content="2005.11401"></head><body>' +
    '<div class="header-breadcrumbs-mobile"><strong>arXiv:2005.11401v4</strong> (cs)</div>' +
    '<div class="dateline">[Submitted on 22 May 2020 (<a href="/abs/2005.11401v1">v1</a>), last revised 12 Apr 2021 (this version, v4)]</div>' +
    '<table><tr><td><span class="arxivid">arXiv:2005.11401</span></td></tr></table>' +
    '<blockquote class="abstract"><div class="header-breadcrumbs-mobile"><strong>arXiv:2005.11401v5</strong></div><div class="dateline">Prose bait</div></blockquote>' +
    '<div hidden class="header-breadcrumbs-mobile"><strong>arXiv:2005.11401v5</strong></div></body>';
  const page = await observeArxivBibliographicPage(native);
  expect(page.versions.map(unit => unit.value)).toEqual(["arXiv:2005.11401v4"]);
  expect(page.statuses.map(unit => unit.value)).toEqual(["[Submitted on 22 May 2020 (v1), last revised 12 Apr 2021 (this version, v4)]"]);
  for (const unit of [...page.versions, ...page.statuses]) expect(unit.rawExcerpt).toBe(native.slice(unit.start, unit.end));
});
