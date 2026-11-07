import { beforeEach, expect, it, vi } from "vitest";
const { transport, UnsafeTargetError } = vi.hoisted(() => ({ transport: vi.fn(), UnsafeTargetError: class extends Error {} }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: transport, UnsafeTargetError }));
import { readArticle, gatheredArticle, articleExtractionDiagnostic } from "./article-reader";
import { decodeArticleText } from "./article-encoding";
import { ARTICLE_ENCODINGS, encodedArticleBytes, encodedArticleText, utf8ArticleHtml, utf8ArticleText } from "../../test-support/article-encoding-fixtures";

beforeEach(() => { transport.mockReset(); });
const url = "https://publisher.example/original";
async function article(bytes: Uint8Array, charset?: string, contentType = "text/html") {
  transport.mockResolvedValueOnce({ bytes, contentType, finalUrl: url, ...(charset === undefined ? {} : { charset }) });
  return readArticle(url);
}

it("preserves publisher characters from a declared Windows-1252 article instead of UTF8 replacement text", async () => {
  const finalUrl = "https://publisher.example/cafe";
  const bytes = Buffer.from('<html><head><title>Caf\xe9</title></head><body><main><p>' +
    'Le caf\xe9 co\xfbte 12 \x80; S\xe3o Paulo conserve les conditions de cette offre. '.repeat(5) +
    '</p></main></body></html>', "latin1");
  transport.mockResolvedValueOnce({ bytes, contentType: "text/html", charset: "windows-1252", finalUrl });
  const article = await readArticle(finalUrl);
  expect(article.title).toBe("Café");
  expect(article.text).toContain("Le café coûte 12 €; São Paulo");
  expect(article.text).not.toContain("\uFFFD");
  expect(gatheredArticle("public:encoding", article).text).toBe(article.text);
});

it.each(ARTICLE_ENCODINGS)("preserves the exact $name original through extraction and provenance", async fixture => {
  const result = await article(encodedArticleBytes(fixture), fixture.charset);
  expect(result).toMatchObject({ title: fixture.text, text: encodedArticleText(fixture), kind: "html", finalUrl: url, truncated: false });
  expect(result.text).not.toContain("\uFFFD");
  expect(gatheredArticle("public:encoding", result)).toMatchObject({ itemUrl: url, text: result.text,
    webProvenance: { extraction: "html", truncated: false } });
});

it.each(ARTICLE_ENCODINGS)("observes an early $name HTML meta declaration when HTTP has no valid label", async fixture => {
  const result = await article(encodedArticleBytes(fixture, `<meta charset="${fixture.charset}">`), "not-an-encoding");
  expect(result).toMatchObject({ title: fixture.text, text: encodedArticleText(fixture), truncated: false });
});

it.each([
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=shift_jis">',
  '<meta content="text/html; charset=\'shift_jis\'" http-equiv="content-type">',
])("observes the HTML pragma form without a custom markup parser: %s", async meta => {
  const fixture = ARTICLE_ENCODINGS[2];
  expect((await article(encodedArticleBytes(fixture, meta))).text).toBe(encodedArticleText(fixture));
});

it("keeps the terminal HTTP declaration ahead of conflicting HTML metadata", async () => {
  const fixture = ARTICLE_ENCODINGS[0];
  expect((await article(encodedArticleBytes(fixture, '<meta charset="utf-8">'), "windows-1252")).text).toBe(encodedArticleText(fixture));
});

it("gives a UTF8 BOM precedence over conflicting HTTP and HTML labels", async () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(utf8ArticleHtml('<meta charset="shift_jis">'))]);
  expect((await article(bytes, "windows-1252")).text).toBe(utf8ArticleText);
});

it.each(["LE", "BE"] as const)("decodes a UTF16%s BOM before the original HTML worker", async order => {
  const bytes = Buffer.from(utf8ArticleHtml('<meta charset="gbk">'), "utf16le");
  if (order === "BE") bytes.swap16();
  const bom = Buffer.from(order === "LE" ? [0xff, 0xfe] : [0xfe, 0xff]);
  expect((await article(Buffer.concat([bom, bytes]), "windows-1252")).text).toBe(utf8ArticleText);
});

it.each([
  { name: "absent", head: "" },
  { name: "unsupported label", head: '<meta charset="not-an-encoding">' },
  { name: "comment", head: '<!-- <meta charset="windows-1252"> -->' },
  { name: "attribute text", head: '<meta name="description" content="<meta charset=windows-1252>">' },
  { name: "different tag", head: '<metadata charset="windows-1252"></metadata>' },
  { name: "past the prescan bound", head: '<!--' + "a".repeat(1024) + '--><meta charset="windows-1252">' },
])("retains the existing UTF8 fallback: $name", async ({ head }) => {
  expect((await article(Buffer.from(utf8ArticleHtml(head)))).text).toBe(utf8ArticleText);
});

it("treats HTML meta UTF16 labels as UTF8 per the HTML prescan rule", async () => {
  expect((await article(Buffer.from(utf8ArticleHtml('<meta charset="utf-16le">')))).text).toBe(utf8ArticleText);
});

it.each(["text/plain", "text/markdown", "application/xhtml+xml"])("does not interpret HTML metadata in %s bytes", contentType => {
  const text = '<meta charset="windows-1252">' + utf8ArticleText;
  expect(decodeArticleText(Buffer.from(text), contentType)).toBe(text);
});

it.each(["text/plain", "text/markdown"])("honors HTTP text charset without treating %s as HTML", async contentType => {
  const fixture = ARTICLE_ENCODINGS[0], prefix = '<meta charset="utf-8">';
  const result = await article(Buffer.concat([Buffer.from(prefix), Buffer.from(fixture.hex, "hex")]), "iso-8859-1", contentType);
  expect(result).toMatchObject({ kind: "text", text: prefix + fixture.text, finalUrl: url, truncated: false });
});

it.each(["text/plain", "text/markdown"])("preserves the existing raw byte refusal for %s", async contentType => {
  await expect(article(Buffer.alloc(500_001, 0xe9), "windows-1252", contentType)).rejects.toMatchObject({ code: "article-byte-limit" });
});

it("does not enlarge the HTML worker input bound when legacy text expands in UTF8", async () => {
  const bytes = Buffer.concat([Buffer.from("<html><body><main><p>"), Buffer.alloc(1_100_000, 0xe9), Buffer.from("</p></main></body></html>")]);
  let failure: unknown;
  try { await article(bytes, "windows-1252"); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "html-extraction-unavailable" });
  expect(articleExtractionDiagnostic(failure)).toEqual({ format: "html", reason: "input-rejected" });
});

it("keeps the complete Unicode prefix at the original plain-text character cap", async () => {
  const prefix = "a".repeat(59_999);
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(prefix + "🧾tail", "utf16le")]);
  expect(await article(bytes, undefined, "text/plain")).toMatchObject({ text: prefix, truncated: true });
});
