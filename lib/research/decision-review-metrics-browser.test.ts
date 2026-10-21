import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import copy from "../../locales/en/decision-reviews.json";

interface Harness {
  calls: { url: string; signal: AbortSignal }[];
  release(index: number, options?: { status?: number; count?: number; mismatch?: boolean }): void;
  consumed: number;
}
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DecisionReviewMetricsView}from'./components/keryx/decision-review-metrics';
    window.calls=[];window.pending=[];window.consumed=0;
    window.fetch=(url,init)=>{
      if(!String(url).startsWith('/api/decision-reviews/metrics?'))throw Error('Unexpected request');
      window.calls.push({url,signal:init.signal});
      return new Promise(resolve=>window.pending.push({url,resolve}));
    };
    // Deliberately ignore abort: late transport/body completion must stay harmless.
    window.release=(index,{status=200,count=7,mismatch=false}={})=>{
      const pending=window.pending[index],query=new URL(pending.url,location.origin).searchParams;
      const value={network:'eip155:5042002',since:mismatch?'2026-08-01T00:00:00.000Z':query.get('since'),until:query.get('until'),rule:'captured-owner-decisions-v1',
        cohorts:['outside','team','scripted','unknown'].map(cohort=>({cohort,decisions:cohort==='unknown'?count:0,agrees:0,disagrees:0,agreementRate:null,modelCodeDifferences:0,codeRefusals:0,refusalReasons:{}}))};
      pending.resolve(new Response(new ReadableStream({pull(controller){window.consumed++;controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();}}),{status,headers:{'Content-Type':'application/json'}}));
    };
    createRoot(document.getElementById('root')).render(<DecisionReviewMetricsView/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const external: string[] = [], errors: string[] = [];
  await context.route("**/*", route => route.request().url() === "https://metrics.test/"
    ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' })
    : (external.push(route.request().url()), route.abort()));
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://metrics.test/"); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    return inputs.length === 2 && inputs.every(input => !!input.value);
  });
  await page.getByLabel(copy.since, { exact: true }).fill("2026-09-01");
  await page.getByLabel(copy.until, { exact: true }).fill("2026-10-01");
  expect(await page.evaluate(() => (window as unknown as Harness).calls.length)).toBe(0);
  return { context, page, external, errors };
}
async function submit(page: Page, count: number) {
  await page.getByRole("button", { name: copy.loadMetrics, exact: true }).click();
  await page.waitForFunction(count => (window as unknown as Harness).calls.length === count, count);
}
async function reply(page: Page, index: number, options?: Parameters<Harness["release"]>[1]) {
  await page.evaluate(({ index, options }) => (window as unknown as Harness).release(index, options), { index, options });
  await page.waitForFunction(count => (window as unknown as Harness).consumed >= count, index + 1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

it.each([320, 1280].flatMap(width => ["since", "until"].map(field => ({ width, field }))))(
  "removes previous-period counts when $field changes at $width px", async ({ width, field }) => {
    const f = await fixture(width);
    try {
      await submit(f.page, 1); await reply(f.page, 0);
      expect(await f.page.locator("tbody tr").last().locator("td").first().textContent()).toBe("7");
      await f.page.getByLabel(field === "since" ? copy.since : copy.until, { exact: true }).fill(field === "since" ? "2026-09-02" : "2026-10-02");
      expect(await f.page.locator("table").count()).toBe(0);
      expect(await f.page.evaluate(() => (window as unknown as Harness).calls.length)).toBe(1);
      expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
    } finally { await f.context.close(); }
  });

it.each([200, 503])("changing dates cancels the old read; its late HTTP %s cannot finish a newer read", async status => {
  const f = await fixture();
  try {
    await submit(f.page, 1);
    await f.page.getByLabel(copy.since, { exact: true }).fill("2026-09-02");
    expect(await f.page.evaluate(() => (window as unknown as Harness).calls[0].signal.aborted)).toBe(true);
    await submit(f.page, 2);
    await reply(f.page, 0, { status });
    expect(await f.page.getByRole("button", { name: copy.loadMetrics, exact: true }).isDisabled()).toBe(true);
    expect(await f.page.locator("table").count()).toBe(0);
    expect(await f.page.getByText(copy.metricsUnavailable, { exact: true }).count()).toBe(0);
    await reply(f.page, 1, { count: 9 });
    expect(await f.page.locator("tbody tr").last().locator("td").first().textContent()).toBe("9");
    expect(await f.page.getByRole("button", { name: copy.loadMetrics, exact: true }).isEnabled()).toBe(true);
    expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

it("keeps response-period validation and clears an obsolete error on a date edit", async () => {
  const f = await fixture();
  try {
    await submit(f.page, 1); await reply(f.page, 0, { mismatch: true });
    await f.page.getByText(copy.metricsUnavailable, { exact: true }).waitFor();
    expect(await f.page.locator("table").count()).toBe(0);
    await f.page.getByLabel(copy.until, { exact: true }).fill("2026-10-02");
    expect(await f.page.getByText(copy.metricsUnavailable, { exact: true }).count()).toBe(0);
    expect(await f.page.evaluate(() => (window as unknown as Harness).calls.length)).toBe(1);
    expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});
