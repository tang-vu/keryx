import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractHtml } from "./html-reader";
import { gatheredArticle } from "./article-reader";

const introduction = "The document describes a bounded reading procedure. Its examples do not establish independent factual correctness. ";
const caveat = "A completed read does not establish that every requested question was answered.";
const content = `<h1>Reading contract</h1><p>${introduction.repeat(8)}</p><p>${caveat}</p>`;
const document = (body: string) => `<html><head><title>Reading contract</title></head><body>${body}</body></html>`;

it.each(["@click", "@click.outside", ":class", "[class.active]", "(click)", "dữ-liệu"])(
  "reads the same static text when HTML uses the attribute %s", async name => {
    const plain = await extractHtml(document(`<main>${content}</main>`), "https://example.org/manual/v2");
    const decorated = await extractHtml(document(`<nav ${name}="process.exit(7)">Navigation only.</nav><main ${name}="'not source evidence'">${content}</main>`), "https://example.org/manual/v2");
    expect(decorated.text).toBe(plain.text);
    expect(decorated.title).toBe(plain.title);
    expect(decorated.htmlTextLayout).toEqual(plain.htmlTextLayout);
    expect(decorated.truncated).toBe(false);
    expect(decorated.text).not.toMatch(/process.exit|not source evidence|Navigation only/);
    const gathered = gatheredArticle("public:web:fixture", decorated);
    expect(gathered.contentVersion).toBe(gatheredArticle("public:web:fixture", plain).contentVersion);
    expect(gathered.webProvenance).toMatchObject({ extraction: "html", truncated: false });
  },
);

it.each(["article", "fallback"])("keeps caveats in the %s extraction path despite event shorthand", async kind => {
  const body = kind === "article" ? `<article @click="neverExecute()">${content}</article>`
    : `<div class="article" @click="neverExecute()">${content}<p>${introduction.repeat(8)}</p></div>`;
  const result = await extractHtml(document(body), "https://example.org/reference");
  expect(result.text).toContain(caveat);
  expect(result.text).not.toContain("neverExecute");
  expect(result.title).toBe("Reading contract");
});

it("retains code, table order and visibility boundaries from the original HTML tree", async () => {
  const source = document(`<main @click="process.exit(7)">${content}
    <p hidden @click="ignored()">Hidden false guarantee.</p>
    <p aria-hidden="true" [class.active]="true">Hidden false guarantee.</p>
    <section style="display:none" @click="ignored()"><p>Hidden false guarantee.</p></section>
    <section style="visibility:hidden" @click="ignored()">Hidden false guarantee.<p style="visibility:visible">Visible recovery qualification.</p></section>
    <script>process.exit(7)</script><template><p>Hidden false guarantee.</p></template>
    <table [class.active]="true"><tr><th>Setting</th><th>Limit</th></tr><tr><td>Quick</td><td>Bounded reads</td></tr></table>
    <pre @click="ignored()">if x &lt; 3:\n  print("not guaranteed")</pre></main>`);
  const result = await extractHtml(source, "https://example.org/contract");
  expect(result.text).toContain("Visible recovery qualification.");
  expect(result.text).toContain("Setting | Limit |");
  expect(result.text).toContain("Quick | Bounded reads |");
  const code = 'if x < 3:\n  print("not guaranteed")';
  expect(result.text).toContain(code);
  expect(result.htmlTextLayout?.preformatted.some(({ start, end }) => result.text.slice(start, end).includes(code))).toBe(true);
  expect(result.text).not.toMatch(/Hidden false guarantee|process.exit|ignored/);
});

it("keeps the raw input, normalized markup and minimum text bounds", async () => {
  await expect(extractHtml('<main @click="ignored()">tiny</main>', "https://example.org/empty")).rejects.toThrow();
  await expect(extractHtml(`<main @click="${"x".repeat(2 * 1024 * 1024)}">${content}</main>`, "https://example.org/raw-limit")).rejects.toThrow();
  await expect(extractHtml(`<main @click="ignored()" data-payload="${"x".repeat(500001)}">${content}</main>`, "https://example.org/normalized-limit")).rejects.toThrow();
  expect((await extractHtml(document(`<main @click="ignored()">${content}</main>`), "https://example.org/recovery")).text).toContain(caveat);
});

it("retains the text cap and truncation provenance", async () => {
  const result = await extractHtml(document(`<main @click="ignored()"><p>${introduction.repeat(700)}</p></main>`), "https://example.org/long");
  expect(result.text).toHaveLength(60000);
  expect(result.truncated).toBe(true);
  expect(gatheredArticle("public:web:long", result).webProvenance?.truncated).toBe(true);
});

it("retains the exact requested heading span and whole-document identity", async () => {
  const selected = `<h2 id="limits" @click="ignored()">Reading limits</h2><p>${introduction.repeat(4)}</p><p>${caveat}</p>`;
  const source = document(`<main @click="ignored()"><h1>Whole manual</h1><p>Outside introduction.</p>${selected}<h2>Other section</h2><p>Outside tail.</p></main>`);
  const result = await extractHtml(source, "https://example.org/manual/v2", undefined, "limits");
  expect(result.text).toContain(caveat);
  expect(result.text).not.toMatch(/Outside|Other section|ignored/);
  expect(result.truncated).toBe(true);
  const scope = result.htmlSectionScope!;
  expect(source.slice(scope.htmlStart, scope.htmlEnd)).toBe(selected);
  expect(scope.documentSha256).toBe(createHash("sha256").update(source).digest("hex"));
  expect(gatheredArticle("public:web:section", result).webProvenance?.htmlSectionScope).toEqual(scope);
});
