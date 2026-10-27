import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import template from "@/docs/business-scenario-template.json";
import { businessScenarioSchema, calculateBusinessScenario } from "./business-scenario";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en"), initial = businessScenarioSchema.parse(template);
type Fixture = { mode: string; revokes: string[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{BusinessCalculator}from'./components/keryx/business-calculator';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[]};URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:business/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<BusinessCalculator/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://business-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://business-download.test/"); await page.addScriptTag({ content: bundle }); await button(page, "inputs").waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://business-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const button = (page: Page, kind: "inputs" | "report") => page.getByRole("button", { name: copy(kind === "inputs" ? "businessCalculator.exportInputs" : "businessCalculator.exportScenarioReport"), exact: true });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const content = (kind: "inputs" | "report", input = initial) => JSON.stringify(kind === "inputs" ? input : { inputs: input, report: calculateBusinessScenario(input) }, null, 2) + "\n";
it.each((["inputs", "report"] as const).flatMap(kind => ["url", "click"].map(mode => ({ kind, mode }))))("recovers $kind downloads from $mode failures and preserves unknown-cost arithmetic", async ({ kind, mode }) => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page, kind).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page, kind).click(); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(content(kind)); expect((await state(page)).downloads[0]).toMatchObject({ name: `keryx-business-${kind}.json`, type: "application/json", connected: true }); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); expect(await page.locator("a[download]").count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" ? 2 : 1);
}));
it("exports exact imported operator estimates with fractional costs without altering the model", async () => fixture(async page => {
  const known = businessScenarioSchema.parse({ ...initial, basis: "operator-estimate", paidJobsPerMonth: 10, creatorSpendUsdPerJob: "0.020001", variableCostUsdPerJob: { llm: "0.000001", infrastructure: "0", paymentAndGas: "0.000001", support: "0", refundAndLoss: "0" }, fixedMonthlyUsd: "1.000001", acquisitionMonthlyUsd: "0" });
  await page.getByLabel(copy("businessCalculator.importScenarioInputs"), { exact: true }).setInputFiles({ name: "inputs.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(known)) }); await page.getByText(copy("businessCalculator.scenarioInputsImportedLocally"), { exact: true }).waitFor();
  for (const [index, kind] of (["inputs", "report"] as const).entries()) { await button(page, kind).click(); await expect.poll(async () => (await state(page)).downloads[index]?.text).toBe(content(kind, known)); }
}));
it("clears download feedback on edits and still refuses invalid precision", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page, "inputs").click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); await page.getByLabel(copy("businessCalculator.serviceFeePerJob"), { exact: true }).fill("0.1234567"); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); expect(await button(page, "inputs").isDisabled()).toBe(true); expect(await button(page, "report").isDisabled()).toBe(true); expect((await state(page)).downloads).toEqual([]);
}));
