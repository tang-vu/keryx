import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
const { transport, UnsafeTargetError } = vi.hoisted(() => ({ transport: vi.fn(), UnsafeTargetError: class extends Error {} }));
vi.mock("../net/public-fetch", () => ({ fetchPublicBytes: transport, UnsafeTargetError }));
import { readArticle } from "./article-reader";
import { ARTICLE_ENCODINGS, encodedArticleBytes, encodedArticleText, utf8ArticleHtml, utf8ArticleText } from "../../test-support/article-encoding-fixtures";

interface Case { name: string; bytes: Buffer; charset?: string; text: string }
const cases: Case[] = ARTICLE_ENCODINGS.flatMap(fixture => [
  { name: `${fixture.name} HTTP`, bytes: encodedArticleBytes(fixture), charset: fixture.charset, text: encodedArticleText(fixture) },
  { name: `${fixture.name} HTML meta`, bytes: encodedArticleBytes(fixture, `<meta charset="${fixture.charset}">`), text: encodedArticleText(fixture) },
]);
cases.push({ name: "HTTP before conflicting meta", bytes: encodedArticleBytes(ARTICLE_ENCODINGS[0], '<meta charset="utf-8">'),
  charset: "windows-1252", text: encodedArticleText(ARTICLE_ENCODINGS[0]) });
cases.push({ name: "UTF8 BOM before conflicting labels", bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from(utf8ArticleHtml('<meta charset="shift_jis">'))]), charset: "windows-1252", text: utf8ArticleText });
for (const order of ["LE", "BE"]) {
  const bytes = Buffer.from(utf8ArticleHtml('<meta charset="gbk">'), "utf16le");
  if (order === "BE") bytes.swap16();
  cases.push({ name: `UTF16${order} BOM`, bytes: Buffer.concat([Buffer.from(order === "LE" ? [0xff, 0xfe] : [0xfe, 0xff]), bytes]),
    charset: "windows-1252", text: utf8ArticleText });
}
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

it.each(cases)("matches Chromium's actual publisher text: $name", async fixture => {
  const context = await browser.newContext();
  const errors: string[] = [], requests: string[] = [];
  const url = "https://article-encoding.test/original";
  try {
    await context.route("**/*", route => {
      requests.push(route.request().url());
      return route.request().url() === url ? route.fulfill({ status: 200,
        headers: { "content-type": `text/html${fixture.charset ? `; charset=${fixture.charset}` : ""}` }, body: fixture.bytes }) : route.abort();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    const visible = (await page.locator("main").textContent())!.trim();
    expect(visible).toBe(fixture.text);
    transport.mockResolvedValueOnce({ bytes: fixture.bytes, contentType: "text/html", finalUrl: url, charset: fixture.charset });
    const result = await readArticle(url);
    expect(result.text).toBe(visible); expect(result.truncated).toBe(false);
    expect(errors).toEqual([]); expect(requests.every(request => request.startsWith("https://article-encoding.test/"))).toBe(true);
  } finally { await context.close(); }
});
