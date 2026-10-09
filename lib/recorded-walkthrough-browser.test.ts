import { build } from "esbuild";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { walkthroughMessages as messages } from "../locales/en/walkthrough";

it("recorded path works at phone/desktop width with no auto-fetch, GET-only integrity checking and unavailable fallback (isolated component)", async () => {
  const receipt = JSON.parse(readFileSync("fixtures/walkthrough/recorded-mainnet-receipt.json", "utf8"));
  const css = (await postcss([tailwind({ base: process.cwd() })]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
  const bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{RecordedWalkthrough}from'./components/keryx/recorded-walkthrough';
window.calls=[];window.fetch=async(path,init)=>{window.calls.push({path,method:init.method,credentials:init.credentials});
if(path!='/api/dispatch/b144ef47-c2f5-46ec-bdb7-e62bc1314913/receipt'||init.method!=='GET'||init.credentials!=='omit')throw Error('Unexpected authority');
if(window.unavailable)return new Response('Unavailable',{status:503});return Response.json(window.receipt);};
createRoot(document.getElementById('root')).render(<RecordedWalkthrough/>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  })).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try { for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route("**/*", route => route.request().url() === "https://recorded.example/" ? route.fulfill({ contentType: "text/html", body: '<main id="root" style="max-width:900px;margin:auto;padding:16px"></main>' }) : route.abort());
    const page = await context.newPage(); await page.goto("https://recorded.example/");
    await page.evaluate(value => { (window as unknown as { receipt: unknown }).receipt = value; }, receipt);
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: messages.start }).click();
    await page.getByRole("heading", { name: messages.steps[0].title }).waitFor();
    await page.getByRole("button", { name: messages.next }).click();
    await page.getByRole("heading", { name: messages.steps[1].title }).waitFor();
    await page.getByRole("button", { name: messages.next }).click();
    await page.getByRole("heading", { name: messages.steps[2].title }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls.length)).toBe(0);
    await page.getByRole("button", { name: messages.check }).click();
    await page.getByRole("status").getByText(messages.matched, { exact: true }).waitFor();
    await page.evaluate(() => { const f = window as unknown as { receipt: { payload: { dispatch: { answer: string } } } }; f.receipt.payload.dispatch.answer += '<img data-injection onerror=alert(1)>'; });
    await page.getByRole("button", { name: messages.check }).click();
    await page.getByRole("status").getByText(messages.changed, { exact: true }).waitFor();
    expect(await page.locator("[data-injection]").count()).toBe(0);
    await page.evaluate(() => { (window as unknown as { unavailable: boolean }).unavailable = true; });
    await page.getByRole("button", { name: messages.check }).click();
    await page.getByRole("status").getByText(messages.unavailable, { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.every(call => call.method === "GET"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: messages.finish }).click();
    await page.getByRole("heading", { name: messages.finished }).waitFor();
    await context.close();
  } } finally { await browser.close(); }
}, 60_000);
