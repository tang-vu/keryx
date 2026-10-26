import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { createMessages } from "./i18n/messages";

const copy = createMessages("en"), url = "https://keryx.test/wanted/exact-request?version=2", claim = "A retained evidence request";
let browser: Browser, bundle: string, css: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{WantedShareButton}from'./components/keryx/wanted-share-button';
    const root=createRoot(document.getElementById('root')),fixture=window.shareFixture={writes:[],shares:[],pending:[],
      mount(url=${JSON.stringify(url)}){root.render(<WantedShareButton url={url} claim=${JSON.stringify(claim)}/>);},
      mode(native,clipboard){Object.defineProperty(navigator,'share',{configurable:true,value:native==='missing'?undefined:async payload=>{
        fixture.shares.push(payload);if(native==='abort')throw new DOMException('Cancelled','AbortError');if(native==='throw')throw Error('PRIVATE_SHARE_DETAIL');
      }});Object.defineProperty(navigator,'clipboard',{configurable:true,value:clipboard==='missing'?undefined:{writeText(value){fixture.writes.push(value);
        if(clipboard==='throw')return Promise.reject(Error('PRIVATE_CLIPBOARD_DETAIL'));if(clipboard==='defer')return new Promise(resolve=>fixture.pending.push(resolve));return Promise.resolve();}}});},
      settle(){fixture.pending.shift()?.();}};fixture.mode('missing','ok');fixture.mount();` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
type Fixture = { writes: string[]; shares: unknown[]; pending: unknown[]; mode(native: string, clipboard: string): void; mount(url?: string): void; settle(): void };
async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://wanted-share.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="margin:16px"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://wanted-share.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://wanted-share.test/"]);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button");
const state = (page: Page) => page.evaluate(() => { const f = (window as unknown as { shareFixture: Fixture }).shareFixture; return { writes: f.writes, shares: f.shares, pending: f.pending.length }; });
const mode = (page: Page, native: string, clipboard: string) => page.evaluate(([native, clipboard]) => (window as unknown as { shareFixture: Fixture }).shareFixture.mode(native, clipboard), [native, clipboard]);

it.each(["ok", "abort"])("preserves native %s sharing without clipboard writes", async native => fixture(async page => {
  await mode(page, native, "ok"); await button(page).click();
  await expect.poll(() => button(page).isEnabled()).toBe(true);
  expect((await state(page)).shares).toEqual([{ title: copy("wantedShare.title"), text: copy("wantedShare.text", { claim }), url }]);
  expect((await state(page)).writes).toEqual([]); expect(await page.getByRole("textbox").count()).toBe(0);
  expect(await button(page).textContent()).toContain(copy("wantedShare.share"));
}));

it("shows Copied only after the exact clipboard write resolves and blocks concurrent attempts", async () => fixture(async page => {
  await mode(page, "missing", "defer"); await button(page).click();
  expect(await button(page).isDisabled()).toBe(true); expect(await button(page).textContent()).not.toContain(copy("wantedShare.copied"));
  await button(page).evaluate(element => { (element as HTMLButtonElement).click(); });
  expect((await state(page)).writes).toEqual([url]);
  await page.evaluate(() => (window as unknown as { shareFixture: Fixture }).shareFixture.settle());
  await expect.poll(() => button(page).textContent()).toContain(copy("wantedShare.copied"));
  expect(await button(page).isEnabled()).toBe(true);
}));

it.each([320, 1366])("offers an exact focused/selectable fallback at %ipx when APIs are blocked", async width => fixture(async page => {
  await mode(page, "throw", "throw"); await button(page).click();
  const fallback = page.getByRole("textbox", { name: copy("wantedShare.share"), exact: true }); await fallback.waitFor();
  expect(await fallback.inputValue()).toBe(url); expect(await fallback.evaluate(element => document.activeElement === element)).toBe(true);
  expect(await fallback.evaluate(element => (element as HTMLTextAreaElement).selectionEnd - (element as HTMLTextAreaElement).selectionStart)).toBe(url.length);
  expect((await state(page)).writes).toEqual([url]); expect(await button(page).textContent()).not.toContain(copy("wantedShare.copied"));
  expect((await button(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}, width));

it("keeps late clipboard completion from claiming success for a new URL", async () => fixture(async page => {
  await mode(page, "missing", "defer"); await button(page).click();
  await page.evaluate(() => (window as unknown as { shareFixture: Fixture }).shareFixture.mount("https://keryx.test/wanted/another-request"));
  await expect.poll(() => button(page).isEnabled()).toBe(true);
  await page.evaluate(() => (window as unknown as { shareFixture: Fixture }).shareFixture.settle());
  expect(await button(page).textContent()).toContain(copy("wantedShare.share"));
  expect(await button(page).textContent()).not.toContain(copy("wantedShare.copied"));
}));

it("supports manual recovery when both browser APIs are missing", async () => fixture(async page => {
  await mode(page, "missing", "missing"); await button(page).click();
  const fallback = page.getByRole("textbox"); await fallback.waitFor(); expect(await fallback.inputValue()).toBe(url);
  expect((await state(page)).writes).toEqual([]);
}));
