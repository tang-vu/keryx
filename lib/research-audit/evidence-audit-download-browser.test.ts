import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import sample from "@/docs/research-evidence-audit-example.json";
import { evidenceAuditCopy as copy } from "@/locales/en/evidence-audit";
import { auditResearchEvidence } from "./evidence-audit";

type Fixture = { mode: string; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string, expected: string;
beforeAll(async () => {
  expected = JSON.stringify(await auditResearchEvidence(JSON.stringify(sample), {}), null, 2) + "\n";
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ResearchEvidenceAuditWorkspace}from'./components/keryx/research-evidence-audit';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[],handoffs:[]};
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('PRIVATE_ELEMENT_DETAIL');return create(tag,...args)};
    const append=document.body.appendChild.bind(document.body);document.body.appendChild=function(node){if(node.tagName==='A'&&f.mode==='append')throw Error('PRIVATE_APPEND_DETAIL');return append(node)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:audit/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};createRoot(document.getElementById('root')).render(<ResearchEvidenceAuditWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://audit-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://audit-download.test/"); await page.addScriptTag({ content: bundle }); await load(page); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://audit-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
async function load(page: Page) { await page.getByRole("button", { name: copy.sample, exact: true }).click(); await page.getByRole("button", { name: copy.check, exact: true }).click(); await page.getByRole("heading", { name: copy.result, exact: true }).waitFor(); }
const button = (page: Page) => page.getByRole("button", { name: copy.download, exact: true });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
async function assertExport(page: Page) {
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: "keryx-local-evidence-audit.json", type: "application/json", connected: true }); await expect.poll(async () => (await state(page)).handoffs).toEqual([true]); expect(await page.locator("a[download]").count()).toBe(0);
}
it("downloads the complete actual audit without changing its arithmetic or trust statements", async () => fixture(async page => {
  expect((await state(page)).downloads).toEqual([]); await button(page).click(); await assertExport(page); await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
}));
it.each(["url", "element", "append", "click"])("recovers %s failures without exposing browser details and retries exact bytes", async mode => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.locator("a[download]").count()).toBe(0); if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page).click(); await assertExport(page); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "url" ? 1 : 2);
}));
it("clears export errors when the audited data is cleared and permits a fresh audit", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); await page.getByRole("button", { name: copy.clear, exact: true }).click(); expect(await button(page).count()).toBe(0); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await load(page); await button(page).click(); await assertExport(page);
}));
it("does not offer a stale export when the next receipt fails checksum verification", async () => fixture(async page => {
  const invalid = structuredClone(sample); invalid.receipt.payload.dispatch.answer += " Altered"; await page.getByLabel(copy.input, { exact: true }).fill(JSON.stringify(invalid)); await page.getByRole("button", { name: copy.check, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor(); expect(await button(page).count()).toBe(0); expect((await state(page)).downloads).toEqual([]);
}));
