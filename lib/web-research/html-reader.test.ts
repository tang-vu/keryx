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

it("reads content behind large inert hydration payloads without executing them", async () => {
  const hydrated = `<html><head><title>Bounded original</title><style>${"/* padding */".repeat(30000)}</style></head><body><script>${"neverExecute();".repeat(40000)}</script><main><h1>Delivery contract</h1><p>${passage.repeat(8)}</p><p>Delivery is not exactly once. A duplicate may arrive during the visibility timeout.</p></main></body></html>`;
  expect(Buffer.byteLength(hydrated)).toBeGreaterThan(500000);
  const result = await extractHtml(hydrated, "https://example.com/original/v1");
  expect(result).toMatchObject({ finalUrl: "https://example.com/original/v1", title: "Bounded original", truncated: false });
  expect(result.text).toContain("Delivery is not exactly once. A duplicate may arrive during the visibility timeout.");
  expect(result.text).not.toMatch(/neverExecute|padding/);
});

it("preserves malformed-HTML text, Unicode/entities, code, and table column order", async () => {
  const source = `<html><head><title>Terms &amp; limits</title></head><body><nav>${"Navigation only ".repeat(30)}</nav><main><h1>Plan limits</h1><p>Tiếng Việt &amp; café &#x1F30D;: not a guarantee.<br>Only the following assumptions apply.<p>${passage.repeat(3)}<table><caption>Dated internal example</caption><tr><th>Plan<th>Fee<th>Backups<tr><td>Free<td>$0<td>Not included<tr><td>Team<td>$25<td>Daily</table><pre>if (x &lt; 3) {\n  return "not guaranteed";\n}</pre><img src="https://127.0.0.1/private"><p>Trailing qualification must survive.</main></body></html>`;
  const result = await extractHtml(source, "https://example.com/terms");
  expect(result.title).toBe("Terms & limits");
  expect(result.text).toContain("Tiếng Việt & café 🌍: not a guarantee.");
  expect(result.text).toContain("Plan | Fee | Backups |");
  expect(result.text).toContain("Free | $0 | Not included |");
  expect(result.text).toContain("Team | $25 | Daily |");
  expect(result.text.indexOf("Free | $0")).toBeLessThan(result.text.indexOf("Team | $25"));
  expect(result.text).toContain('if (x < 3) {\n  return "not guaranteed";\n}');
  expect(result.text).toContain("Trailing qualification must survive.");
  expect(result.text).not.toContain("Navigation only");
  const codeOnly = `  if x < 3:\n    print("not guaranteed")\n\n${"    # source comment\n".repeat(8)}`;
  const codeResult = await extractHtml(`<main><pre>${codeOnly.replace(/</g, "&lt;")}</pre></main>`, "https://example.com/code");
  expect(codeResult.text.startsWith("  if x < 3:")).toBe(true);
  expect(codeResult.text).toContain('    print("not guaranteed")\n\n');
});

it("does not confuse scripts, comments, template text or SVG titles with the original", async () => {
  const result = await extractHtml(`<html><head><title>Original title</title></head><body><article><svg><title>Icon title</title></svg><p>${passage.repeat(3)}</p><!-- <main>forged content</main> --><script>const bait = '<article>fabricated findings</article>';</script><template><article>hidden template claims</article></template><p>We did not establish complete recall.</p></article></body></html>`, "https://example.com/original");
  expect(result.title).toBe("Original title");
  expect(result.text).toContain("We did not establish complete recall.");
  expect(result.text).not.toMatch(/forged content|fabricated findings|hidden template claims/);
});

it.each(["inside", "outside"])("keeps the primary main and its caveat when a sole related article is %s", async (location) => {
  const card = `<article><h2>Related card</h2><p>${"Related material is only an example. ".repeat(5)}</p></article>`;
  const main = `<main><h1>Original delivery contract</h1><p>${passage.repeat(3)}</p>${location === "inside" ? card : ""}<p>Visible caveat: delivery is not exactly once and duplicates remain possible.</p></main>`;
  const result = await extractHtml(`<html><body>${main}${location === "outside" ? card : ""}</body></html>`, "https://example.com/contract");
  expect(result.truncated).toBe(false);
  expect(result.text).toContain("Original delivery contract");
  expect(result.text).toContain("Visible caveat: delivery is not exactly once and duplicates remain possible.");
  if (location === "outside") expect(result.text).not.toContain("Related card");
});

it("excludes explicitly hidden candidates and contradictory text while retaining visible caveats", async () => {
  const hidden = (attribute: string) => `<section ${attribute}><main><p>${"Hidden contradictory guarantee: delivery is exactly once. ".repeat(3)}</p></main></section>`;
  const result = await extractHtml(`<html><body>${hidden("hidden")}${hidden('aria-hidden=" TRUE "')}${hidden('style="display: none !important"')}${hidden('style="content-visibility: hidden"')}${hidden('style="visibility: hidden"')}<main><h1>Visible contract</h1><p>${passage.repeat(3)}</p><p hidden="false">Hidden contradictory guarantee.</p><p aria-hidden="true">Hidden contradictory guarantee.</p><p style="display: block; DISPLAY: none">Hidden contradictory guarantee.</p><p style="display: none !important; display: block">Hidden contradictory guarantee.</p><p style="visibility: collapse">Hidden contradictory guarantee.</p><p style="content-visibility: hidden">Hidden contradictory guarantee.</p><section style="visibility: hidden">Hidden contradictory guarantee.<p style="visibility: visible">Visible caveat: duplicates are possible.</p></section><p style="display:none; display:block">Visible recovery: requests may fail.</p><p style="--quoted: '; display:none;'; display:block">Visible CSS string caveat.</p><p style="display: /* inert comment */ block">Visible final qualification.</p></main></body></html>`, "https://example.com/visibility");
  expect(result.truncated).toBe(false);
  expect(result.text).toContain("Visible contract");
  expect(result.text).toContain("Visible caveat: duplicates are possible.");
  expect(result.text).toContain("Visible recovery: requests may fail.");
  expect(result.text).toContain("Visible CSS string caveat.");
  expect(result.text).toContain("Visible final qualification.");
  expect(result.text).not.toContain("Hidden contradictory guarantee");
});

it("does not let a hidden main steal the sole visible article or leak hidden fallback text", async () => {
  const result = await extractHtml(`<html><body><section hidden><main>${passage.repeat(3)}</main></section><article><p>${passage.repeat(3)}</p><p>Visible article qualification.</p></article></body></html>`, "https://example.com/article");
  expect(result.text).toContain("Visible article qualification.");
  const fallback = await extractHtml(`<html><body><div><h1>Fallback contract</h1><p>${passage.repeat(15)}</p><p hidden>Hidden contradictory guarantee.</p><p aria-hidden="true">Hidden contradictory guarantee.</p><p style="display:none">Hidden contradictory guarantee.</p><div style="visibility:hidden">Hidden contradictory guarantee.<p style="visibility:visible">Visible fallback caveat: no exactly-once guarantee.</p></div></div></body></html>`, "https://example.com/fallback");
  expect(fallback.text).not.toContain("Hidden contradictory guarantee");
  expect(fallback.text).toContain("Visible fallback caveat: no exactly-once guarantee.");
});

it("ignores invalid trailing visibility declarations and defines an unresolved-variable boundary", async () => {
  const hiddenStyles = [
    "display:none;display:not-a-display-value", "visibility:hidden;visibility:not-a-visibility-value",
    "content-visibility:hidden;content-visibility:not-a-value", "display:none;display:none block",
    "display:none;display:block grid list-item", "display:none;display:invalid !important",
    "display:none!important;display:invalid!important", "visibility:hidden;visibility:invalid!important",
    "display:none;display:var(--unknown)", "visibility:hidden;visibility:var(--unknown)",
  ];
  const hiddenText = hiddenStyles.map((style) => `<p style="${style}">Hidden contradictory guarantee.</p>`).join("");
  const visibleStyles = ["display:none;display:inline flex", "display:none;display:block flow-root list-item", "display:none;display:inline-grid", "visibility:hidden;visibility:initial", "content-visibility:hidden;content-visibility:auto", "display:none!important;display:block!important"];
  const visibleText = visibleStyles.map((style, index) => `<p style="${style}">Visible caveat ${index}: duplicate delivery remains possible.</p>`).join("");
  const result = await extractHtml(`<html><body><section style="display:none;display:invalid"><main>${passage.repeat(3)}</main></section><main><p>${passage.repeat(3)}</p>${hiddenText}${visibleText}<p style="display:var(--unknown)">Unknown-only CSS remains observed text.</p></main></body></html>`, "https://example.com/static-visibility");
  expect(result.text).not.toContain("Hidden contradictory guarantee");
  visibleStyles.forEach((_, index) => expect(result.text).toContain(`Visible caveat ${index}: duplicate delivery remains possible.`));
  expect(result.text).toContain("Unknown-only CSS remains observed text.");
  expect(result.truncated).toBe(false);
});

it("retains an explicit truncation boundary instead of claiming a whole long document", async () => {
  const result = await extractHtml(`<html><body><article><h1>Long document</h1><p>${passage.repeat(700)}</p><p>Unseen tail</p></article></body></html>`, "https://example.com/paper/v1");
  expect(result.truncated).toBe(true);
  expect(result.text).toHaveLength(60000);
  expect(result.text).not.toContain("Unseen tail");
});

it("refuses excessive raw bytes, normalized bytes, elements and depth, then releases admission", async () => {
  await expect(extractHtml("é".repeat(1024 * 1024 + 1), "https://example.com")).rejects.toThrow();
  await expect(extractHtml(`<article>${"content ".repeat(70000)}</article>`, "https://example.com")).rejects.toThrow();
  await expect(extractHtml(`<main>${"<span>x</span>".repeat(20001)}</main>`, "https://example.com")).rejects.toThrow();
  await expect(extractHtml(`${"<div>".repeat(300)}${passage.repeat(3)}${"</div>".repeat(300)}`, "https://example.com")).rejects.toThrow();
  expect((await extractHtml(html, "https://example.com")).text).toContain(passage.trim());
}, 12000);

it("falls back to Mozilla Readability when no unique main/article exists", async () => {
  const result = await extractHtml(`<html><head><title>Fallback original</title><meta charset="utf-8"></head><body><div><h1>Fallback original</h1><p>${passage.repeat(15)}</p><p>Café &amp; tea: its limitations were not measured.<br>Neither was external accuracy.</p><pre>if x &lt; 3:\n  print("not guaranteed")\n\n  return</pre></div></body></html>`, "https://example.com/fallback");
  expect(result.title).toBe("Fallback original");
  expect(result.text).toContain(passage.trim());
  expect(result.text).toContain("Café & tea: its limitations were not measured.");
  expect(result.text).toContain("Neither was external accuracy.");
  expect(result.text).toContain('if x < 3:\n  print("not guaranteed")\n\n  return');
});
