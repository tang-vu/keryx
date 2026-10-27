import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { createMessages } from "../i18n/messages";
import viMessages from "../../locales/generated/vi-ui-preview";
import zhMessages from "../../locales/generated/zh-Hans-ui-preview";
import type { SourcePerformanceResponse } from "./source-performance-response";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const copy = createMessages("en");
const unavailable = copy("sourceLearning.unavailable"), title = copy("creatorDecisions.title");
function feedback(sourceId: string, question = `Public question for ${sourceId}`): SourcePerformanceResponse {
  return { sourceId, name: `Source ${sourceId}`, windowRuns: 400, performance: { considered: 2, bought: 1, reused: 0,
    skipped: 1, cited: 1, citeThrough: 1, evChosen: 0.8, evSkipped: 0.2, price: 0.002, rivalPriceOnSkip: 0.001,
    recentSkips: [{ queryId: `public-${sourceId}`, question, rationale: "Original public rationale", expectedValue: 0.2,
      price: 0.002, rivalPrice: 0.001, createdAt: "2026-10-01T00:00:00.000Z" }] } };
}
type Call = { index: number; url: string; method: string; cache?: string; aborted: boolean; settled: boolean };
type Fixture = { calls(): Call[]; respond(index: number, status: number, data: unknown, raw?: boolean): void;
  fail(index: number): void; creator(id: string): void; mount(value: boolean): void; locale(value: string): void };
const fonts = `@font-face{font-family:FeedbackDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:FeedbackSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:FeedbackMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:FeedbackDisplay;--font-spectral:FeedbackSerif;--font-spline-mono:FeedbackMono}`;

beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';
    import{DecisionFeedbackPanel}from'./app/creator/[id]/decision-feedback-panel';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';
    import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const requests=[];window.fetch=(url,options={})=>new Promise((resolve,reject)=>requests.push({url:String(url),options,resolve,reject,settled:false}));
    const fixture=window.creatorFeedbackFixture={
      calls:()=>requests.map((r,index)=>({index,url:r.url,method:r.options.method??'GET',cache:r.options.cache,aborted:r.options.signal?.aborted??false,settled:r.settled})),
      respond(index,status,data,raw=false){const r=requests[index];if(!r)throw Error('Missing fixture request');r.settled=true;r.resolve(new Response(raw?String(data):JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}}))},
      fail(index){const r=requests[index];if(!r)throw Error('Missing fixture request');r.settled=true;r.reject(Error('PRIVATE_TRANSPORT_DETAIL'))}};
    function App(){const[id,setId]=useState('a'),[mounted,setMounted]=useState(true),[locale,setLocale]=useState('en');
      Object.assign(fixture,{creator:setId,mount:setMounted,locale:setLocale});
      const preview=locale==='vi'?vi:locale==='zh-Hans'?zh:{};
      const ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}><p id="fixture-ready">Creator fixture</p>{mounted?<DecisionFeedbackPanel creatorId={id}/>:<p>Unmounted fixture</p>}</UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);` },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(built.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  expect(inputs.some(path => path.endsWith("app/creator/[id]/decision-feedback-panel.tsx"))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)lib\/db(?:\/|\.)|source-performance-cache|node:sqlite/.test(path))).toBe(false);
  bundle = built.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
  if (screenshots) await writeFile(join(screenshots, "runtime.json"), JSON.stringify({ browserVersion: browser.version(),
    executablePath: chromium.executablePath(), bundledServerStorage: false, network: "All fixture requests intercepted; synthetic data only" }, null, 2));
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390, clock = false) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
  const errors: string[] = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://creator-feedback.test") unexpected.push(request.method() + " " + request.url());
      if (url.pathname === "/feedback.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") unexpected.push(url.pathname);
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/feedback.css"></head><body><main id="root" style="max-width:900px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    if (clock) await page.clock.install();
    await page.goto("https://creator-feedback.test/"); await page.addScriptTag({ content: bundle });
    await page.locator("#fixture-ready").waitFor(); await pending(page, "a");
    await page.evaluate(() => document.fonts.ready);
    await test(page);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    const requests = await calls(page);
    expect(requests.every(call => call.method === "GET" && call.cache === "no-store" && /^\/api\/creator\/[^/]+\/performance$/.test(call.url))).toBe(true);
  } finally { await context.close(); }
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { creatorFeedbackFixture: Fixture }).creatorFeedbackFixture.calls());
async function pending(page: Page, id: string) {
  const url = `/api/creator/${encodeURIComponent(id)}/performance`;
  await expect.poll(async () => (await calls(page)).filter(call => call.url === url && !call.aborted && !call.settled).length).toBe(1);
  return (await calls(page)).findLast(call => call.url === url && !call.aborted && !call.settled)!.index;
}
const respond = (page: Page, index: number, status: number, data: unknown, raw = false) => page.evaluate(({ index, status, data, raw }) =>
  (window as unknown as { creatorFeedbackFixture: Fixture }).creatorFeedbackFixture.respond(index, status, data, raw), { index, status, data, raw });
const creator = (page: Page, id: string) => page.evaluate(id => (window as unknown as { creatorFeedbackFixture: Fixture }).creatorFeedbackFixture.creator(id), id);

it.each(["http", "network", "malformed", "json", "wrong-source"] as const)("shows truthful %s failure and retries only after an explicit keyboard action", async mode => {
  await fixture(async page => {
    const first = await pending(page, "a");
    if (mode === "network") await page.evaluate(index => (window as unknown as { creatorFeedbackFixture: Fixture }).creatorFeedbackFixture.fail(index), first);
    else if (mode === "http") await respond(page, first, 503, { error: "PRIVATE_STORAGE_DETAIL" });
    else if (mode === "json") await respond(page, first, 200, "PRIVATE_INVALID_JSON", true);
    else await respond(page, first, 200, mode === "wrong-source" ? feedback("b") : { sourceId: "a", performance: { considered: 1 } });
    const section = page.getByRole("region", { name: title, exact: true });
    await section.getByText(unavailable, { exact: true }).waitFor();
    expect(await section.textContent()).not.toMatch(/PRIVATE|NaN|Public question/);
    const before = (await calls(page)).length;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await calls(page)).length).toBe(before);
    const retry = section.getByRole("button", { name: "Retry", exact: true });
    await page.evaluate(() => document.fonts.ready);
    const box = await retry.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
    if (mode === "http") {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (screenshots) await page.screenshot({ path: join(screenshots, "creator-feedback-unavailable-320.png"), fullPage: true });
    }
    await retry.focus(); await page.keyboard.press("Enter"); const next = await pending(page, "a");
    expect(await retry.getAttribute("aria-busy")).toBe("true"); expect(await retry.isDisabled()).toBe(true);
    await page.keyboard.press("Enter"); expect((await calls(page)).length).toBe(before + 1);
    await respond(page, next, 200, feedback("a"));
    await section.getByText("Public question for a", { exact: true }).waitFor();
    expect(await section.getByRole("status").count()).toBe(0);
    await section.getByText(copy("creatorDecisions.paymentBoundary"), { exact: true }).waitFor();
  }, mode === "http" ? 320 : 390);
});

it("keeps a verified empty record distinct from read failure", async () => {
  await fixture(async page => {
    await respond(page, await pending(page, "a"), 200, { sourceId: "a", name: "Source A", windowRuns: 400, performance: null });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.getByRole("region", { name: title, exact: true }).count()).toBe(0);
    expect(await page.getByRole("status").count()).toBe(0);
  });
});

it("isolates late outcomes and a return to the same creator before another read completes", async () => {
  await fixture(async page => {
    await respond(page, await pending(page, "a"), 200, feedback("a", "Old A question"));
    await page.getByText("Old A question", { exact: true }).waitFor();
    await creator(page, "b"); const oldB = await pending(page, "b");
    expect(await page.getByText("Old A question", { exact: true }).count()).toBe(0);
    await creator(page, "a"); const newA = await pending(page, "a");
    expect(await page.getByText("Old A question", { exact: true }).count()).toBe(0);
    await respond(page, newA, 200, feedback("a", "Fresh A question")); await page.getByText("Fresh A question", { exact: true }).waitFor();
    expect((await calls(page)).find(call => call.index === oldB)!.aborted).toBe(true);
    await respond(page, oldB, 200, feedback("b", "Late B question"));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.getByText("Fresh A question", { exact: true }).count()).toBe(1);
    expect(await page.getByText("Late B question", { exact: true }).count()).toBe(0);
  });
});

it("bounds a stalled read, leaves retry explicit and ignores the old timed-out response", async () => {
  await fixture(async page => {
    const old = await pending(page, "a"); await page.clock.fastForward(16_000);
    await page.getByText(unavailable, { exact: true }).waitFor();
    expect((await calls(page)).find(call => call.index === old)!.aborted).toBe(true);
    const before = (await calls(page)).length; await page.clock.fastForward(60_000); expect((await calls(page)).length).toBe(before);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await respond(page, await pending(page, "a"), 200, { sourceId: "a", name: "Source A", windowRuns: 400, performance: null });
    await page.getByRole("status").waitFor({ state: "detached" });
    await respond(page, old, 200, feedback("a", "Timed-out question")); await page.clock.runFor(100);
    expect(await page.getByText("Timed-out question", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("region", { name: title, exact: true }).count()).toBe(0);
  }, 390, true);
});

it("keeps failure recovery localized without another data read", async () => {
  await fixture(async page => {
    await respond(page, await pending(page, "a"), 503, { error: "unavailable" }); await page.getByRole("status").waitFor();
    const before = (await calls(page)).length;
    for (const [locale, preview] of [["vi", viMessages], ["zh-Hans", zhMessages]] as const) {
      await page.evaluate(locale => (window as unknown as { creatorFeedbackFixture: Fixture }).creatorFeedbackFixture.locale(locale), locale);
      const localized = createMessages(locale, preview.$messages);
      await expect.poll(() => page.getByRole("status").textContent()).toBe(localized("sourceLearning.unavailable"));
      await page.getByRole("button", { name: localized("myHistory.retry"), exact: true }).waitFor();
      expect((await calls(page)).length).toBe(before);
    }
  });
});
