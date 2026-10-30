import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { setupCopy } from "@/locales/en/get-started";
import { setupExamples } from "@/lib/public-installation";

let browser: Browser, bundle: string, css: string;
const first = "curl https://example.invalid/first\n# Example only", second = "printf '<new example>'";
type Fixture = { writes: string[]; mount(value: string, title?: string): void; locale(value: string): Promise<void>; mode(value: string): void; settle(ok: boolean): void; hide(): void };
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{SetupCode}from'./components/keryx/setup-code';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';import{localeDirection}from'./lib/i18n/locales';
    const root=createRoot(document.getElementById('root'));let mode='defer',view=englishUiCopy,currentValue=${JSON.stringify(first)},currentTitle='First example';const pending=[];
    const f=window.exampleFixture={writes:[],mount(value=${JSON.stringify(first)},title='First example'){currentValue=value;currentTitle=title;root.render(<StrictMode><UiCopyContext.Provider value={view}><SetupCode title={title} value={value}/></UiCopyContext.Provider></StrictMode>);},hide(){root.render(null)},
      async locale(locale){const preview=await loadUiPreview(locale);view={...englishUiCopy,locale,preview};document.documentElement.lang=locale;document.documentElement.dir=localeDirection(locale);f.mount(currentValue,currentTitle);},
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

it.each([320, 1366])("keeps Arabic labels, LTR original commands and honest copy recovery at %ipx", async width => fixture(async page => {
  const draft = JSON.parse(await readFile("locales/ar/ui-drafts/get-started.json", "utf8")).entries;
  const command = setupExamples.cli, title = setupCopy.integrations.cliSetup;
  await page.evaluate(async ({ command, title }) => {
    const f = (window as unknown as { exampleFixture: Fixture }).exampleFixture;
    f.mount(command, title); await f.locale("ar");
  }, { command, title });
  await page.getByRole("button", { name: `${draft["common.copy"].text} ${draft["integrations.cliSetup"].text}`, exact: true }).waitFor();
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  expect(await page.locator("pre").getAttribute("aria-labelledby")).toBe(await page.locator("main > div > div > p").getAttribute("id"));
  expect(await page.locator("pre code").getAttribute("lang")).toBe("en");
  expect(await page.locator("pre").getAttribute("translate")).toBe("no");
  expect(await page.locator("pre").evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
  expect(await page.locator("pre").textContent()).toBe(command);
  expect(await page.locator("main > div > div > p > span").getAttribute("lang")).toBe("ar");
  await button(page).focus(); await page.keyboard.press("Enter"); await settle(page, false);
  await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copyFailed);
  expect(await page.getByRole("status").locator("span").getAttribute("lang")).toBe("en");
  expect(await page.getByRole("status").locator("span").evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(command);
  await button(page).click(); await settle(page, true);
  await expect.poll(() => page.getByRole("status").textContent()).toBe(draft["common.copied"].text);
  expect(await page.getByRole("status").locator("span").getAttribute("lang")).toBe("ar");
  expect(await writes(page)).toEqual([command, command]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}, width));
