import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { PAPER_CATALOG } from "../papers/catalog";
import { PAPER_REPOSITORIES, paperRecordSchema } from "../papers/types";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, literatureComparisonDraft, saveLiteraturePaper, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { createMessages, englishMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { type UiLocale } from "../i18n/locales";
import { literatureSearchCopy } from "../../locales/en/literature-search";
import { previewCopy } from "../i18n/ui-preview";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const repositories = ["arxiv", "openreview", "pmlr", "acl-anthology", "crossref"] as const;
const states = ["unscreened", "include", "exclude", "undecided", "unscreened"] as const;
const titles = [englishMessages["literatureComparison.remove"], "Original OpenReview {repository}", "Original PMLR <script>literal</script>", "原始 ACL العربية", "Synthetic Crossref comparison fixture"];
const focus = englishMessages["literatureComparison.title"] + "\nOriginal العربية 日本語 <script>literal</script> {number}";
// Synthetic Crossref metadata exercises its supported display without network access or an invented observed record.
const crossref = paperRecordSchema.parse({ title: titles[4], authors: ["Synthetic author"], authorCount: 1, authorsTruncated: false,
  repository: "crossref", doi: "10.5555/keryx-comparison-fixture", url: "https://doi.org/10.5555/keryx-comparison-fixture",
  metadataUrl: "https://api.crossref.org/works/10.5555%2Fkeryx-comparison-fixture", metadataObservedAt: "2026-11-01T00:00:00Z",
  publicationKind: "unknown", peerReview: "unknown" });
function workspace() {
  let value = emptyLiteratureWorkspace(); value.title = englishMessages["literatureComparison.title"]; value.question = focus;
  for (const [index, repository] of repositories.entries()) {
    const original = repository === "crossref" ? crossref : PAPER_CATALOG.find(paper => paper.repository === repository);
    if (!original) throw new Error(`Missing repository fixture: ${repository}`);
    value = saveLiteraturePaper(value, { ...original, title: titles[index] }, "2026-11-01T00:00:00Z");
    value.entries[index].screening = states[index]; value.entries[index].notes = `Exact saved note ${index} العربية <literal> {screening}`;
  }
  return value;
}
type Fixture = { writes: number; locale(value: UiLocale): Promise<void> };
let browser: Browser, bundle: string, css: string;
const captures = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const fonts = `@font-face{font-family:WorkspaceDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:WorkspaceSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:WorkspaceMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:WorkspaceDisplay;--font-spectral:WorkspaceSerif;--font-spline-mono:WorkspaceMono}`;
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    import{createMessages}from'./lib/i18n/messages';import{createRichMessages}from'./lib/i18n/rich-messages';
    const f=window.comparisonFixture={writes:0};const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(...args){f.writes++;return original.apply(this,args)};
    function App(){const[copy,setCopy]=useState(englishUiCopy);f.locale=async locale=>{const preview=await loadUiPreview(locale);
      document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
      setCopy({locale,preview,message:createMessages(locale,preview.$messages),richMessage:createRichMessages(locale,preview.$messages)})};
      return <UiCopyContext.Provider value={copy}><main style={{maxWidth:1120,margin:'24px auto',padding:'0 16px'}}><LiteratureWorkspace/></main></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    plugins: [{ name: "plain-next-link-only", setup(api) {
      api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "comparison-link" }));
      api.onLoad({ filter: /.*/, namespace: "comparison-link" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        "import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" }));
    } }] });
  for (const path of ["components/keryx/literature-comparison-preview.tsx", "lib/papers/literature-browser-store.ts", "lib/i18n/ui-copy.tsx", "lib/i18n/rich-messages.tsx"])
    expect(Object.keys(result.metafile!.inputs).some(input => input.replaceAll("\\", "/").endsWith(path))).toBe(true);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (captures) await mkdir(captures, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function locale(page: Page, value: UiLocale) {
  await page.evaluate(value => (window as unknown as { comparisonFixture: Fixture }).comparisonFixture.locale(value), value);
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(value);
}
async function fits(locator: Locator) {
  expect(await locator.evaluateAll(elements => elements.every(element => {
    const bounds = element.getBoundingClientRect(); if (!bounds.width || !bounds.height) return true;
    const range = document.createRange(); range.selectNodeContents(element);
    return Array.from(range.getClientRects()).every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1);
  })), "Complete authored comparison text must fit its visible bounds").toBe(true);
}
async function capture(locator: Locator, name: string) {
  if (!captures) return;
  await locator.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
  await locator.screenshot({ path: join(captures, name + ".png"), animations: "disabled" });
}

it.each([...locales.flatMap(locale => [320, 1366].map(width => ({ locale, width, font: 16 }))),
  { locale: "ar" as const, width: 390, font: 16 }, ...(["pt-BR", "ru", "ar"] as const).map(locale => ({ locale, width: 320, font: 32 }))])(
  "keeps $locale comparison metadata, original data and selection-only removal at $width with $font px text", async ({ locale: language, width, font }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://comparison-world.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
        if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"></head><body><div id="root"></div></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://comparison-world.test/"); const original = workspace(), raw = serializeLiteratureWorkspace(original);
      await page.evaluate(({ key, raw, font }) => { localStorage.setItem(key, raw); document.documentElement.style.fontSize = `${font}px`; }, { key: LITERATURE_STORAGE_KEY, raw, font });
      await page.addScriptTag({ content: bundle }); await page.getByLabel(englishMessages["literatureWorkspace.titleLabel"], { exact: true }).waitFor();
      await locale(page, language);
      const preview = await loadUiPreview(language), copy = createMessages(language, preview.$messages), searchCopy = previewCopy(preview, "literature-search", literatureSearchCopy);
      const search = page.getByRole("searchbox", { name: searchCopy.label, exact: true }); await search.waitFor();
      const filter = page.getByRole("combobox", { name: copy("literatureWorkspace.filter"), exact: true });
      const comparison = page.getByRole("region", { name: copy("literatureComparison.label"), exact: true });
      const prefix = `literature-comparison-${language}-${width}-font${font}`;
      for (const [cycle, indices] of [[0, 3], [1, 2], [4, 0]].entries()) {
        for (const index of indices) await page.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: titles[index] }), exact: true }).check();
        await filter.selectOption("undecided"); await search.fill("NO_MATCH original query {number}");
        await comparison.waitFor(); expect(await page.locator("article:visible").count()).toBe(0);
        expect(await comparison.getByRole("link").allTextContents()).toEqual(indices.map(index => titles[index]));
        expect(await comparison.getByText(copy("literatureComparison.outsideFilter"), { exact: true }).count()).toBe(indices.filter(index => states[index] !== "undecided").length);
        expect(await comparison.getByText(searchCopy.outsideSearch, { exact: true }).count()).toBe(2);
        for (const [position, index] of indices.entries()) {
          const item = comparison.locator("li").nth(position), metadata = item.locator("p").first(), paper = original.entries[index].paper;
          expect(await metadata.textContent()).toBe(copy("literatureComparison.paper", { number: position + 1,
            screening: copy(`paperWorkspace.screening.${states[index]}`), repository: PAPER_REPOSITORIES[repositories[index]] }));
          expect(await metadata.locator(":scope > span").getAttribute("lang")).toBe(language);
          if (language === "ar") expect(await metadata.locator(":scope > span").getAttribute("dir")).toBe("rtl");
          const identity = metadata.locator("bdi"); expect(await identity.textContent()).toBe(PAPER_REPOSITORIES[repositories[index]]);
          expect(await identity.getAttribute("lang")).toBe("en"); expect(await identity.getAttribute("dir")).toBe("ltr");
          expect(await item.getByRole("link").getAttribute("href")).toBe(paper.url);
          expect(await item.getByRole("link").getAttribute("dir")).toBe("auto");
          expect(await item.getByText(paper.url, { exact: true }).getAttribute("dir")).toBe("ltr");
          if (paper.arxivId) {
            const identifier = item.getByText(`arXiv ${paper.arxivId}`, { exact: true });
            expect(await identifier.getAttribute("lang")).toBe("en"); expect(await identifier.getAttribute("dir")).toBe("ltr");
          }
        }
        const focusText = comparison.locator("p").filter({ hasText: focus }).last(); expect(await focusText.textContent()).toBe(focus);
        expect(await focusText.getAttribute("dir")).toBe("auto");
        await comparison.locator("summary").click(); const prepared = comparison.locator("pre");
        expect(await prepared.textContent()).toBe(literatureComparisonDraft(original, indices.map(index => original.entries[index].paper.url)));
        expect(await prepared.getAttribute("dir")).toBe("auto");
        expect(await prepared.getAttribute("aria-labelledby")).toBeTruthy();
        expect(await page.locator(`[id="${await prepared.getAttribute("aria-labelledby")}"]`).textContent()).toBe(copy("literatureComparison.preparedQuestion"));
        await fits(comparison.locator("h3, button, summary"));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (cycle === 0 && (font === 32 || width === 390)) await capture(prepared, `${prefix}-prepared`);
        await comparison.locator("summary").click();
        if (cycle === 0) {
          await locale(page, "en"); const english = page.getByRole("region", { name: englishMessages["literatureComparison.label"], exact: true }); await english.waitFor();
          expect(await english.getByRole("link").allTextContents()).toEqual(indices.map(index => titles[index]));
          await locale(page, language); await comparison.waitFor();
          expect(await search.inputValue()).toBe("NO_MATCH original query {number}"); await capture(comparison, `${prefix}-selection`);
        }
        await comparison.getByRole("button", { name: copy("literatureComparison.removeLabel", { number: 1 }), exact: true }).click();
        expect(await comparison.getByRole("link").allTextContents()).toEqual([titles[indices[1]]]); expect(await comparison.locator("pre").count()).toBe(0);
        if (cycle === 0) await capture(comparison, `${prefix}-remaining`);
        expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
        await comparison.getByRole("button", { name: copy("literatureComparison.removeLabel", { number: 1 }), exact: true }).click();
        expect(await comparison.count()).toBe(0); await search.fill(""); await filter.selectOption("all");
        await expect.poll(() => page.locator("article h2").allTextContents()).toEqual(titles);
        for (const index of indices) expect(await page.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: titles[index] }), exact: true }).isChecked()).toBe(false);
      }
      expect(await page.getByRole("textbox", { name: copy("literatureWorkspace.questionLabel"), exact: true }).inputValue()).toBe(focus);
      expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
      expect(await page.evaluate(() => (window as unknown as { comparisonFixture: Fixture }).comparisonFixture.writes)).toBe(0);
      expect(await page.locator("script:not([src])").count()).toBe(1); expect(await page.locator("source").count()).toBe(0);
      expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    } finally { await context.close(); }
  }, 30_000);
