import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { verificationToken } from "@/lib/sources/feed-verification-token";

const wallet = "0x1111111111111111111111111111111111111111", other = "0x2222222222222222222222222222222222222222";
type Fixture = { writes: string[]; toasts: string[][]; owner: string | null; mount(change?: string): void; mode(value: string): void; settle(ok: boolean): void };
let browser: Browser, bundle: string, css: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{FeedVerificationPanel}from'./components/keryx/feed-verification-panel';
    const root=createRoot(document.getElementById('root'));let mode='defer',source={id:'one',walletAddress:${JSON.stringify(wallet)}};const pending=[];
    const f=window.fixture={writes:[],toasts:[],owner:${JSON.stringify(wallet)},mount(change){if(change==='source')source={id:'two',walletAddress:${JSON.stringify(other)}};if(change==='owner')f.owner=null;root.render(change==='hide'?null:<StrictMode><FeedVerificationPanel source={source}/></StrictMode>);},
    mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:value==='missing'?undefined:{writeText(text){f.writes.push(text);if(mode==='reject')return Promise.reject(Error('PRIVATE_DENIED'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});},settle(ok){const p=pending.shift();if(!p)throw Error('no pending copy');ok?p.resolve():p.reject(Error('PRIVATE_DENIED'));}};f.mode('defer');f.mount();` }, plugins: [{ name: "copy-only-boundaries", setup(b) {
    b.onResolve({ filter: /^(sonner|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "copy-fixture" }));
    b.onLoad({ filter: /.*/, namespace: "copy-fixture" }, args => ({ contents: args.path === "sonner" ? "export const toast={success:m=>window.fixture.toasts.push(['success',m]),error:m=>window.fixture.toasts.push(['error',m])};" : "export function useSiweAuth(){return{session:window.fixture.owner?{address:window.fixture.owner}:null}}" }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: "block" });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://feed-copy.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="margin:16px"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    await page.goto("https://feed-copy.test/"); await page.addScriptTag({ content: bundle }); await copy(page).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://feed-copy.test/"]);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const copy = (page: Page) => page.getByRole("button").first();
const state = (page: Page) => page.evaluate(() => ({ writes: (window as unknown as { fixture: Fixture }).fixture.writes, toasts: (window as unknown as { fixture: Fixture }).fixture.toasts }));
const settle = (page: Page, ok: boolean) => page.evaluate(ok => (window as unknown as { fixture: Fixture }).fixture.settle(ok), ok);
it("copies only the public challenge once while pending and waits for success", async () => fixture(async page => {
  await copy(page).focus(); await page.keyboard.press("Enter"); await copy(page).evaluate(e => (e as HTMLButtonElement).click());
  expect((await state(page)).writes).toEqual([verificationToken(wallet)]); expect((await state(page)).toasts).toEqual([]);
  expect(await copy(page).getAttribute("aria-busy")).toBe("true"); await settle(page, true);
  await expect.poll(async () => (await state(page)).toasts.length).toBe(1); expect((await state(page)).toasts[0][0]).toBe("success");
  expect(await copy(page).evaluate(e => e === document.activeElement)).toBe(true);
}));
it.each(["source", "owner", "hide"].flatMap(change => [true, false].map(ok => ({ change, ok }))))("ignores late $ok toasts after $change changes", async ({ change, ok }) => fixture(async page => {
  await copy(page).click(); await page.evaluate(change => (window as unknown as { fixture: Fixture }).fixture.mount(change), change);
  if (change === "hide") await expect.poll(() => page.getByRole("button").count()).toBe(0);
  else if (change === "source") await page.getByText(verificationToken(other), { exact: true }).waitFor();
  else await expect.poll(() => page.getByRole("button").last().isDisabled()).toBe(true);
  await settle(page, ok); expect((await state(page)).toasts).toEqual([]);
  if (change !== "hide") { await copy(page).click(); await settle(page, true); await expect.poll(async () => (await state(page)).toasts.length).toBe(1); expect((await state(page)).writes.at(-1)).toBe(verificationToken(change === "source" ? other : wallet)); }
}));
it.each(["missing", "reject"])("reports %s clipboard failure without private details and permits retry", async mode => fixture(async page => {
  await page.evaluate(value => (window as unknown as { fixture: Fixture }).fixture.mode(value), mode); await copy(page).click();
  await expect.poll(async () => (await state(page)).toasts.length).toBe(1); const toast = (await state(page)).toasts[0]; expect(toast[0]).toBe("error"); expect(toast[1]).not.toContain("PRIVATE_");
  await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mode("defer")); await copy(page).click(); await settle(page, true);
  await expect.poll(async () => (await state(page)).toasts.length).toBe(2); expect((await state(page)).toasts[1][0]).toBe("success");
}));
it.each([320, 1366])("provides a visible keyboard target without page overflow at %ipx", async width => fixture(async page => {
  await copy(page).focus(); const box = (await copy(page).boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
  expect(await copy(page).evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}, width));
