import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { selectionFailureExport } from "./selection-failure-export";
import type { SelectionDiagnostic } from "./selection-diagnostic";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en");
const diagnostic: SelectionDiagnostic = { protocol: "keryx-source-selection-v1", id: "c12f7f67-2208-4f9d-ab28-f136ae55e61d", createdAt: "2026-10-05T00:00:00.000Z", stage: "decide", outcome: "refused", counts: { candidateCount: 2, targetCount: 8, decisionCount: 2, matchedCandidateCount: 2, validActionableCount: 0, withheldCandidateCount: 2, invalidRowCount: 2 }, reasons: [{ code: "missing_targets", rowIndex: 0, candidateIndex: 0 }, { code: "target_out_of_range", rowIndex: 1, candidateIndex: 1 }], truncated: false };
const supplied = { ...diagnostic, question: "PRIVATE_DIAGNOSTIC_QUESTION", providerPayload: "PRIVATE_PROVIDER_PAYLOAD", credentials: "PRIVATE_CREDENTIAL" };
type Fixture = { mode: string; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; type: string; connected: boolean }[]; mount(kind: string): void };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{SelectionFailureDownload}from'./components/keryx/selection-failure-download';
    const root=createRoot(document.getElementById('root')),original=${JSON.stringify(supplied)},blobs=new Map();let sequence=0;
    const f=window.fixture={mode:'okay',downloads:[],revokes:[],handoffs:[],mount(kind){const diagnostic=kind==='absent'?undefined:kind==='partial'?{...original,outcome:'partial'}:kind==='invalid'?{...original,counts:{...original.counts,candidateCount:-1}}:kind==='changed'?{...original,reasons:[{code:'invalid_output'}]}:original;root.render(<SelectionFailureDownload diagnostic={diagnostic}/>);}};
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('PRIVATE_ELEMENT_DETAIL');return create(tag,...args)};
    const append=document.body.appendChild.bind(document.body);document.body.appendChild=function(node){if(node.tagName==='A'&&f.mode==='append')throw Error('PRIVATE_APPEND_DETAIL');return append(node)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:diagnostic/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};f.mount('original');` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://failure-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://failure-download.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); expect((await state(page)).downloads).toEqual([]); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://failure-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button", { name: copy("sourceDecision.downloadDiagnostic"), exact: true });
const state = (page: Page) => page.evaluate(() => { const f = (window as unknown as { fixture: Fixture }).fixture; return { downloads: f.downloads, handoffs: f.handoffs, revokes: f.revokes }; });
async function assertExport(page: Page, expected = selectionFailureExport(supplied)!) {
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected.text); expect((await state(page)).downloads[0]).toMatchObject({ name: expected.filename, type: "application/json;charset=utf-8", connected: true });
  const value = JSON.parse((await state(page)).downloads[0].text); expect(value).toMatchObject({ format: "keryx-research-failure-v1", outcome: "failed", notice: "Failure diagnostic only. Not a completed research report or payment receipt." }); expect(JSON.stringify(value)).not.toContain("PRIVATE_"); await expect.poll(async () => (await state(page)).handoffs).toEqual([true]); expect(await page.locator("a[download]").count()).toBe(0);
}
it("exports only the canonical sanitized refusal after explicit activation", async () => fixture(async page => {
  await button(page).focus(); await page.keyboard.press("Enter"); await assertExport(page); await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
}));
it.each(["url", "element", "append", "click"])("recovers from %s failure and releases every allocated URL", async mode => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.locator("a[download]").count()).toBe(0);
  if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page).click(); await assertExport(page); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "url" ? 1 : 2);
}));
it("binds recovery feedback to the exact sanitized artifact and resets it after removal", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor();
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount("changed")); await expect.poll(() => page.getByRole("alert").count()).toBe(0);
  await page.evaluate(() => { const f = (window as unknown as { fixture: Fixture }).fixture; f.mode = "okay"; }); await button(page).click(); await assertExport(page, selectionFailureExport({ ...supplied, reasons: [{ code: "invalid_output" }] })!);
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount("absent")); await expect.poll(() => button(page).count()).toBe(0); await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount("original")); await button(page).waitFor(); expect(await page.getByRole("alert").count()).toBe(0);
}));
it.each(["absent", "partial", "invalid"])("offers no failure artifact for %s diagnostics", async kind => fixture(async page => {
  await page.evaluate(kind => (window as unknown as { fixture: Fixture }).fixture.mount(kind), kind); await expect.poll(() => button(page).count()).toBe(0); expect((await state(page)).downloads).toEqual([]);
}));
