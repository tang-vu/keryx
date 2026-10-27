import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { draftCheckCopy as copy } from "../research/draft-check-copy";
import { buildDraftCheck, type DraftCheckRequest } from "../research/draft-check";

const packet: DraftCheckRequest = { version: 1, scope: "private-draft-check", passage: "Trials measured 12 samples [1].", references: { format: "list", text: "https://example.org/trials" }, sources: [], suggestions: [] };
type Fixture = { mode: string; revokes: string[]; downloads: { text: string; name: string; type: string }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{DraftCheckWorkspace}from'./components/keryx/draft-check-workspace';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[]};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:draft/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={text:'',name:this.download,type:blob.type};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<DraftCheckWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://draft-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://draft-download.test/"); await page.addScriptTag({ content: bundle });
    await page.getByLabel(copy.passage.label, { exact: true }).fill(packet.passage); await page.getByLabel(copy.references.label, { exact: true }).fill(packet.references.text); await page.getByRole("button", { name: copy.workspace.check, exact: true }).click(); await page.getByRole("heading", { name: copy.results.heading, exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://draft-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const error = (page: Page) => page.getByText("Download unavailable. Try again.", { exact: true });
it.each(["result", "input"].flatMap(kind => ["url", "click"].map(mode => ({ kind, mode }))))("recovers $kind $mode failures and retries the exact private packet", async ({ kind, mode }) => fixture(async page => {
  const button = page.getByRole("button", { name: kind === "result" ? copy.workspace.download : copy.retention.downloadInput, exact: true });
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button.click(); await error(page).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.getByRole("status").textContent()).not.toBe(copy.workspace.downloaded);
  if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button.click(); await page.getByText(copy.workspace.downloaded, { exact: true }).waitFor(); expect(await error(page).count()).toBe(0);
  const expected = JSON.stringify(kind === "result" ? buildDraftCheck(packet) : packet, null, 2) + "\n";
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: kind === "result" ? "private-draft-check.json" : "private-draft-input.json", type: "application/json" }); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" ? 2 : 1);
}));
it("clears export failure on edit and refuses exporting stale results", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await page.getByRole("button", { name: copy.workspace.download, exact: true }).click(); await error(page).waitFor(); await page.getByLabel(copy.passage.label).fill("A different claim [1]."); await page.getByText(copy.workspace.stale, { exact: true }).waitFor(); expect(await error(page).count()).toBe(0); expect(await page.getByRole("button", { name: copy.workspace.download, exact: true }).isDisabled()).toBe(true); expect(await page.getByRole("button", { name: copy.retention.downloadInput, exact: true }).isDisabled()).toBe(true);
}));
