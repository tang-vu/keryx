/** Actual client component and built CSS. Controlled responses; no database/research/payment. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), ".next", "static", "chunks");
const cssFiles = (await readdir(directory)).filter(file => file.endsWith(".css"));
assert(cssFiles.length, "Build the exact candidate before browser verification");
const css = (await Promise.all(cssFiles.map(file => readFile(join(directory, file), "utf8")))).join("\n");
const screenshots = process.env.KERYX_FEEDBACK_SCREENSHOT_DIR ?? join(process.cwd(), ".artifacts", "feedback-ux");
await mkdir(screenshots, { recursive: true });
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{AnswerFeedback}from'./components/keryx/answer-feedback';
const root=createRoot(document.getElementById('root'));
window.renderFeedback=id=>root.render(<AnswerFeedback queryId={id}/>);
window.feedbackRequests=[];
window.fetch=(input,init={})=>new Promise((resolve,reject)=>{
 const request={url:String(input),method:init.method||'GET',body:init.body?JSON.parse(init.body):null,aborted:false};
 request.reply=(status,data)=>resolve({ok:status>=200&&status<300,json:async()=>data});
 request.fail=()=>reject(new TypeError('Synthetic connection loss'));
 request.holdJson=()=>resolve({ok:true,json:()=>new Promise(done=>{request.completeJson=done;})});
 init.signal?.addEventListener('abort',()=>{request.aborted=true;reject(new DOMException('Aborted','AbortError'));});
 window.feedbackRequests.push(request);
});`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' } });
interface Request {
  url: string; method: string; body: { queryId: string; rating: string } | null; aborted: boolean;
  reply(status: number, data: unknown): void; fail(): void; holdJson(): void; completeJson(data: unknown): void;
}
interface Controls { renderFeedback(id: string): void; feedbackRequests: Request[] }
const browser = await chromium.launch({ headless: true });
let cases = 0;
try {
  async function scenario(test: (page: Page) => Promise<void>, width = 390) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://feedback.test" || request.method() !== "GET" || url.pathname !== "/") return route.abort();
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><main id="root" style="max-width:800px;margin:auto"></main></body></html>' });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    try {
      await page.clock.install();
      await page.goto("https://feedback.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await test(page); assert.deepEqual(errors, []); cases++;
    } finally { await context.close(); }
  }
  const up = (page: Page) => page.getByRole("button", { name: /^Mark this answer as helpful/ });
  const down = (page: Page) => page.getByRole("button", { name: /^Mark this answer as not helpful/ });
  const render = (page: Page, id: string) => page.evaluate(id => (window as unknown as Controls).renderFeedback(id), id);
  const waitCalls = (page: Page, count: number) => page.waitForFunction(count => (window as unknown as Controls).feedbackRequests.length === count, count);
  const reply = (page: Page, index: number, status: number, data: unknown) => page.evaluate(({ index, status, data }) => (window as unknown as Controls).feedbackRequests[index].reply(status, data), { index, status, data });
  const calls = (page: Page) => page.evaluate(() => (window as unknown as Controls).feedbackRequests.map(({ url, method, body, aborted }) => ({ url, method, body, aborted })));
  async function ready(page: Page, id = "synthetic-report") {
    await render(page, id); await waitCalls(page, 1); await reply(page, 0, 200, { up: 2, down: 1 });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => !button.disabled && button.textContent?.includes("👍")));
  }

  await scenario(async page => {
    await render(page, "synthetic#&other=1"); await waitCalls(page, 1);
    assert(await up(page).isDisabled()); assert(await down(page).isDisabled());
    assert.equal(await up(page).textContent(), "👍"); await page.getByRole("status").filter({ hasText: "Loading feedback" }).waitFor();
    assert.equal(new URL((await calls(page))[0].url, "https://feedback.test").searchParams.get("queryId"), "synthetic#&other=1");
    await reply(page, 0, 200, { up: 2, down: 1 });
    await up(page).filter({ hasText: "2" }).waitFor();
    await up(page).focus(); await page.keyboard.press("Enter"); await waitCalls(page, 2);
    await page.getByRole("status").filter({ hasText: "Sending feedback" }).waitFor();
    assert.equal(await up(page).textContent(), "👍2");
    assert.equal(await up(page).getAttribute("aria-pressed"), "false");
    await page.evaluate(() => { for (const button of document.querySelectorAll<HTMLButtonElement>("button")) { button.click(); button.click(); } });
    assert.equal((await calls(page)).length, 2, "Pending feedback must not append another vote");
    // Other readers can vote concurrently; use the returned totals, not a local +1.
    await reply(page, 1, 200, { up: 5, down: 2 });
    await page.getByRole("status").filter({ hasText: "Feedback recorded." }).waitFor();
    assert.equal(await up(page).textContent(), "👍5"); assert.equal(await up(page).getAttribute("aria-pressed"), "true");
    assert(await up(page).isDisabled()); assert(await down(page).isDisabled());
    assert.deepEqual((await calls(page))[1].body, { queryId: "synthetic#&other=1", rating: "up" });
  });

  for (const failure of ["http", "connection", "malformed"] as const) await scenario(async page => {
    await ready(page); await up(page).click(); await waitCalls(page, 2);
    if (failure === "connection") await page.evaluate(() => (window as unknown as Controls).feedbackRequests[1].fail());
    else await reply(page, 1, failure === "http" ? 500 : 200, failure === "http" ? { error: "Synthetic error after possible persistence" } : { up: -1, down: "private" });
    await page.getByRole("alert").filter({ hasText: "It may have been recorded" }).waitFor();
    assert.equal(await up(page).textContent(), "👍2"); assert.equal(await down(page).textContent(), "👎1");
    assert.equal(await up(page).getAttribute("aria-pressed"), "false");
    assert(await up(page).isDisabled()); assert(await down(page).isDisabled());
    await page.evaluate(() => { for (const button of document.querySelectorAll<HTMLButtonElement>("button")) button.click(); });
    assert.equal((await calls(page)).length, 2, "Unknown persistence must not trigger another append");
    assert(!((await page.locator("body").innerText()).includes("private")), "Malformed values are not displayed");
  });

  for (const initial of [null, { up: 0.5, down: 1 }, { up: 1, down: Number.MAX_SAFE_INTEGER }]) await scenario(async page => {
    await render(page, "load-unavailable"); await waitCalls(page, 1); await reply(page, 0, 200, initial);
    await page.getByRole("status").filter({ hasText: "Feedback counts unavailable" }).waitFor();
    assert.equal(await up(page).textContent(), "👍"); assert(!(await up(page).isDisabled()));
    await down(page).click(); await waitCalls(page, 2); await reply(page, 1, 200, { up: 3, down: 4 });
    await page.getByRole("status").filter({ hasText: "Feedback recorded." }).waitFor();
    assert.equal(await down(page).getAttribute("aria-pressed"), "true");
  });

  for (const body of [false, true]) for (const method of ["GET", "POST"] as const) await scenario(async page => {
    if (method === "POST") {
      await ready(page); await up(page).click(); await waitCalls(page, 2);
      await page.getByRole("status").filter({ hasText: "Sending feedback" }).waitFor();
    } else { await render(page, "stalled-get"); await waitCalls(page, 1); }
    const index = method === "POST" ? 1 : 0;
    if (body) {
      await page.evaluate(index => (window as unknown as Controls).feedbackRequests[index].holdJson(), index);
      await page.waitForFunction(index => typeof (window as unknown as Controls).feedbackRequests[index].completeJson === "function", index);
    }
    await page.clock.fastForward(15_001);
    await page.getByRole(method === "POST" ? "alert" : "status").filter({ hasText: method === "POST" ? "It may have been recorded" : "Feedback counts unavailable" }).waitFor();
    assert((await calls(page))[index].aborted, "Deadline ends local observation of stalled headers or body");
    assert.equal(await up(page).textContent(), method === "POST" ? "👍2" : "👍");
    assert.equal(await up(page).getAttribute("aria-pressed"), "false");
    assert.equal(await up(page).isDisabled(), method === "POST");
    if (body) await page.evaluate(index => (window as unknown as Controls).feedbackRequests[index].completeJson({ up: 99, down: 99 }), index);
    else await reply(page, index, 200, { up: 99, down: 99 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await up(page).textContent(), method === "POST" ? "👍2" : "👍", "Late completion cannot replace the deadline outcome");
    if (method === "GET") {
      await down(page).click(); await waitCalls(page, 2); await reply(page, 1, 200, { up: 0, down: 1 });
      await page.getByRole("status").filter({ hasText: "Feedback recorded." }).waitFor();
    } else {
      await page.evaluate(() => { for (const button of document.querySelectorAll<HTMLButtonElement>("button")) button.click(); });
      assert.equal((await calls(page)).length, 2, "A timed-out possibly persisted insert must not be repeated");
    }
  });

  await scenario(async page => {
    await render(page, "old-get"); await waitCalls(page, 1);
    await page.evaluate(() => (window as unknown as Controls).feedbackRequests[0].holdJson());
    await page.waitForFunction(() => typeof (window as unknown as Controls).feedbackRequests[0].completeJson === "function");
    await render(page, "new-get"); await waitCalls(page, 2); await reply(page, 1, 200, { up: 7, down: 8 });
    await up(page).filter({ hasText: "7" }).waitFor();
    await page.evaluate(() => (window as unknown as Controls).feedbackRequests[0].completeJson({ up: 99, down: 99 }));
    // Drain promise handlers and the next paint before checking for a stale commit.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await up(page).textContent(), "👍7"); assert((await calls(page))[0].aborted);
  });

  await scenario(async page => {
    await ready(page, "old-post"); await up(page).click(); await waitCalls(page, 2);
    await render(page, "new-post"); await waitCalls(page, 3); await reply(page, 2, 200, { up: 7, down: 8 });
    await up(page).filter({ hasText: "7" }).waitFor(); await down(page).click(); await waitCalls(page, 4);
    await reply(page, 1, 200, { up: 99, down: 99 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await up(page).textContent(), "👍7"); assert.equal(await up(page).getAttribute("aria-pressed"), "false");
    await reply(page, 3, 200, { up: 7, down: 9 }); await page.getByRole("status").filter({ hasText: "Feedback recorded." }).waitFor();
    assert.equal(await down(page).getAttribute("aria-pressed"), "true");
    const requests = await calls(page); assert.equal(requests[1].aborted, false, "Unmounting does not cancel a possibly persisted write");
    assert.deepEqual(requests[3].body, { queryId: "new-post", rating: "down" });
  });

  for (const width of [320, 390, 768, 1440]) await scenario(async page => {
    await ready(page); await up(page).click(); await waitCalls(page, 2); await reply(page, 1, 500, {});
    await page.getByRole("alert").waitFor();
    for (const button of [up(page), down(page)]) {
      const box = await button.boundingBox(); assert(box && box.width >= 44 && box.height >= 44, "Feedback touch target must be at least 44px");
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Feedback overflow at ${width}px`);
    await page.screenshot({ path: join(screenshots, `unconfirmed-${width}.png`), fullPage: true });
  }, width);
  console.log(JSON.stringify({ cases, widths: [320, 390, 768, 1440], actualComponent: true, builtCss: true, transport: "controlled synthetic client responses", liveNetwork: false, databaseWrites: false }));
} finally { await browser.close(); }
