import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const question = "Compare public research metadata", changed = "Compare a different research topic";
type Fixture = { writes: string[]; revokes: string[]; downloads: { text: string; name: string; type: string; connected: boolean }[]; copyMode: string; downloadMode: string; settle(ok: boolean): void; mount(change?: boolean): void };
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ResearchRequest}from'./components/keryx/research-request';
    const root=createRoot(document.getElementById('root')),pending=[],blobs=new Map();let sequence=0;
    const f=window.fixture={writes:[],revokes:[],downloads:[],copyMode:'defer',downloadMode:'okay',settle(ok){const p=pending.shift();ok?p.resolve():p.reject(Error('PRIVATE_COPY_DETAIL'));},mount(change=false){root.render(<ResearchRequest mode='quick' budget={0.25} total={0.5} version={change?'v2':'v1'} payee='0x1111111111111111111111111111111111111111'/>);}};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText(text){f.writes.push(text);if(f.copyMode==='reject')return Promise.reject(Error('PRIVATE_COPY_DETAIL'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});
    URL.createObjectURL=blob=>{if(f.downloadMode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:request/'+(++sequence);blobs.set(id,blob);return id;};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.downloadMode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href);const entry={name:this.download,type:blob.type,connected:this.isConnected,text:''};f.downloads.push(entry);blob.text().then(text=>entry.text=text);};f.mount();` }, plugins: [{ name: "unverified-checkout", setup(b) {
    b.onResolve({ filter: /^\.\/research-checkout$/ }, args => ({ path: args.path, namespace: "checkout" }));
    b.onLoad({ filter: /.*/, namespace: "checkout" }, () => ({ contents: "export function ResearchCheckout(){throw Error('Unverified checkout must not mount')}" }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://request-actions.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    await page.goto("https://request-actions.test/"); await page.addScriptTag({ content: bundle }); await page.getByRole("textbox").fill(question); await page.locator("summary").click(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://request-actions.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const copy = (page: Page) => page.getByRole("button", { name: "Copy request JSON", exact: true });
const download = (page: Page) => page.getByRole("button", { name: "Download request", exact: true });
const state = (page: Page) => page.evaluate(() => { const f = (window as unknown as { fixture: Fixture }).fixture; return { writes: f.writes, downloads: f.downloads, revokes: f.revokes }; });
const settle = (page: Page, ok: boolean) => page.evaluate(ok => (window as unknown as { fixture: Fixture }).fixture.settle(ok), ok);
it("deduplicates pending request copies and announces the exact completed JSON", async () => fixture(async page => {
  const text = await page.locator("pre").textContent(); await copy(page).click(); await copy(page).evaluate(e => (e as HTMLButtonElement).click());
  expect((await state(page)).writes).toEqual([text]); expect(await copy(page).getAttribute("aria-busy")).toBe("true");
  expect(await page.getByText("Request copied. No payment was made.", { exact: true }).count()).toBe(0);
  await settle(page, true); await page.getByText("Request copied. No payment was made.", { exact: true }).waitFor();
}));
it.each([true, false])("ignores late %s copy results after question edits", async ok => fixture(async page => {
  await copy(page).click(); await page.getByRole("textbox").fill(changed); await settle(page, ok);
  expect(await page.locator("details [role=status]").textContent()).toBe("");
  await copy(page).click(); await settle(page, true); await page.getByText("Request copied. No payment was made.", { exact: true }).waitFor();
  expect(JSON.parse((await state(page)).writes.at(-1)!).question).toBe(changed);
}));
it.each([true, false])("discards late %s results when the prepared package changes", async ok => fixture(async page => {
  await copy(page).click(); await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount(true)); await expect.poll(() => page.getByRole("textbox").inputValue()).toBe(""); await settle(page, ok);
  await page.locator("summary").click(); expect(await page.locator("details [role=status]").textContent()).toBe("");
  expect(await copy(page).isDisabled()).toBe(true); expect(await download(page).isDisabled()).toBe(true);
}));
it.each(["url", "click"])("recovers from %s download failure and retries the exact request", async mode => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.downloadMode = mode; }, mode); await download(page).click();
  await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.locator("a[download]").count()).toBe(0);
  if (mode === "click") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.downloadMode = "okay"; }); await download(page).click();
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe((await page.locator("pre").textContent()) + "\n");
  expect((await state(page)).downloads[0]).toMatchObject({ name: "request.json", type: "application/json", connected: true });
  expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0);
}));
it("exports the displayed trimmed JSON using a temporary attached anchor", async () => fixture(async page => {
  await page.getByRole("textbox").fill("  " + question + "  "); await download(page).click();
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe((await page.locator("pre").textContent()) + "\n");
  const entry = (await state(page)).downloads[0]; expect(JSON.parse(entry.text)).toEqual({ question, budget: 0.25, researchMode: "quick", packageVersion: "v1", responseMode: "async" }); expect(entry.connected).toBe(true);
  expect(await page.locator("a[download]").count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
}));
