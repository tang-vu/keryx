import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { ledgerFixture } from "./test-fixture";
import { ledgerDigest } from "./projection";
import { operatorLedgerJsonText, operatorLedgerCsvText } from "./serialize";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en"), initial = ledgerFixture(), changed = structuredClone(initial);
changed.payload.window.days = 1; changed.payload.window.from = new Date(Date.parse(changed.payload.window.readStartedAt) - 86400000).toISOString(); changed.integrity.digest = ledgerDigest(changed.payload);
type Fixture = { mode: string; tamper: boolean; revokes: string[]; downloads: { text: string; name: string; type: string }[]; requests: string[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{OperatorLedgerView}from'./components/keryx/operator-ledger-view';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',tamper:false,downloads:[],revokes:[],requests:[]};
    window.fetch=async(url,init)=>{f.requests.push(url);if(init.cache!=='no-store'||init.redirect!=='error')throw Error('BAD_TRANSPORT');const parsed=new URL(url);if(parsed.origin!==location.origin||parsed.pathname!=='/api/operator/ledger')throw Error('BAD_ENDPOINT');const packet=parsed.searchParams.get('days')==='1'?${JSON.stringify(changed)}:${JSON.stringify(initial)};if(f.tamper)packet.integrity.digest='sha256:'+'0'.repeat(64);return Response.json(packet,{headers:{'X-Keryx-Ledger-Digest':packet.integrity.digest}})};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:ledger/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={text:'',name:this.download,type:blob.type};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<OperatorLedgerView/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const button = (page: Page, format = "json") => page.getByRole("button", { name: copy(format === "json" ? "jobLedger.exportJson" : "jobLedger.exportCsv"), exact: true });
const error = (page: Page) => page.getByText("Download unavailable. Try again.", { exact: true });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://ledger-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://ledger-download.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://ledger-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0); expect(await page.locator("a[download]").count()).toBe(0);
  } finally { await context.close(); }
}
it.each(["json", "csv"].flatMap(format => ["url", "click"].map(mode => ({ format, mode }))))("recovers $format $mode errors and retries the exact validated ledger snapshot", async ({ format, mode }) => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page, format).click(); await error(page).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await button(page).count()).toBe(1); if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page, format).click(); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(format === "json" ? operatorLedgerJsonText(initial) : operatorLedgerCsvText(initial)); expect((await state(page)).downloads[0]).toMatchObject({ name: `keryx-public-job-ledger.${format}`, type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }); expect(await error(page).count()).toBe(0); expect((await state(page)).requests).toHaveLength(1); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" ? 2 : 1);
}));
it("clears export failure on window change and exports only the newly validated snapshot", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page).click(); await error(page).waitFor(); await page.getByLabel(copy("jobLedger.window"), { exact: true }).selectOption("1"); await button(page).waitFor(); expect(await error(page).count()).toBe(0); await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page).click(); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(operatorLedgerJsonText(changed)); expect((await state(page)).requests).toHaveLength(2);
}));
it("refuses a corrupted reloaded ledger and removes prior export controls", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.tamper = true; }); await page.getByRole("button", { name: copy("jobLedger.retry"), exact: true }).click(); await page.getByText(copy("jobLedger.unavailable"), { exact: true }).waitFor(); expect(await button(page).count()).toBe(0); expect(await button(page, "csv").count()).toBe(0); expect((await state(page)).downloads).toEqual([]);
}));
