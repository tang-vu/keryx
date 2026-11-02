import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { evidenceDraftRestoreCopy as restore } from "../../locales/en/evidence-draft-restore";
import { completedEvidenceDraftSelectionCopy as selector, completedEvidenceDraftImportCopy as importer } from "../../locales/en/completed-evidence-draft-selection";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { previewCopy } from "../i18n/ui-preview";
import { preparedLocales, type UiLocale } from "../i18n/locales";

let browser: Browser, bundle: string, css: string;
const captures = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const id = `prv_${"a".repeat(64)}`;
const original = evidenceDraftFixture();
original.workspace.title = "Original العربية 日本語 <literal> {papers}";
original.passage = "Original passage العربية <literal> {claims}";
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{EvidenceDraftRestore}from'./components/keryx/evidence-draft-restore';
    import{CompletedEvidenceDraftSelector}from'./components/keryx/completed-evidence-draft-selector';
    import{CompletedEvidenceDraftImport}from'./components/keryx/completed-evidence-draft-import';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    const original=${JSON.stringify(original)},before=JSON.stringify(original),workspace=original.workspace;
    const f=window.childFixture={restores:[],imports:0,writes:0,unchanged:()=>JSON.stringify(original)===before};
    const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){f.writes++;return setItem.apply(this,args)};
    const selection={id:${JSON.stringify(id)},savedAt:'2026-10-12T02:00:00Z',snapshotSha256:'sha256:'+'b'.repeat(64),
      question:'Exact original question',budget:0.05,researchMode:'deep',sources:[{sourceId:'paper',itemId:'v1',
      itemUrl:workspace.entries[0].paper.url,contentVersion:'sha256:'+'c'.repeat(64)}]};
    function App(){const[copy,setCopy]=useState(englishUiCopy);f.locale=async locale=>{const preview=await loadUiPreview(locale);
      document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';setCopy({...englishUiCopy,locale,preview})};
      return <UiCopyContext.Provider value={copy}><main style={{maxWidth:1000,margin:'24px auto',padding:'0 16px',display:'grid',gap:16}}>
        <EvidenceDraftRestore context={workspace} canSave={false} onSave={()=>{throw Error('No save admitted')}} onRestore={value=>{f.restores.push(value);return true}}/>
        <CompletedEvidenceDraftSelector workspace={workspace} onImport={()=>{f.imports++;return true}}/>
        <CompletedEvidenceDraftImport workspace={workspace} currentOwner={'0x'+'1'.repeat(40)} selection={selection} baseUrl={location.origin} network='eip155:5042' onImport={()=>{f.imports++;return true}}/>
      </main></UiCopyContext.Provider>};createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  for (const name of ["evidence-draft-restore", "completed-evidence-draft-selector", "completed-evidence-draft-import"])
    expect(Object.keys(result.metafile!.inputs).some(path => path.replaceAll("\\", "/").endsWith(`/components/keryx/${name}.tsx`) || path.replaceAll("\\", "/") === `components/keryx/${name}.tsx`)).toBe(true);
  expect(Object.keys(result.metafile!.inputs).some(path => /lib\/(?:db|payments)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (captures) await mkdir(join(captures, "draft-child-locale"), { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type Fixture = { locale(value: UiLocale): Promise<void>; restores: unknown[]; imports: number; writes: number; unchanged(): boolean };
const cases = preparedLocales.flatMap(locale => [320, 1366].map(width => ({ locale, width, font: 16 })));
cases.push({ locale: "ar", width: 320, font: 32 });
it.each(cases)("keeps $locale child controls and exact originals readable at $width with $font px text", async ({ locale, width, font }) => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const unexpected: string[] = [], reads: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://draft-child.test") { unexpected.push(url.href); return route.abort(); }
      if (url.pathname === "/api/auth/session" && request.method() === "GET") { reads.push(url.pathname); return route.fulfill({ status: 401, body: "{}", contentType: "application/json" }); }
      if (url.pathname === "/api/research/evidence-draft/completed-read" && request.method() === "POST") { reads.push(url.pathname); return route.fulfill({ status: 403, body: "{}", contentType: "application/json" }); }
      if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(url.pathname) && request.method() === "GET")
        return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname === "/reading.css" && request.method() === "GET") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname !== "/" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/reading.css"></head><body><div id="root"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://draft-child.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("heading", { name: restore.heading }).waitFor();
    await page.evaluate(async ({ locale, font }) => {
      await (window as unknown as { childFixture: Fixture }).childFixture.locale(locale); document.documentElement.style.fontSize = `${font}px`;
    }, { locale, font });
    const preview = await loadUiPreview(locale), r = previewCopy(preview, "evidence-draft-restore", restore);
    const s = previewCopy(preview, "completed-evidence-draft-selection", selector), i = previewCopy(preview, "completed-evidence-draft-selection", importer);
    await page.getByRole("heading", { name: r.heading }).waitFor(); expect(reads).toEqual([]);
    await page.getByLabel(r.file).setInputFiles({ name: "Original العربية {themes}.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
    const section = page.getByRole("region", { name: r.heading, exact: true });
    await section.getByRole("heading", { name: original.workspace.title, exact: true }).waitFor();
    for (const text of [original.workspace.title, original.passage, "Original العربية {themes}.json"])
      expect(await section.locator('bdi[lang="und"][dir="auto"][translate="no"]').filter({ hasText: text }).textContent()).toBe(text);
    if (locale !== "en") {
      const guidance = section.getByText(r.guidance, { exact: true }); expect(await guidance.getAttribute("lang")).toBe(r.guidance === restore.guidance ? "en" : locale);
      if (locale === "ar") expect(await guidance.getAttribute("dir")).toBe(r.guidance === restore.guidance ? "ltr" : "rtl");
    }
    const selected = page.getByRole("region", { name: s.label, exact: true });
    await selected.getByLabel(s.jobId).fill(id); expect(await selected.locator("input").getAttribute("dir")).toBe("ltr");
    await selected.getByRole("button", { name: s.read, exact: true }).click();
    await expect.poll(() => selected.getByRole("status").textContent()).toBe(s.signIn);
    const imported = page.getByRole("region", { name: i.label, exact: true });
    await imported.getByRole("button", { name: i.import, exact: true }).click();
    await expect.poll(() => imported.getByRole("status").textContent()).toBe(i.unavailable);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("button").evaluateAll(nodes => nodes.every(node => {
      const rect = node.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(node);
      return [...range.getClientRects()].every(line => line.left >= rect.left && line.right <= rect.right + 1 && line.top >= rect.top && line.bottom <= rect.bottom + 1);
    }))).toBe(true);
    if (captures) await page.locator("main").screenshot({ path: join(captures, "draft-child-locale", `${locale}-${width}-${font}.png`), animations: "disabled" });
    await section.getByRole("button", { name: r.restore, exact: true }).click();
    await expect.poll(() => section.getByRole("status").textContent()).toBe(r.restored);
    expect(await page.evaluate(() => { const f = (window as unknown as { childFixture: Fixture }).childFixture; return { restores: f.restores.length, imports: f.imports, writes: f.writes, unchanged: f.unchanged() }; })).toEqual({ restores: 1, imports: 0, writes: 0, unchanged: true });
    expect(reads).toEqual(["/api/auth/session", "/api/research/evidence-draft/completed-read"]); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
}, 20_000);

it("keeps child actions keyboard reachable with visible focus and status feedback", async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 900 }, serviceWorkers: "block" });
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://draft-child.test") return route.abort();
      if (url.pathname === "/reading.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
      if (url.pathname === "/api/research/evidence-draft/completed-read") return route.fulfill({ status: 403, contentType: "application/json", body: "{}" });
      return url.pathname === "/" ? route.fulfill({ contentType: "text/html", body: '<meta charset="utf-8"><link rel="stylesheet" href="/reading.css"><div id="root"></div>' }) : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto("https://draft-child.test/"); await page.addScriptTag({ content: bundle });
    await page.getByLabel(restore.file).setInputFiles({ name: "private-evidence-draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
    const restoreButton = page.getByRole("button", { name: restore.restore, exact: true }); await restoreButton.waitFor();
    await page.getByLabel(restore.file).focus(); await page.keyboard.press("Tab");
    expect(await restoreButton.evaluate(node => node === document.activeElement)).toBe(true);
    expect(await restoreButton.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter");
    await page.getByText(restore.restored, { exact: true }).waitFor();
    await page.getByLabel(selector.jobId).fill(id); await page.keyboard.press("Tab");
    expect(await page.getByRole("button", { name: selector.read, exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
    await page.keyboard.press("Enter"); await page.getByText(selector.signIn, { exact: true }).waitFor();
    await page.keyboard.press("Tab");
    expect(await page.getByRole("button", { name: importer.import, exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
    await page.keyboard.press("Space"); await page.getByText(importer.unavailable, { exact: true }).waitFor();
  } finally { await context.close(); }
});
