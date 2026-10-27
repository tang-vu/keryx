import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PAPER_CATALOG } from "./catalog";
import { emptyLiteratureWorkspace, LITERATURE_STORAGE_KEY, saveLiteraturePaper, serializeLiteratureWorkspace } from "./literature-workspace";
import { paperReferencesBibtex } from "./reference-export";
import { literatureReferencesMarkdown } from "./literature-markdown";
import { createMessages } from "../i18n/messages";
import { literatureSearchCopy as search } from "../../locales/en/literature-search";

const copy = createMessages("en");
const workspace = () => {
  let value = emptyLiteratureWorkspace();
  for (const [i, paper] of PAPER_CATALOG.slice(0, 3).entries()) value = saveLiteraturePaper(value, { ...paper, title: ["Gamma other", "Beta cohort", "Alpha cohort"][i] }, `2026-10-${20 + i}T00:00:00Z`);
  value.question = "PRIVATE_QUESTION";
  value.entries.forEach((entry, i) => { entry.notes = `PRIVATE_NOTE_${i}`; entry.screening = i === 0 ? "exclude" : "include"; }); return value;
};
const formats = [{ label: "Download BibTeX", ext: "bib", type: "application/x-bibtex;charset=utf-8", serialize: paperReferencesBibtex }, { label: "Markdown", ext: "md", type: "text/markdown;charset=utf-8", serialize: literatureReferencesMarkdown }];
type Fixture = { mode: string; writes: number; revokes: string[]; downloads: { name: string; type: string; text: string; connected: boolean }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{LiteratureWorkspace}from'./components/keryx/literature-workspace';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',writes:0,downloads:[],revokes:[]};const original=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){f.writes++;return original.apply(this,args)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:library/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={name:this.download,type:blob.type,text:'',connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};
    createRoot(document.getElementById('root')).render(<LiteratureWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "plain-link", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: "link" })); b.onLoad({ filter: /.*/, namespace: "link" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: "import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>;}" }));
  } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://literature-formats.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://literature-formats.test/");
    const raw = serializeLiteratureWorkspace(workspace()); await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: LITERATURE_STORAGE_KEY, raw }); await page.addScriptTag({ content: bundle }); await page.getByLabel(search.label, { exact: true }).waitFor(); await test(page);
    expect(await page.evaluate(key => localStorage.getItem(key), LITERATURE_STORAGE_KEY)).toBe(raw); expect((await state(page)).writes).toBe(0); expect(errors).toEqual([]); expect(requests).toEqual(["https://literature-formats.test/"]);
  } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
it.each(formats)("exports only visible ordered metadata as $ext", async format => fixture(async page => {
  await page.getByLabel(search.label, { exact: true }).fill("cohort"); await page.getByLabel(copy("literatureWorkspace.filter")).selectOption("include"); await page.getByLabel(search.sortLabel, { exact: true }).selectOption("title");
  await page.getByRole("button", { name: format.label, exact: true }).click(); const expected = format.serialize(workspace().entries.slice(1).reverse().map(entry => entry.paper)).content;
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: `keryx-literature-references.${format.ext}`, type: format.type, connected: true });
  expect(expected).not.toContain("PRIVATE_"); expect(expected).not.toContain("Gamma other"); if (format.ext === "md") expect(expected).toContain("Paper text unread; peer-review and withdrawal status unknown");
  expect(await page.locator("a[download]").count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
}));
it("disables both formats for an empty visible selection", async () => fixture(async page => {
  await page.getByLabel(search.label, { exact: true }).fill("no such paper"); for (const format of formats) expect(await page.getByRole("button", { name: format.label, exact: true }).isDisabled()).toBe(true); expect((await state(page)).downloads).toEqual([]);
}));
it.each(formats)("recovers a blocked $ext download without revealing browser errors", async format => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "click"; }); await page.getByRole("button", { name: format.label, exact: true }).click();
  await page.getByRole("alert").filter({ hasText: copy("bibliographyExport.failed") }).waitFor(); expect(await page.getByRole("alert").textContent()).not.toContain("PRIVATE_"); expect((await state(page)).downloads).toEqual([]); await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await page.getByRole("button", { name: format.label, exact: true }).click();
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(format.serialize(workspace().entries.map(entry => entry.paper)).content); expect(await page.getByRole("alert").count()).toBe(0);
}));
