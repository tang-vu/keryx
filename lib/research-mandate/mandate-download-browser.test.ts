import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { evaluateMandate } from "./evaluate";
import { mandateExample } from "./example";
import { mandateCopy } from "@/locales/en/research-mandates";

const copy = mandateCopy.en, fixed = new Date("2026-10-27T09:00:00.000Z");
const input = mandateExample(fixed); input.policy.liabilities = [];
const raw = JSON.stringify(input, null, 2), assessment = evaluateMandate(input, fixed);
type Fixture = { mode: string; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ResearchMandateWorkspace}from'./components/keryx/research-mandate-workspace';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[],handoffs:[]};URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:mandate/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};createRoot(document.getElementById('root')).render(<ResearchMandateWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://mandate-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    // Freeze Date for exact assessment/hash comparison; browser timers remain real.
    await page.clock.setFixedTime(fixed); await page.goto("https://mandate-download.test/"); await page.addScriptTag({ content: bundle }); await page.getByLabel(copy.input, { exact: true }).fill(raw); await page.getByRole("button", { name: copy.assess, exact: true }).click(); await page.getByRole("button", { name: copy.export, exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://mandate-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
async function editJson(page: Page, text: string) {
  const field = page.getByLabel(copy.input, { exact: true });
  if (!await field.isVisible()) await page.locator("summary").filter({ hasText: copy.input }).click();
  await field.fill(text);
}
it.each(["policy", "assessment"].flatMap(kind => ["url", "click"].map(mode => ({ kind, mode }))))("recovers $kind export from $mode failures with exact supplied content", async ({ kind, mode }) => fixture(async page => {
  const button = page.getByRole("button", { name: kind === "policy" ? copy.policyExport : copy.export, exact: true }); await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button.click();
  await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.locator("a[download]").count()).toBe(0); if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button.click(); const expected = JSON.stringify(kind === "policy" ? input : assessment, null, 2);
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: `keryx-mandate-${kind}.json`, type: "application/json", connected: true }); await expect.poll(async () => (await state(page)).handoffs).toEqual([true]);
  expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); expect(await page.getByLabel(copy.input, { exact: true }).inputValue()).toBe(raw); if (kind === "assessment") expect(JSON.parse(expected).executionAuthorized).toBe(false);
  await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" ? 2 : 1);
}));
it("exports an unknown-books hold without introducing execution authority", async () => fixture(async page => {
  const unknown = { ...input, books: { ...input.books, complete: false } }; await editJson(page, JSON.stringify(unknown)); await page.getByRole("button", { name: copy.assess, exact: true }).click(); await page.getByRole("button", { name: copy.export, exact: true }).click();
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(JSON.stringify(evaluateMandate(unknown, fixed), null, 2)); expect(JSON.parse((await state(page)).downloads[0].text)).toMatchObject({ assessment: "hold", executionAuthorized: false, prepareCalldata: null });
}));
it("clears export failure on edited input while retaining invalid-input refusal", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await page.getByRole("button", { name: copy.policyExport, exact: true }).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); await editJson(page, "{}");
  expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); expect(await page.getByRole("button", { name: copy.policyExport, exact: true }).isDisabled()).toBe(true); await page.getByRole("button", { name: copy.assess, exact: true }).click(); await page.getByText(copy.invalid, { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]);
}));
