import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { buildResearchReceipt } from "../research-receipt";
import type { Citation, QueryRun } from "../types";
import { compareSavedResearch, type ReportComparison } from "./report-comparison";
import { exportReportComparison } from "./report-comparison-export";
import { createReportComparisonPlan } from "./report-comparison-plan";
import { reportComparisonCopy as copy } from "@/locales/en/report-comparison";

function receipt(quote: string) {
  const citation: Citation = { marker: "S1", sourceId: "public:original", sourceName: "Synthetic fixture publisher", itemId: "api", itemUrl: "https://publisher.example/api", itemTitle: "API documentation", contentVersion: "v1", sourceKind: "public-reference", weight: 1, reward: 0, rationale: "" };
  const run: QueryRun = { id: "synthetic-download-comparison", question: "Read the original", engine: "offline", budget: 0, answer: quote + " [S1]", subClaims: ["How long is the buffer valid?"], decisions: [], citations: [citation], evidence: [{ ...citation, claim: "How long is the buffer valid?", claimIndex: 0, quote, support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false }], totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-25T00:00:00Z", paymentMode: "offline" };
  return JSON.stringify(buildResearchReceipt(run, []));
}
const before = receipt("The buffer is valid until the next call."), after = receipt("The buffer remains valid for two calls.");
const formats = [{ format: "json" as const, label: copy.json, name: "keryx-report-comparison.json", type: "application/json;charset=utf-8" }, { format: "markdown" as const, label: copy.markdown, name: "keryx-report-comparison.md", type: "text/markdown;charset=utf-8" }, { format: "csv" as const, label: copy.csv, name: "keryx-report-comparison.csv", type: "text/csv;charset=utf-8" }, { format: "plan" as const, label: copy.saveMatchingPlan, name: "keryx-report-matching.json", type: "application/json;charset=utf-8" }];
type Fixture = { mode: string; revokes: string[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string, model: ReportComparison;
beforeAll(async () => {
  model = await compareSavedResearch({ before, after });
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ReportComparisonWorkspace}from'./components/keryx/report-comparison-workspace';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[]};URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:comparison/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<ReportComparisonWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://comparison-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://comparison-download.test/"); await page.addScriptTag({ content: bundle });
    for (const [label, text] of [[copy.beforeFile, before], [copy.afterFile, after]]) await page.getByLabel(label, { exact: true }).setInputFiles({ name: "receipt.json", mimeType: "application/json", buffer: Buffer.from(text) });
    const compare = page.getByRole("button", { name: copy.compare, exact: true }); await expect.poll(() => compare.isEnabled()).toBe(true); await compare.click(); await page.getByRole("heading", { name: copy.resultTitle, exact: true }).waitFor();
    await page.getByLabel(copy.searchLabel, { exact: true }).fill("no matching excerpt"); await page.getByText(copy.noMatches, { exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://comparison-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
it.each(formats.flatMap(format => ["url", "click"].map(mode => ({ ...format, mode }))))("recovers $format export from $mode failure and preserves the full checked comparison", async format => fixture(async page => {
  const button = page.getByRole("button", { name: format.label, exact: true }); await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, format.mode); await button.click();
  await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.locator("a[download]").count()).toBe(0);
  if (format.mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button.click();
  const expected = format.format === "plan" ? JSON.stringify(createReportComparisonPlan(model), null, 2) + "\n" : exportReportComparison(model, format.format);
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: format.name, type: format.type, connected: true });
  expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); expect(await page.getByLabel(copy.searchLabel, { exact: true }).inputValue()).toBe("no matching excerpt");
  if (format.format === "plan") { expect(JSON.parse(expected)).toMatchObject({ beforeDigest: model.before.digest, afterDigest: model.after.digest }); expect(expected).not.toContain("buffer"); }
  expect(await page.locator("a[download]").count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(format.mode === "click" ? 2 : 1);
}));
