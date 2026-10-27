import { beforeAll, afterAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { verificationToken } from "../sources/feed-verification-token";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en"), first = verificationToken("0x1111111111111111111111111111111111111111"), second = verificationToken("0x2222222222222222222222222222222222222222");
type Fixture = { writes: string[]; toasts: string[][]; verifyCalls: number; mode(value: string): void; mount(change?: string): void; settle(ok: boolean): void };
let browser: Browser, bundle: string, css: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{BulkVerifyPanel}from'./components/keryx/bulk-import-results';
    const root=createRoot(document.getElementById('root')),pending=[];let mode='defer';const f=window.fixture={writes:[],toasts:[],verifyCalls:0,mount(change){root.render(change==='hide'?null:<BulkVerifyPanel token={change==='token'?${JSON.stringify(second)}:${JSON.stringify(first)}} instructions='Publish this public token.' registeredCount={2} verifiedCount={0} verifying={false} onVerifyAll={()=>f.verifyCalls++}/>);},
    mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:mode==='missing'?undefined:{writeText(text){f.writes.push(text);if(mode==='reject')return Promise.reject(Error('PRIVATE_DENIED'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});},settle(ok){const p=pending.shift();ok?p.resolve():p.reject(Error('PRIVATE_DENIED'));}};f.mode('defer');f.mount();` }, plugins: [{ name: "toast-observation", setup(b) { b.onResolve({ filter: /^sonner$/ }, () => ({ path: "toast", namespace: "toast" })); b.onLoad({ filter: /.*/, namespace: "toast" }, () => ({ contents: "export const toast={success:m=>window.fixture.toasts.push(['success',m]),error:m=>window.fixture.toasts.push(['error',m])};" })); } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://bulk-copy.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="margin:16px"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://bulk-copy.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://bulk-copy.test/"]); expect((await state(page)).verifyCalls).toBe(0); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button").first();
const state = (page: Page) => page.evaluate(() => { const f = (window as unknown as { fixture: Fixture }).fixture; return { writes: f.writes, toasts: f.toasts, verifyCalls: f.verifyCalls }; });
const settle = (page: Page, ok: boolean) => page.evaluate(async ok => { (window as unknown as { fixture: Fixture }).fixture.settle(ok); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }, ok);
it("deduplicates pending keyboard and pointer activation and copies the exact public token", async () => fixture(async page => {
  await button(page).focus(); await page.keyboard.press("Enter"); await button(page).evaluate(e => (e as HTMLButtonElement).click()); expect((await state(page)).writes).toEqual([first]); expect((await state(page)).toasts).toEqual([]); expect(await button(page).getAttribute("aria-busy")).toBe("true"); await settle(page, true); expect((await state(page)).toasts).toEqual([["success", copy("bulkVerification.copied")]]); expect(await button(page).evaluate(e => e === document.activeElement)).toBe(true);
}));
it.each(["token", "hide"].flatMap(change => [true, false].map(ok => ({ change, ok }))))("discards late $ok notices after $change changes", async ({ change, ok }) => fixture(async page => {
  await button(page).click(); await page.evaluate(change => (window as unknown as { fixture: Fixture }).fixture.mount(change), change); if (change === "hide") await expect.poll(() => page.getByRole("button").count()).toBe(0); else await page.getByText(second, { exact: true }).waitFor(); await settle(page, ok); expect((await state(page)).toasts).toEqual([]);
  if (change === "token") { await button(page).click(); await settle(page, true); expect((await state(page)).writes).toEqual([first, second]); expect((await state(page)).toasts).toEqual([["success", copy("bulkVerification.copied")]]); }
}));
it.each(["missing", "reject"])("reports %s clipboard safely and allows retry", async mode => fixture(async page => {
  await page.evaluate(mode => (window as unknown as { fixture: Fixture }).fixture.mode(mode), mode); await button(page).click(); await expect.poll(async () => (await state(page)).toasts).toEqual([["error", copy("bulkVerification.copyFailed")]]); await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mode("defer")); await button(page).click(); await settle(page, true); expect((await state(page)).toasts.at(-1)).toEqual(["success", copy("bulkVerification.copied")]);
}));
it.each([320, 1366])("provides a visible 44px keyboard target without overflow at %ipx", async width => fixture(async page => {
  await button(page).focus(); const box = (await button(page).boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(await button(page).evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe("none"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}, width));
