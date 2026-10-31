import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { PAPER_CATALOG } from "../papers/catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, literatureScreeningCsv, parseLiteratureWorkspace,
  saveLiteraturePaper, SCREENING_STATES, serializeLiteratureWorkspace } from "../papers/literature-workspace";
import { paperReferencesCslJson, paperReferencesRis } from "../papers/reference-export";
import { createMessages, englishMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { localeDirection, type UiLocale } from "../i18n/locales";
import { literatureImportCopy } from "../../locales/en/literature-import";

const locales = ["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
const states = Object.keys(SCREENING_STATES) as Array<keyof typeof SCREENING_STATES>;
const originals = { title: "Review title", question: "Original question 日本語 العربية <literal> {count}",
  notes: "Include <script>literal</script> {count} العربية", author: "Contributors unavailable" };
function workspace() {
  let value = emptyLiteratureWorkspace(); value.title = originals.title; value.question = originals.question;
  for (const [index, state] of states.entries()) {
    value = saveLiteraturePaper(value, { ...PAPER_CATALOG[index], title: index === 0 ? "Compare" : `Original paper ${index}`,
      authors: [originals.author], authorCount: 1, authorsTruncated: false }, "2026-10-31T00:00:00Z");
    value.entries[index].screening = state; value.entries[index].notes = originals.notes;
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
  for (const path of ["components/keryx/literature-workspace.tsx", "lib/papers/literature-browser-store.ts", "lib/i18n/ui-copy.tsx"])
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
  "keeps $locale workspace labels, original data and export/restore behavior at $width with $font px text", async ({ locale: language, width, font }) => {
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
      await page.goto("https://workspace-world.test/"); const raw = serializeLiteratureWorkspace(workspace());
      await page.evaluate(({ key, raw, font }) => { localStorage.setItem(key, raw); document.documentElement.style.fontSize = `${font}px`; }, { key: LITERATURE_STORAGE_KEY, raw, font });
      await page.addScriptTag({ content: bundle });
      await page.getByLabel(englishMessages["literatureWorkspace.titleLabel"], { exact: true }).waitFor();
      await locale(page, language);
      const preview = await loadUiPreview(language), copy = createMessages(language, preview.$messages);
      const title = page.getByLabel(copy("literatureWorkspace.titleLabel"), { exact: true }); await title.waitFor();
      const question = page.getByRole("textbox", { name: copy("literatureWorkspace.questionLabel"), exact: true });
      expect(await title.inputValue()).toBe(originals.title); expect(await question.inputValue()).toBe(originals.question);
      expect((await fixture(page)).writes).toBe(0);
      expect(await page.locator("html").getAttribute("dir")).toBe(localeDirection(language));
      const filter = page.getByRole("combobox", { name: copy("literatureWorkspace.filter"), exact: true });
      expect(await filter.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["all", ...states]);
      for (const state of states) expect(await filter.locator(`option[value="${state}"]`).textContent()).toBe(`${copy(`paperWorkspace.screening.${state}`)} (1)`);
      const paper = page.locator("article").filter({ has: page.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: "Compare" }), exact: true }) });
      expect(await paper.locator("h2").textContent()).toBe("Compare");
      expect(await paper.getByText(originals.author, { exact: true }).count()).toBe(1);
      expect(await paper.getByText(copy("literatureWorkspace.metadata"), { exact: true }).count()).toBe(1);
      await paper.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
      const screening = paper.getByRole("combobox", { name: copy("literatureWorkspace.screeningDecision"), exact: true });
      expect(await screening.locator("option").allTextContents()).toEqual(states.map(state => copy(`paperWorkspace.screening.${state}`)));
      expect(await screening.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(states);
      const notes = paper.getByRole("textbox", { name: copy("literatureWorkspace.notesLabel"), exact: true }); expect(await notes.inputValue()).toBe(originals.notes);
      expect(await page.locator("script:not([src])").count()).toBe(1); // Only the explicitly injected fixture bundle.
      for (const key of ["privacy", "referencesNotice", "compareNotice", "draftPrivacy", "portableNotice"] as const) {
        const notice = page.getByText(englishMessages[`literatureWorkspace.${key}`], { exact: true });
        expect(await notice.count()).toBe(1); expect(await notice.getAttribute("lang")).toBe("en");
        if (language === "ar") expect(await notice.getAttribute("dir")).toBe("ltr");
      }
      for (const key of ["ris", "csl", "csv", "backup", "restoreLabel"] as const) {
        const source = page.getByText(copy(`literatureWorkspace.${key}`), { exact: true });
        expect(await source.getAttribute("lang")).toBe(language);
        const tokens = { ris: ["(RIS)"], csl: ["(CSL-JSON)"], csv: ["CSV"], backup: ["JSON"], restoreLabel: ["JSON", "1 MiB"] };
        expect(await source.locator("bdi").allTextContents()).toEqual(tokens[key]);
        for (const token of await source.locator("bdi").all()) { expect(await token.getAttribute("dir")).toBe("ltr"); expect(await token.getAttribute("translate")).toBe("no"); }
      }
      expect(await page.getByLabel(copy("literatureWorkspace.restoreLabel"), { exact: true }).getAttribute("accept")).toBe(".json,application/json");
      await page.evaluate(() => document.fonts.ready);
      const overflowingFields = await page.locator("form label").evaluateAll(labels => labels.flatMap(label => {
        const bounds = label.getBoundingClientRect(), form = label.closest("form")!.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return [];
        const field = label.querySelector("input, textarea, select")!.getBoundingClientRect();
        const text = Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE);
        const rects = text.flatMap(node => { const range = document.createRange(); range.selectNodeContents(node); return Array.from(range.getClientRects()); });
        return field.left < form.left - 1 || field.right > form.right + 1 ||
          rects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.left < form.left - 1 || rect.right > form.right + 1)
          ? [{ label: text.map(node => node.textContent).join(""), bounds: bounds.toJSON(), form: form.toJSON(), field: field.toJSON(), rects: rects.map(rect => rect.toJSON()) }] : [];
      }));
      expect(overflowingFields, "Long authored form labels and their fields must stay within the form").toEqual([]);
      await fits(page.locator("button:visible, summary:visible"));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const prefix = `literature-${language}-${width}-font${font}`;
      await capture(page.locator('section[aria-labelledby="literature-project"]'), `${prefix}-focus`);
      await capture(filter.locator("xpath=../.."), `${prefix}-controls`);
      await capture(paper, `${prefix}-paper`);
      await capture(page.locator('section[aria-labelledby="literature-portability"]'), `${prefix}-portable`);

      const draft = "Unsaved العربية <literal> {count}", handle = await question.elementHandle(); await question.fill(draft);
      await locale(page, "en"); await page.getByRole("textbox", { name: englishMessages["literatureWorkspace.questionLabel"], exact: true }).waitFor();
      await locale(page, language); await question.waitFor();
      expect(await question.inputValue()).toBe(draft); expect(await question.evaluate((element, original) => element === original, handle)).toBe(true);
      await page.getByRole("button", { name: copy("literatureWorkspace.saveFocus"), exact: true }).click();
      await expect.poll(async () => (await saved(page)).question).toBe(draft);
      const note = "PRIVATE_NOTE original العربية <script>literal</script> {count}"; await notes.fill(note); await screening.selectOption("exclude");
      await paper.getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true }).click();
      await expect.poll(async () => (await saved(page)).entries[0].notes).toBe(note);
      expect((await saved(page)).entries[0].screening).toBe("exclude");
      await filter.selectOption("exclude");
      const value = await saved(page), visible = value.entries.filter(entry => entry.screening === "exclude");
      for (const [key, name, type, text] of [
        ["ris", "keryx-literature-references.ris", "application/x-research-info-systems;charset=utf-8", paperReferencesRis(visible.map(entry => entry.paper)).content],
        ["csl", "keryx-literature-references.json", "application/json;charset=utf-8", paperReferencesCslJson(visible.map(entry => entry.paper)).content],
        ["csv", "keryx-literature-screening.csv", "text/csv;charset=utf-8", literatureScreeningCsv(value)],
        ["backup", "keryx-literature-backup.json", "application/json", serializeLiteratureWorkspace(value)],
      ] as const) {
        const index = (await fixture(page)).downloads.length;
        expect(await page.getByRole("button", { name: copy(`literatureWorkspace.${key}`), exact: true }).count(),
          await page.getByText(copy(`literatureWorkspace.${key}`), { exact: true }).locator("..").ariaSnapshot()).toBe(1);
        await page.getByRole("button", { name: copy(`literatureWorkspace.${key}`), exact: true }).click();
        await expect.poll(async () => (await fixture(page)).downloads[index]?.text).toBe(text);
        expect((await fixture(page)).downloads[index]).toEqual({ name, type, text });
      }
      expect((await fixture(page)).downloads[0].text).not.toContain("PRIVATE_NOTE");
      expect((await fixture(page)).downloads[1].text).not.toContain(draft);
      expect((await fixture(page)).writes).toBe(2);
      const input = page.getByLabel(copy("literatureWorkspace.restoreLabel"), { exact: true });
      const imported = saveLiteraturePaper(emptyLiteratureWorkspace(), { ...PAPER_CATALOG[4], title: "Compare" }, "2026-10-31T00:00:00Z");
      imported.entries[0].screening = "undecided"; imported.entries[0].notes = originals.notes;
      await input.setInputFiles({ name: "Additional.json", mimeType: "application/json", buffer: Buffer.from(serializeLiteratureWorkspace(imported)) });
      const importPreview = page.getByRole("region", { name: literatureImportCopy.preview, exact: true });
      await importPreview.getByText(literatureImportCopy.review, { exact: true }).click();
      expect(await importPreview.locator("li a").textContent()).toBe("Compare");
      expect(await importPreview.getByText(copy("paperWorkspace.screening.undecided"), { exact: true }).count()).toBe(1);
      expect(await importPreview.getByText(originals.notes, { exact: true }).count()).toBe(1);
      await page.getByRole("button", { name: copy("literatureWorkspace.cancelRestore"), exact: true }).click();
      expect(serializeLiteratureWorkspace(await saved(page))).toBe(serializeLiteratureWorkspace(value));
      await input.setInputFiles({ name: "Original {count}.json", mimeType: "application/json", buffer: Buffer.from(raw) });
      await page.getByRole("button", { name: copy("literatureWorkspace.restore"), exact: true }).waitFor();
      expect(await page.getByText(englishMessages["literatureWorkspace.restoreNotice"], { exact: true }).count()).toBe(1);
      await page.getByRole("button", { name: copy("literatureWorkspace.cancelRestore"), exact: true }).click();
      expect(serializeLiteratureWorkspace(await saved(page))).toBe(serializeLiteratureWorkspace(value));
      await input.setInputFiles({ name: "Original.json", mimeType: "application/json", buffer: Buffer.from(raw) });
      await page.getByRole("button", { name: copy("literatureWorkspace.restore"), exact: true }).click();
      await expect.poll(async () => serializeLiteratureWorkspace(await saved(page))).toBe(raw);
      await input.setInputFiles({ name: "Oversized.json", mimeType: "application/json", buffer: Buffer.alloc(1_048_577, 32) });
      await page.getByRole("alert").filter({ hasText: copy("literatureWorkspace.tooLarge") }).waitFor();
      expect(serializeLiteratureWorkspace(await saved(page))).toBe(raw);
      await page.getByText(copy("literatureWorkspace.clearDetails"), { exact: true }).click();
      expect(await page.getByText(englishMessages["literatureWorkspace.clearNotice"], { exact: true }).count()).toBe(1);
      let confirm = ""; page.once("dialog", async dialog => { confirm = dialog.message(); await dialog.dismiss(); });
      await page.getByRole("button", { name: copy("literatureWorkspace.clear"), exact: true }).click();
      await expect.poll(() => confirm).toBe(englishMessages["literatureWorkspace.clearConfirm"]);
      expect(serializeLiteratureWorkspace(await saved(page))).toBe(raw);
      if (width === 320 && font === 16) {
        const other = await context.newPage(); other.setDefaultTimeout(5000);
        other.on("pageerror", error => errors.push(error.message));
        await other.goto("https://workspace-world.test/"); await other.addScriptTag({ content: bundle });
        await other.getByLabel(englishMessages["literatureWorkspace.titleLabel"], { exact: true }).waitFor();
        await locale(other, language);
        await question.fill("THIS_TAB_PRIVATE question");
        await other.getByRole("textbox", { name: copy("literatureWorkspace.questionLabel"), exact: true }).fill("REMOTE saved question");
        await other.getByRole("button", { name: copy("literatureWorkspace.saveFocus"), exact: true }).click();
        await page.getByText(copy("literatureWorkspace.staleFocus"), { exact: true }).waitFor();
        await page.getByRole("button", { name: copy("literatureWorkspace.saveFocus"), exact: true }).click();
        await page.getByRole("alert").filter({ hasText: copy("literatureWorkspace.staleFocusError") }).waitFor();
        expect(await question.inputValue()).toBe("THIS_TAB_PRIVATE question");
        expect((await saved(page)).question).toBe("REMOTE saved question");
        await page.getByRole("button", { name: copy("literatureWorkspace.loadFocus"), exact: true }).click();
        expect(await question.inputValue()).toBe("REMOTE saved question");
        await paper.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
        await notes.fill("THIS_TAB_PRIVATE note");
        const remotePaper = other.locator("article").filter({ has: other.getByRole("checkbox", { name: copy("literatureWorkspace.compareLabel", { title: "Compare" }), exact: true }) });
        await remotePaper.getByText(copy("literatureWorkspace.editNotes"), { exact: true }).click();
        await remotePaper.getByRole("textbox", { name: copy("literatureWorkspace.notesLabel"), exact: true }).fill("REMOTE saved note");
        await remotePaper.getByRole("combobox", { name: copy("literatureWorkspace.screeningDecision"), exact: true }).selectOption("include");
        await remotePaper.getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true }).click();
        await paper.getByText(copy("literatureWorkspace.staleScreening"), { exact: true }).waitFor();
        await paper.getByRole("button", { name: copy("literatureWorkspace.saveScreening"), exact: true }).click();
        await page.getByRole("alert").filter({ hasText: copy("literatureWorkspace.stalePaperError") }).waitFor();
        expect(await notes.inputValue()).toBe("THIS_TAB_PRIVATE note");
        expect((await saved(page)).entries[0]).toMatchObject({ notes: "REMOTE saved note", screening: "include" });
        await paper.getByRole("button", { name: copy("literatureWorkspace.loadScreening"), exact: true }).click();
        expect(await notes.inputValue()).toBe("REMOTE saved note"); expect(await screening.inputValue()).toBe("include");
        await other.close();
      }
      expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    } finally { await context.close(); }
  }, 30_000);
