import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { canonicalReadPacket, actualReadPacketHash } from "./actual-read-record";
import { syntheticDecisionShowcasePacket } from "./decision-inspection";
import { decisionLabCopy as copy } from "./decision-lab-copy";

const canonical = canonicalReadPacket(syntheticDecisionShowcasePacket());
type Fixture = { mode: string; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string, digest: string;
beforeAll(async () => {
  digest = await actualReadPacketHash(JSON.parse(canonical));
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{DecisionLab}from'./components/keryx/decision-lab';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[],handoffs:[]};URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:decision/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};createRoot(document.getElementById('root')).render(<DecisionLab/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://decision-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://decision-download.test/"); await page.addScriptTag({ content: bundle }); await page.getByRole("button", { name: copy.download, exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://decision-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
it.each([false, true].flatMap(recorded => ["url", "click", "okay"].map(mode => ({ recorded, mode }))))("exports recorded=$recorded canonical packets after $mode recovery", async ({ recorded, mode }) => fixture(async page => {
  if (recorded) {
    await page.getByLabel(copy.file, { exact: true }).setInputFiles({ name: "synthetic-checkpoints.json", mimeType: "application/json", buffer: Buffer.from(canonical) }); await page.getByLabel(copy.digest, { exact: true }).fill(digest); await page.getByRole("button", { name: copy.inspect, exact: true }).click(); await page.getByText(copy.verified, { exact: true }).waitFor(); await page.getByText(copy.recordedBoundary, { exact: true }).waitFor();
  } else await page.getByText(copy.sample, { exact: true }).waitFor();
  const button = page.getByRole("button", { name: copy.download, exact: true });
  if (mode !== "okay") {
    await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button.click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
    await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; });
  }
  await button.click(); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(canonical); expect((await state(page)).downloads[0]).toMatchObject({ name: recorded ? "read-checkpoints.json" : "synthetic-read-checkpoints.json", type: "application/json", connected: true });
  await expect.poll(async () => (await state(page)).handoffs).toEqual([true]); expect(await page.locator("a[download]").count()).toBe(0); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" ? 2 : 1);
  await page.getByText(recorded ? copy.recorded : copy.sample, { exact: true }).waitFor();
}));
it("keeps the synthetic export after a refused digest and clears download feedback on reset", async () => fixture(async page => {
  await page.getByLabel(copy.file, { exact: true }).setInputFiles({ name: "checkpoints.json", mimeType: "application/json", buffer: Buffer.from(canonical) }); await page.getByLabel(copy.digest, { exact: true }).fill("0".repeat(64)); await page.getByRole("button", { name: copy.inspect, exact: true }).click(); await page.getByText(copy.refused, { exact: true }).waitFor();
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await page.getByRole("button", { name: copy.download, exact: true }).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); await page.getByRole("button", { name: copy.reset, exact: true }).click(); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await page.getByText(copy.sample, { exact: true }).waitFor();
}));
