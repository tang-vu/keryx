import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { setupCopy } from "@/locales/en/get-started";

let browser: Browser, bundle: string, css: string;
const first = "curl https://example.invalid/first\n# Example only", second = "printf '<new example>'";
type Fixture = { writes: string[]; mount(value: string, title?: string): void; mode(value: string): void; settle(ok: boolean): void; hide(): void };
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{SetupCode}from'./components/keryx/setup-code';
    const root=createRoot(document.getElementById('root'));let mode='defer';const pending=[];
    const f=window.exampleFixture={writes:[],mount(value=${JSON.stringify(first)},title='First example'){root.render(<StrictMode><SetupCode title={title} value={value}/></StrictMode>);},hide(){root.render(null)},
      mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:value==='missing'?undefined:{writeText(text){f.writes.push(text);if(mode==='throw')throw Error('PRIVATE_CLIPBOARD_DETAIL');if(mode==='reject')return Promise.reject(Error('PRIVATE_PERMISSION_DETAIL'));return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});},
      settle(ok){const value=pending.shift();if(!value)throw Error('No pending copy');ok?value.resolve():value.reject(Error('PRIVATE_PERMISSION_DETAIL'));}};f.mode('defer');f.mount();` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://setup-copy.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="margin:16px"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://setup-copy.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://setup-copy.test/"]);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button");
const settle = (page: Page, ok: boolean) => page.evaluate(ok => (window as unknown as { exampleFixture: Fixture }).exampleFixture.settle(ok), ok);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { exampleFixture: Fixture }).exampleFixture.writes);

it("deduplicates pending keyboard/pointer copies and announces only the completed exact example", async () => fixture(async page => {
  await button(page).focus(); await page.keyboard.press("Enter");
  await button(page).evaluate(element => (element as HTMLButtonElement).click());
  expect(await writes(page)).toEqual([first]);
  expect(await button(page).getAttribute("aria-busy")).toBe("true"); expect(await page.getByRole("status").textContent()).toBe("");
  await settle(page, true); await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copied);
  expect(await button(page).getAttribute("aria-busy")).toBe("false");
  expect(await button(page).evaluate(element => document.activeElement === element)).toBe(true);
}));
it.each([true, false])("discards a late %s outcome when the displayed example changes", async success => fixture(async page => {
  await button(page).click();
  await page.evaluate(value => (window as unknown as { exampleFixture: Fixture }).exampleFixture.mount(value, "Second example"), second);
  await page.getByRole("button", { name: "Copy Second example", exact: true }).waitFor(); await settle(page, success);
  expect(await page.getByRole("status").textContent()).toBe("");
  expect(await button(page).getAttribute("aria-busy")).toBe("false");
  await button(page).click(); await settle(page, true);
  await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copied);
  expect(await writes(page)).toEqual([first, second]); expect(await page.locator("pre").textContent()).toBe(second);
}));
it.each(["missing", "throw", "reject"])("provides exact manual selection for %s clipboard and allows retry", async mode => fixture(async page => {
  await page.evaluate(value => (window as unknown as { exampleFixture: Fixture }).exampleFixture.mode(value), mode);
  await button(page).click(); await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copyFailed);
  expect(await page.locator("pre").evaluate(element => document.activeElement === element)).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(first);
  await page.evaluate(() => (window as unknown as { exampleFixture: Fixture }).exampleFixture.mode("defer"));
  await button(page).click(); await settle(page, true); await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copied);
}));
it.each([320, 1366])("keeps keyboard focus and the example within the page at %ipx", async width => fixture(async page => {
  await page.keyboard.press("Tab"); await button(page).focus();
  expect((await button(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await button(page).evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await button(page).click(); await settle(page, true);
  await expect.poll(() => button(page).textContent()).toBe(setupCopy.common.copied);
}, width));
