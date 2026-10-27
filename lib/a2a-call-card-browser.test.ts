import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { createMessages } from "./i18n/messages";
import { setupCopy } from "@/locales/en/get-started";

let browser: Browser, bundle: string, css: string;
const message = createMessages("en"), screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
type Fixture = { writes: string[]; mode(value: string): void; settle(success: boolean): void; mount(visible: boolean): void };

beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{StrictMode}from'react';import{createRoot}from'react-dom/client';import{A2aCallCard}from'./components/keryx/a2a-call-card';
    const root=createRoot(document.getElementById('root'));let mode='defer';const pending=[];
    const fixture=window.copyFixture={writes:[],mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:value==='missing'?undefined:{writeText(text){
      fixture.writes.push(text);if(mode==='throw')throw Error('PRIVATE_CLIPBOARD_DETAIL');
      if(mode==='reject')return Promise.reject(Error('PRIVATE_PERMISSION_DETAIL'));
      return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}});},
      settle(success){const request=pending.shift();if(!request)throw Error('No pending clipboard request');success?request.resolve():request.reject(Error('PRIVATE_PERMISSION_DETAIL'));},
      mount(visible){root.render(<StrictMode>{visible?<A2aCallCard/>:null}</StrictMode>);}};
    fixture.mode('defer');fixture.mount(true);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  css += `@font-face{font-family:CopyDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:CopySerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:CopyMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:CopyDisplay;--font-spectral:CopySerif;--font-spline-mono:CopyMono}`;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()); requests.push(url.pathname);
      expect(request.method()).toBe("GET"); expect(url.origin).toBe("https://agent-copy.test");
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(path.join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style><main id="root" style="margin:16px;max-width:1000px"></main>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://agent-copy.test/"); await page.addScriptTag({ content: bundle }); await button(page).waitFor();
    await page.evaluate(() => document.fonts.ready); await test(page);
    expect(errors).toEqual([]); expect(requests.every(value => value === "/" || value.startsWith("/fonts/"))).toBe(true);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE_");
  } finally { await context.close(); }
}
const button = (page: Page) => page.getByRole("button");
const mode = (page: Page, value: string) => page.evaluate(value => (window as unknown as { copyFixture: Fixture }).copyFixture.mode(value), value);
const settle = (page: Page, success: boolean) => page.evaluate(value => (window as unknown as { copyFixture: Fixture }).copyFixture.settle(value), success);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { copyFixture: Fixture }).copyFixture.writes);

it("waits for the exact snippet copy before showing success and ignores concurrent clicks", async () => fixture(async page => {
  const copy = button(page), snippet = await page.locator("pre").textContent();
  await copy.focus(); await page.keyboard.press("Enter");
  expect(await copy.textContent()).not.toContain(message("agentIntegration.copied"));
  expect(await copy.getAttribute("aria-busy")).toBe("true");
  await copy.evaluate(element => (element as HTMLButtonElement).click());
  expect(await writes(page)).toEqual([snippet]);
  await settle(page, true);
  await expect.poll(() => copy.textContent()).toContain(message("agentIntegration.copied"));
  expect(await page.getByRole("status").textContent()).toContain(message("agentIntegration.copied"));
  expect(await copy.getAttribute("aria-busy")).toBe("false");
  expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
  expect(snippet).toContain("curl -s https://keryx.cc/api/agent/ask");
  expect(snippet).toContain('"responseMode":"async"');
}));

it.each(["missing", "throw", "reject"])("offers manual selection when clipboard is %s, then permits retry", async failure => fixture(async page => {
  await mode(page, failure); await button(page).click();
  await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copyFailed);
  expect(await button(page).textContent()).not.toContain(message("agentIntegration.copied"));
  expect(await page.locator("pre").evaluate(element => document.activeElement === element)).toBe(true);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await page.locator("pre").textContent());
  await mode(page, "defer"); await button(page).click(); await settle(page, true);
  await expect.poll(() => button(page).textContent()).toContain(message("agentIntegration.copied"));
  expect(await page.getByRole("status").textContent()).not.toContain(setupCopy.common.copyFailed);
}));

it("clears an earlier success timer before a pending retry and resets only the newest success", async () => fixture(async page => {
  await page.clock.install(); await button(page).click(); await settle(page, true);
  await expect.poll(() => button(page).textContent()).toContain(message("agentIntegration.copied"));
  await page.clock.runFor(1500); await button(page).click(); await page.clock.runFor(600);
  expect(await button(page).getAttribute("aria-busy")).toBe("true");
  expect(await button(page).textContent()).not.toContain(message("agentIntegration.copied"));
  await settle(page, true); await page.clock.runFor(1500);
  expect(await button(page).textContent()).toContain(message("agentIntegration.copied"));
  await page.clock.runFor(600);
  await expect.poll(() => button(page).textContent()).toContain(message("agentIntegration.copy"));
  expect(await page.getByRole("status").textContent()).toBe("");
}));

it("keeps a late clipboard result from affecting a remounted card", async () => fixture(async page => {
  await button(page).click();
  await page.evaluate(() => (window as unknown as { copyFixture: Fixture }).copyFixture.mount(false));
  await expect.poll(() => button(page).count()).toBe(0);
  await page.evaluate(() => (window as unknown as { copyFixture: Fixture }).copyFixture.mount(true));
  await button(page).waitFor(); await settle(page, true);
  expect(await page.getByRole("status").textContent()).toBe("");
  expect(await button(page).getAttribute("aria-busy")).toBe("false");
  await button(page).click(); await settle(page, true);
  await expect.poll(() => button(page).textContent()).toContain(message("agentIntegration.copied"));
}));

it.each([320, 1366])("keeps the copy control usable and the selected example contained at %ipx", async width => fixture(async page => {
  const copy = button(page), box = await copy.boundingBox(); expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  await copy.focus(); expect(await copy.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await mode(page, "reject"); await page.keyboard.press("Enter");
  await expect.poll(() => page.getByRole("status").textContent()).toBe(setupCopy.common.copyFailed);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, `agent-copy-${width}-manual.png`), fullPage: true });
}, width));
