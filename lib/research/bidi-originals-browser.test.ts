import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";

let browser: Browser, bundle: string, css: string;
const captures = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const originals = [
  { name: "unknown-arabic", host: "ltr", language: undefined, direction: "rtl", quoteDirection: "ltr",
    text: "ملخّص من المصادر: “Original source <literal> {count} 0.000001 USDC https://example.test/a?x=1” [S1].\n\n- دليل محفوظ [S1]\n\n`tx:0x1234?amount=0.000001`",
    quote: "“Original source <literal> {count} 0.000001 USDC https://example.test/a?x=1”" },
  { name: "english-arabic-original", host: "rtl", language: "en", direction: "ltr", quoteDirection: "rtl",
    text: "An English statement with the exact source: “النص العربي الأصلي <literal> {count}” [S1].\n\n`USDC 0.000001`",
    quote: "“النص العربي الأصلي <literal> {count}”" },
  { name: "russian-arabic-original", host: "rtl", language: "ru", direction: "ltr", quoteDirection: "rtl",
    text: "Исходная цитата: “المصدر الأصلي https://original.test/ DOI 10.1234/original” [S1].",
    quote: "“المصدر الأصلي https://original.test/ DOI 10.1234/original”" },
] satisfies Array<{ name: string; host: string; language: PresentationLanguage | undefined; direction: string; quoteDirection: string; text: string; quote: string }>;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AnswerMarkdown}from'./components/keryx/answer-markdown';
    const rows=${JSON.stringify(originals)};const before=JSON.stringify(rows);const index=Number(new URL(location.href).searchParams.get('case'));const row=rows[index];
    const fixture=window.bidiFixture={original:row.text,unchanged:()=>JSON.stringify(rows)===before,clicked:[],readOnly:true};
    const citations=[{marker:'S1',sourceId:'original-source',sourceName:'مصدر original {count}',itemTitle:'Original citation <literal> {count}',weight:1,amount:0}];
    document.documentElement.dir=row.host;
    createRoot(document.getElementById('root')).render(<><h1>Original reading fixture</h1><section data-reading="active"><AnswerMarkdown text={row.text} language={row.language} citations={citations} onCitationClick={(marker,trigger)=>fixture.clicked.push({marker,focused:document.activeElement===trigger})}/></section><section data-reading="compact"><AnswerMarkdown text={row.text} language={row.language} citations={citations}/></section></>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const paths = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  expect(paths.some(path => path.endsWith("components/keryx/answer-markdown.tsx"))).toBe(true);
  expect(paths.some(path => /(?:jsonwebtoken|lib\/db\/|lib\/payments\/)/u.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (captures) await mkdir(join(captures, "bidi-originals"), { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

it.each(originals.flatMap((row, index) => [320, 1366].map(width => ({ row, index, width }))))(
  "isolates the real $row.name original and citation controls at $width", async ({ row, index, width }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const requests: string[] = [], errors: string[] = [];
    try {
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://bidi-reading.test" || route.request().method() !== "GET") { requests.push(url.href); return route.abort(); }
        if (url.pathname === "/reading.css") return route.fulfill({ contentType: "text/css", body: css + "@font-face{font-family:BidiOriginals;src:url('/arabic.ttf')} :root{--font-spectral:BidiOriginals,serif}body{background:#f1e9d7;color:#1b1712}#root{max-width:1050px;margin:24px auto;padding:0 16px}section{margin:24px 0;padding:12px;border:1px solid #b6a887}" });
        if (url.pathname === "/arabic.ttf") return route.fulfill({ contentType: "font/ttf", body: await readFile("app/fonts/og/noto-sans-arabic-regular.ttf") });
        if (url.pathname !== "/") { requests.push(url.href); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/reading.css"></head><body><main id="root"></main></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto(`https://bidi-reading.test/?case=${index}`); await page.addScriptTag({ content: bundle });
      const reading = page.locator('[data-reading="active"] > div'); await reading.waitFor(); await page.evaluate(() => document.fonts.ready);
      expect(await reading.getAttribute("lang")).toBe(row.language ?? "und");
      expect(await reading.getAttribute("dir")).toBe(row.language ? "ltr" : "auto");
      expect(await reading.evaluate(element => getComputedStyle(element).direction)).toBe(row.direction);
      const quote = reading.locator('bdi[lang="und"][dir="auto"]');
      expect(await quote.textContent()).toBe(row.quote);
      expect(await quote.evaluate(element => getComputedStyle(element).direction)).toBe(row.quoteDirection);
      if (row.quote.includes("<literal> {count}")) {
        const literal = quote.locator('bdi[dir="ltr"]').filter({ hasText: "<literal> {count}" });
        expect(await literal.textContent()).toBe("<literal> {count}");
        expect(await literal.evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
      }
      const controls = reading.getByRole("button"); expect(await controls.count()).toBeGreaterThan(0);
      for (const control of await controls.all()) {
        expect(await control.getAttribute("dir")).toBe("ltr"); expect(await control.getAttribute("lang")).toBe("en");
        expect(await control.textContent()).toBe("[1]");
        expect(await control.getAttribute("aria-label")).toContain("Original citation <literal> {count}");
      }
      const reference = page.locator('[data-reading="compact"] span[lang="en"]');
      expect(await reference.first().getAttribute("dir")).toBe("ltr");
      for (const code of await reading.locator("code").all()) expect(await code.getAttribute("dir")).toBe("ltr");
      expect(await reading.locator("script").count()).toBe(0);
      expect(await page.locator("html").getAttribute("lang")).toBe("en");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const control = controls.first(); await control.focus(); await page.keyboard.press("Enter");
      expect(await page.evaluate(() => (window as unknown as { bidiFixture: { clicked: unknown[] } }).bidiFixture.clicked)).toEqual([{ marker: "S1", focused: true }]);
      expect(await page.evaluate(() => (window as unknown as { bidiFixture: { unchanged(): boolean; original: string } }).bidiFixture.unchanged())).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { bidiFixture: { original: string } }).bidiFixture.original)).toBe(row.text);
      if (captures) await page.screenshot({ path: join(captures, "bidi-originals", `${row.name}-${width}.png`), fullPage: true });
      expect(requests).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
