import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let browser: Browser;
let bundle: string;
let styledBundle: string;
let css: string;

beforeAll(async () => {
  bundle = (await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ArchiveSearch} from './components/keryx/archive-search';
      const others=Array.from({length:53},(_,i)=>({id:'report-'+i,
        question:'Báo cáo đám mây '+i,sources:'Circle Arc USDC'}));
      const root=createRoot(document.getElementById('root'));
      window.renderArchive=(count=53)=>root.render(<ArchiveSearch
        terms={['Đánh giá đám mây Circle','Unrelated question Other publisher']}
        others={others.slice(0,count)}>
        <article>Đánh giá đám mây</article><article>Unrelated question</article>
      </ArchiveSearch>);
      window.renderArchive();
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "archive-link-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        loader: "jsx", resolveDir: process.cwd(), contents: "export default function Link(props){return <a {...props}/>}",
      }));
    } }],
  })).outputFiles[0].text;
  styledBundle = (await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import{ArchiveIndexView}from'./components/keryx/archive-index-view';
      const entries=[{id:'sqlite',question:'How do SQLite WAL and rollback journals compare?',
        answerSnippet:'WAL appends changes to a separate log. The recorded source excerpts explain concurrency and checkpoint tradeoffs.',
        citationCount:3,toCreators:.000001,totalSpent:.000001,sourceNames:['SQLite documentation','Systems research'],
        createdAt:'2026-10-08T00:00:00.000Z',confidence:{level:'Low',reason:'Local fixture: evidence has gaps.'}},
        {id:'unicode',question:'Nghiên cứu dữ liệu · '+ 'https://example.org/'.repeat(12),
        answerSnippet:'A complete retained excerpt with https://example.org/'+'x'.repeat(240),
        citationCount:1,toCreators:0,totalSpent:0,sourceNames:['Publisher'+'x'.repeat(240)],
        createdAt:'2026-10-07T00:00:00.000Z',confidence:null}];
      const topics=['SQLite','research','agents','evidence','sources','Unicode','systems'].map((label,i)=>({slug:'topic-'+i,label,count:i+1}));
      createRoot(document.getElementById('root')).render(<ArchiveIndexView slice={{items:entries,rest:[],page:2,totalPages:12}} topics={topics} totalEntries={72}/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "styled-archive-links", setup(plugin) {
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        loader: "jsx", resolveDir: process.cwd(), contents: "export default function Link(props){return <a {...props}/>}",
      }));
    } }],
  })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"),
    { from: path.resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => { await browser?.close(); });

it.each([320, 1366])("finds and opens every off-page match at %ipx", async (width) => {
  const context = await browser.newContext({ viewport: { width, height: 768 } });
  try {
    const requests: string[] = [];
    await context.route("**/*", (route) => {
      requests.push(route.request().url());
      return route.request().url() === "https://archive.test/"
        ? route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' })
        : route.abort();
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("https://archive.test/");
    await page.addScriptTag({ content: bundle });
    const search = page.getByRole("searchbox", { name: "Filter answers" });
    await search.waitFor({ timeout: 5_000 }).catch((error) => {
      throw new Error(`${pageErrors.join("; ")}: ${error.message}`);
    });
    expect(await page.locator("article:visible").count()).toBe(2);
    expect(await page.getByRole("link").count()).toBe(0);

    await search.fill("  circle   may dam  ");
    await page.getByRole("status").filter({ hasText: "54 found" }).waitFor();
    expect(await page.locator("article:visible").allTextContents()).toEqual(["Đánh giá đám mây"]);
    const navigation = page.getByRole("navigation", { name: "Elsewhere in the archive · 53" });
    const newer = navigation.getByRole("button", { name: "← Newer" });
    const older = navigation.getByRole("button", { name: "Older →" });
    expect(await newer.isDisabled()).toBe(true);
    const seen: string[] = [];
    for (let index = 0; index < 3; index++) {
      const links = page.getByRole("link");
      expect(await links.count()).toBe(index === 2 ? 3 : 25);
      seen.push(...await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!)));
      if (index < 2) await older.click();
    }
    expect(seen).toEqual(Array.from({ length: 53 }, (_, i) => `/dispatch/report-${i}`));
    expect(await older.isDisabled()).toBe(true);
    await newer.click();
    expect(await page.getByRole("link").first().textContent()).toBe("Báo cáo đám mây 25");

    // A new query always starts at the first result page, including source-only matches.
    await search.fill("usdc");
    await page.getByRole("status").filter({ hasText: "53 found" }).waitFor();
    expect(await page.locator("article:visible").count()).toBe(0);
    expect(await page.getByRole("link").first().getAttribute("href")).toBe("/dispatch/report-0");
    await older.click();
    // Data can shrink during navigation without leaving the search on a nonexistent page.
    await page.evaluate(() => (window as unknown as { renderArchive(count: number): void }).renderArchive(1));
    await page.getByRole("status").filter({ hasText: "1 found" }).waitFor();
    expect(await page.getByRole("link").count()).toBe(1);

    await search.fill("no such answer");
    await page.getByRole("status").filter({ hasText: "0 found" }).waitFor();
    expect(await page.getByText(/No answer in the archive matches/).count()).toBe(1);
    await page.getByRole("button", { name: "Clear search" }).click();
    expect(await search.inputValue()).toBe("");
    expect(await search.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.locator("article:visible").count()).toBe(2);
    await search.fill("circle");
    await search.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    expect(await search.inputValue()).toBe("circle");
    await search.press("Escape");
    expect(await search.inputValue()).toBe("");
    expect(await page.locator("article:visible").count()).toBe(2);
    await search.fill(" \t ");
    expect(await page.locator("article:visible").count()).toBe(2);
    expect(await page.getByRole("link").count()).toBe(0);
    expect(await page.getByRole("button").count()).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(requests).toEqual(["https://archive.test/"]);
  } finally {
    await context.close();
  }
});

it.each([320, 390, 768, 1440])("keeps the authored archive readable and operable at %ipx", async width => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const errors: string[] = [];
  const fonts = "@font-face{font-family:ArchiveDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:ArchiveSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:ArchiveMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:ArchiveDisplay;--font-spectral:ArchiveSerif;--font-spline-mono:ArchiveMono}";
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      expect(url.origin).toBe("https://archive-design.test");
      expect(request.method()).toBe("GET");
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(path.join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + fonts + '</style></head><body class="bg-paper-2"><div id="root"></div></body></html>' });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://archive-design.test/");
    await page.addScriptTag({ content: styledBundle });
    const search = page.getByRole("searchbox", { name: "Filter answers" });
    await search.waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.locator("article").count()).toBe(2);
    expect(await page.locator('article a[href="/dispatch/sqlite"]').count()).toBe(1);
    expect(await page.locator("article").first().textContent()).toContain("$0.000001");
    expect(await page.locator("article").last().textContent()).toContain("x".repeat(240));
    expect((await page.locator("article").first().boundingBox())!.y).toBeLessThan(900);
    for (const target of await page.locator("main nav a:visible").all()) {
      const bounds = await target.boundingBox();
      expect(bounds!.height, await target.textContent() ?? undefined).toBeGreaterThanOrEqual(44);
    }
    if (width < 640) expect(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await search.focus();
    expect(await search.evaluate(element => getComputedStyle(element.closest("label")!.parentElement!).outlineStyle)).toBe("solid");
    await search.fill("no result fixture");
    await page.getByRole("status").filter({ hasText: "0 found" }).waitFor();
    const clear = page.getByRole("button", { name: "Clear search" });
    expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await clear.click();
    expect(await search.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.locator("article:visible").count()).toBe(2);
    const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await page.screenshot({ path: path.join(screenshots, "archive-" + width + ".png"), fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
}, 30_000);
