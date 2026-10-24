import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractHtml } from "./html-reader";
import { gatheredArticle, requestedHtmlFragment } from "./article-reader";
import { receiptAsset } from "../research-receipt-asset";

const url = "https://docs.example/manual/v2";
const fact = "The synthetic integration accepts one explicit version and does not guarantee delivery. ";
const section = `<h2 id="limits">Limits &amp; conditions</h2><p>${fact.repeat(3)}</p><h3>Exceptions</h3><p>Only the selected version supports this operation. A retry may duplicate the operation.</p>`;

it("reads a late heading in a document beyond the unchanged whole-document element cap", async () => {
  const html = `<html><head><title>Original manual</title></head><body><main>${"<span>unrelated</span>".repeat(20001)}${section}<h2>Other section</h2><p>Unrelated tail.</p></main></body></html>`;
  await expect(extractHtml(html, url)).rejects.toThrow();
  const result = await extractHtml(html, url, undefined, "limits");
  expect(result).toMatchObject({ finalUrl: url, title: "Original manual", truncated: true,
    htmlSectionScope: { fragment: "limits", headingLevel: 2, documentCharacters: html.length,
      documentSha256: createHash("sha256").update(html).digest("hex") } });
  expect(result.text).toContain("A retry may duplicate the operation.");
  expect(result.text).not.toMatch(/unrelated|Other section|Unrelated tail/);
  const scope = result.htmlSectionScope!;
  expect(html.slice(scope.htmlStart, scope.htmlEnd)).toBe(section);
  const gathered = gatheredArticle("public:web:synthetic", result);
  expect(gathered.htmlTextLayout?.headings).toHaveLength(2);
  expect(receiptAsset(gathered).webProvenance?.htmlSectionScope).toEqual(scope);
});

it("reads a visible empty legacy named anchor followed immediately by a heading", async () => {
  const html = `<html><body><a name="loudnorm"></a>\n<h3>8.97 loudnorm</h3><p>${fact.repeat(3)}</p><dl><dt>linear</dt><dd><p>If any condition is not met, normalization reverts to dynamic.</p></dd></dl><a name="next"></a><h3>Next filter</h3></body></html>`;
  const result = await extractHtml(html, url, undefined, "loudnorm");
  expect(result.text).toContain("normalization reverts to dynamic.");
  expect(result.text).not.toContain("Next filter");
});

it("keeps Unicode and literal code while stopping at the enclosing region", async () => {
  const html = `<html><body><main><h2 id="café">Café 🌍</h2><p>${fact.repeat(2)}</p><pre>if (x &lt; 3) {\n  retry();\n}</pre></main><p>Outside the selected parent.</p></body></html>`;
  const result = await extractHtml(html, url, undefined, "café");
  expect(result.text).toContain("Café 🌍");
  expect(result.text).toContain("if (x < 3) {\n  retry();\n}");
  expect(result.text).not.toContain("Outside");
});

it.each([
  `<h2 id="limits">Limits</h2><p>${fact.repeat(3)}</p><h2 id="limits">Duplicate after capture</h2>`,
  `<h2 id="limits">Limits</h2><p>${fact.repeat(3)}</p><div hidden id="limits"></div>`,
  `<div hidden><h2 id="limits">Hidden</h2><p>${fact.repeat(3)}</p></div>`,
  `<nav><h2 id="limits">Navigation</h2><p>${fact.repeat(3)}</p></nav>`,
  `<script>const bait='<h2 id="limits">Fake</h2>';</script><p>${fact.repeat(3)}</p>`,
  `<template><h2 id="limits">Template</h2><p>${fact.repeat(3)}</p></template>`,
  `<svg><title id="limits">Foreign content</title></svg><p>${fact.repeat(3)}</p>`,
  `<a href="#limits">TOC link</a><p>${fact.repeat(3)}</p>`,
  `<a name="limits">Not empty</a><h2>Heading</h2><p>${fact.repeat(3)}</p>`,
  `<a name="limits"></a><p>Intervening content.</p><h2>Heading</h2><p>${fact.repeat(3)}</p>`,
  `<div id="limits"><p>${fact.repeat(3)}</p></div>`,
  `<div style="visibility:hidden"><h2 id="limits" style="visibility:visible">Reset</h2><p>${fact.repeat(3)}</p></div>`,
  `<h2 id="limits">Limits</h2><p>${fact.repeat(3)}</div>`,
])("refuses missing, ambiguous, hidden and unsupported section shapes %#", async body => {
  await expect(extractHtml(`<html><body>${body}</body></html>`, url, undefined, "limits")).rejects.toThrow();
});

it("does not treat anchors in comments or script strings as duplicate IDs", async () => {
  const html = `<html><body><!-- <h2 id="limits">Fake</h2> --><script>const fake='<h2 id="limits">Fake</h2>';</script>${section}</body></html>`;
  expect((await extractHtml(html, url, undefined, "limits")).text).toContain(fact.trim());
});

it("retains depth/selected-element/normalized-byte bounds and releases admission after failures", async () => {
  for (const body of ["<div>".repeat(257) + section + "</div>".repeat(257),
    `<h2 id="limits">Limits</h2>${"<span>x</span>".repeat(20001)}`,
    `<h2 id="limits">Limits</h2><p>${"é".repeat(260000)}</p>`]) {
    await expect(extractHtml(`<html><body>${body}</body></html>`, url, undefined, "limits")).rejects.toThrow();
  }
  expect((await extractHtml(`<main>${section}</main>`, url, undefined, "limits")).text).toContain(fact.trim());
});

it("keeps caller selector intent separate from transport identity and refuses wrong-document options", () => {
  expect(requestedHtmlFragment(url, { requestedUrls: [url + "#caf%C3%A9"] })).toBe("café");
  expect(requestedHtmlFragment(url + "#limits")).toBe("limits");
  expect(requestedHtmlFragment(url, { requestedUrls: [url, url + "#limits"] })).toBeUndefined();
  expect(requestedHtmlFragment(url, { requestedUrls: [url + "#limits", url + "#other"] })).toBeUndefined();
  expect(() => requestedHtmlFragment(url, { requestedUrls: ["https://different.example/#limits"] })).toThrow();
  expect(() => requestedHtmlFragment(url + "#%FF")).toThrow();
});

it("handles direct optional list/paragraph end tags without guessing formatting reconstruction", async () => {
  const html = `<html><head><title>Manual</title></head><body><ul><li>First<li>Second</ul><a name="limits"></a><h2>Limits</h2><p>${fact.repeat(2)}<p>A retry may duplicate delivery.<dl><dt>Version<dd>Only version two<dt>Limit<dd>One operation</dl><h2>Next</h2></body></html>`;
  const result = await extractHtml(html, url, undefined, "limits");
  expect(result.text).toContain("A retry may duplicate delivery.");
  expect(result.text).toContain("Only version two");
  await expect(extractHtml(`<html><body><p hidden><span><h2 id="limits">Bad repair</h2><p>${fact.repeat(2)}</p></span></p></body></html>`, url, undefined, "limits")).rejects.toThrow();
});

it("refuses an ambiguous peer heading nested inside a still-open section wrapper", async () => {
  await expect(extractHtml(`<main>${section}<div><h2>Ambiguous end</h2></div></main>`, url, undefined, "limits")).rejects.toThrow();
});
