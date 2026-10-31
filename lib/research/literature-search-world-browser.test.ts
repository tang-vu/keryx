import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { PAPER_CATALOG } from "../papers/catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, literatureScreeningCsv, parseLiteratureWorkspace,
  saveLiteraturePaper, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { paperReferencesCslJson, paperReferencesRis } from "../papers/reference-export";
import { LITERATURE_SORTS } from "../papers/literature-sort";
import { createMessages, englishMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { previewCopy } from "../i18n/ui-preview";
import { type UiLocale } from "../i18n/locales";
import { literatureSearchCopy as searchEnglish } from "../../locales/en/literature-search";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const titles = ["Title", "Zeta 10", "Alpha 2", "Alpha 10"];
const notes = ["ONLY_NOTE العربية <script>literal</script> {count}", "café dossier", "ONLY_NOTE other", "unchanged note"];
function workspace() {
  let value = emptyLiteratureWorkspace(); value.title = searchEnglish.label; value.question = "Original question 日本語 العربية {count}";
  for (let index = 0; index < 4; index++) {
    value = saveLiteraturePaper(value, { ...PAPER_CATALOG[index], title: titles[index], authors: ["Original author"],
      authorCount: 1, authorsTruncated: false, publishedYear: [2020, undefined, 2024, 2024][index] }, `2026-10-0${index + 1}T00:00:00Z`);
    value.entries[index].screening = (["include", "exclude", "include", "undecided"] as const)[index]; value.entries[index].notes = notes[index];
  }
  return value;
}

type Fixture = { locale(value: UiLocale): Promise<void>; writes: number; downloads: Array<{ name: string; text: string; type: string }> };
let browser: Browser, bundle: string, css: string;
const captures = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const fonts = `@font-face{font-family:WorkspaceDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:WorkspaceSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:WorkspaceMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:WorkspaceDisplay;--font-spectral:WorkspaceSerif;--font-spline-mono:WorkspaceMono}`;
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    import{createMessages}from'./lib/i18n/messages';import{createRichMessages}from'./lib/i18n/rich-messages';
    const f=window.workspaceFixture={writes:0,downloads:[]};const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(...args){f.writes++;return original.apply(this,args)};
    const blobs=new Map();let sequence=0;URL.createObjectURL=blob=>{const id='blob:workspace/'+(++sequence);blobs.set(id,blob);return id};
    URL.revokeObjectURL=id=>blobs.delete(id);HTMLAnchorElement.prototype.click=function(){const blob=blobs.get(this.href),entry={name:this.download,text:'',type:blob.type};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};
    function App(){const[copy,setCopy]=useState(englishUiCopy);f.locale=async locale=>{const preview=await loadUiPreview(locale);
      document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';
      setCopy({locale,preview,message:createMessages(locale,preview.$messages),richMessage:createRichMessages(locale,preview.$messages)})};
      return <UiCopyContext.Provider value={copy}><main style={{maxWidth:1120,margin:'24px auto',padding:'0 16px'}}><LiteratureWorkspace/></main></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, metafile: true,
    platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    plugins: [{ name: "plain-next-link-only", setup(api) {
      api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "workspace-link" }));
      api.onLoad({ filter: /.*/, namespace: "workspace-link" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        "import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" }));
    } }] });
  for (const path of ["components/keryx/literature-workspace.tsx", "lib/papers/literature-browser-store.ts", "lib/i18n/ui-copy.tsx", "lib/papers/literature-search.ts", "lib/papers/literature-sort.ts"])
    expect(Object.keys(result.metafile!.inputs).some(input => input.replaceAll("\\", "/").endsWith(path))).toBe(true);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (captures) await mkdir(captures, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const fixture = (page: Page) => page.evaluate(() => (window as unknown as { workspaceFixture: Fixture }).workspaceFixture);
const saved = async (page: Page) => parseLiteratureWorkspace((await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY))!);
async function locale(page: Page, value: UiLocale) {
  await page.evaluate(value => (window as unknown as { workspaceFixture: Fixture }).workspaceFixture.locale(value), value);
  await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(value);
}
async function fits(locator: Locator) {
  expect(await locator.evaluateAll(elements => elements.every(element => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return true;
    const range = document.createRange(); range.selectNodeContents(element);
    return Array.from(range.getClientRects()).every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1 && rect.top >= bounds.top - 1);
  })), "Authored labels must fit their visible controls").toBe(true);
}
async function capture(locator: Locator, name: string) {
  if (!captures) return;
  await locator.evaluate(async () => { await document.fonts.ready; await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
  await locator.screenshot({ path: join(captures, name + ".png"), animations: "disabled" });
}

it.each([...locales.flatMap(locale => [320, 1366].map(width => ({ locale, width, font: 16 }))),
  { locale: "ar" as const, width: 390, font: 16 },
  ...(["pt-BR", "ru", "ar"] as const).map(locale => ({ locale, width: 320, font: 32 }))])(
  "keeps $locale search/sort controls and exact data/export order at $width with $font px text", async ({ locale: language, width, font }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://workspace-world.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/workspace.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
        if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname)) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"></head><body><div id="root"></div></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://workspace-world.test/"); const original = workspace(), raw = serializeLiteratureWorkspace(original);
      await page.evaluate(({ key, raw, font }) => { localStorage.setItem(key, raw); document.documentElement.style.fontSize = `${font}px`; }, { key: LITERATURE_STORAGE_KEY, raw, font });
      await page.addScriptTag({ content: bundle }); await page.getByLabel(englishMessages["literatureWorkspace.titleLabel"], { exact: true }).waitFor();
      await locale(page, language);
      const preview = await loadUiPreview(language), copy = createMessages(language, preview.$messages), text = previewCopy(preview, "literature-search", searchEnglish);
      const search = page.getByRole("searchbox", { name: text.label, exact: true }); await search.waitFor();
      const sort = page.getByRole("combobox", { name: text.sortLabel, exact: true });
      const filter = page.getByRole("combobox", { name: copy("literatureWorkspace.filter"), exact: true });
      const options = sort.locator("option");
      expect(await options.allTextContents()).toEqual(LITERATURE_SORTS.map(mode => text.sorts[mode]));
      expect(await options.evaluateAll(items => items.map(item => (item as HTMLOptionElement).value))).toEqual([...LITERATURE_SORTS]);
      expect(await sort.locator('option[value="year"]').getAttribute("lang")).toBe("en");
      expect(await sort.locator('option[value="year"]').getAttribute("dir")).toBe("ltr");
      for (const mode of ["saved", "title", "recent"]) expect(await sort.locator(`option[value="${mode}"]`).getAttribute("lang")).toBeNull();
      for (const key of ["guidance", "scope", "sortNotice"] as const) {
        const fallback = page.getByText(searchEnglish[key], { exact: true }); expect(await fallback.count()).toBe(1);
        expect(await fallback.getAttribute("lang")).toBe("en");
        if (language === "ar") expect(await fallback.getAttribute("dir")).toBe("ltr");
      }
      const describedBy = await search.getAttribute("aria-describedby"); expect(describedBy).toBeTruthy();
      expect(await page.locator(`[id="${describedBy}"]`).textContent()).toBe(searchEnglish.guidance);
      expect(await page.getByLabel(copy("literatureWorkspace.titleLabel"), { exact: true }).inputValue()).toBe(searchEnglish.label);
      expect(await page.locator("article h2").allTextContents()).toEqual(titles);
      const first = page.locator("article").filter({ has: page.locator("h2").getByText(titles[0], { exact: true }) });
      await first.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
      const editor = first.getByRole("textbox", { name: copy("literatureWorkspace.notesLabel"), exact: true });
      expect(await editor.inputValue()).toBe(notes[0]); const edited = "UNSAVED_NOTE العربية <script>literal</script> {count}";
      await editor.fill(edited); const editorNode = await editor.elementHandle(); expect(editorNode).not.toBeNull();
      const visibleTitles = () => page.locator("article:visible h2").allTextContents();
      async function download(key: "ris" | "csl" | "csv" | "backup", expected: string) {
        const index = (await fixture(page)).downloads.length;
        await page.getByRole("button", { name: copy(`literatureWorkspace.${key}`), exact: true }).click();
        await expect.poll(async () => (await fixture(page)).downloads[index]?.text).toBe(expected);
        const info = (await fixture(page)).downloads[index];
        expect(info.name).toBe({ ris: "keryx-literature-references.ris", csl: "keryx-literature-references.json", csv: "keryx-literature-screening.csv", backup: "keryx-literature-backup.json" }[key]);
        expect(info.type).toBe({ ris: "application/x-research-info-systems;charset=utf-8", csl: "application/json;charset=utf-8", csv: "text/csv;charset=utf-8", backup: "application/json" }[key]);
      }
      const expectedOrder = { saved: [0, 1, 2, 3], title: [2, 3, 0, 1], year: [2, 3, 0, 1], recent: [3, 2, 1, 0] };
      for (const mode of LITERATURE_SORTS) {
        await sort.selectOption(mode); const ordered = expectedOrder[mode].map(index => original.entries[index]);
        await expect.poll(visibleTitles).toEqual(ordered.map(entry => entry.paper.title));
        await download("ris", paperReferencesRis(ordered.map(entry => entry.paper)).content);
        await download("csl", paperReferencesCslJson(ordered.map(entry => entry.paper)).content);
        expect(await editor.inputValue()).toBe(edited); expect(await editor.evaluate((node, previous) => node === previous, editorNode)).toBe(true);
      }
      await page.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: titles[0] }), exact: true }).check();
      await page.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: titles[1] }), exact: true }).check();
      await search.fill("ONLY_NOTE"); await filter.selectOption("include");
      await expect.poll(visibleTitles).toEqual([titles[2], titles[0]]);
      const comparison = page.getByRole("region", { name: copy("literatureComparison.label"), exact: true });
      expect(await comparison.getByRole("link").allTextContents()).toEqual([titles[0], titles[1]]);
      const outside = comparison.getByText(text.outsideSearch, { exact: true }); expect(await outside.count()).toBe(1);
      expect(await outside.getAttribute("lang")).toBe(language);
      const shown = [original.entries[2], original.entries[0]];
      await download("ris", paperReferencesRis(shown.map(entry => entry.paper)).content);
      await download("csl", paperReferencesCslJson(shown.map(entry => entry.paper)).content);
      await download("csv", literatureScreeningCsv(original)); await download("backup", raw);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const sortId = await sort.getAttribute("id"); await fits(page.locator(`label[for="${sortId}"]`));
      await fits(page.getByRole("button", { name: text.clear, exact: true }));
      for (const control of [search, sort]) {
        const bounds = await control.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      const prefix = `literature-search-${language}-${width}-font${font}`;
      await capture(filter.locator("xpath=../.."), `${prefix}-controls`); await capture(comparison, `${prefix}-selection`);
      const searchNode = await search.elementHandle();
      await locale(page, "en"); const englishSearch = page.getByRole("searchbox", { name: searchEnglish.label, exact: true }); await englishSearch.waitFor();
      expect(await englishSearch.inputValue()).toBe("ONLY_NOTE"); expect(await englishSearch.evaluate((node, previous) => node === previous, searchNode)).toBe(true);
      await locale(page, language); await search.waitFor(); expect(await search.inputValue()).toBe("ONLY_NOTE");
      expect(await editor.inputValue()).toBe(edited);
      await search.fill("NO_MATCH <literal> {count}"); await page.getByText(text.empty, { exact: true }).waitFor();
      expect(await visibleTitles()).toEqual([]); expect(await comparison.getByText(text.outsideSearch, { exact: true }).count()).toBe(2);
      await capture(page.getByText(text.empty, { exact: true }), `${prefix}-empty`);
      await page.getByRole("button", { name: text.clear, exact: true }).click();
      expect(await search.inputValue()).toBe(""); expect(await search.evaluate(node => node === document.activeElement)).toBe(true);
      await expect.poll(visibleTitles).toEqual([titles[2], titles[0]]); await filter.selectOption("all");
      await expect.poll(visibleTitles).toEqual([titles[3], titles[2], titles[1], titles[0]]);
      expect(await editor.inputValue()).toBe(edited); expect(await editor.evaluate((node, previous) => node === previous, editorNode)).toBe(true);
      expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw);
      expect(serializeLiteratureWorkspace(await saved(page))).toBe(raw); expect((await fixture(page)).writes).toBe(0);
      expect(await page.locator("script:not([src])").count()).toBe(1); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    } finally { await context.close(); }
  }, 30_000);
