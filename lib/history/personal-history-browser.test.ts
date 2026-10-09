import { build } from "esbuild";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { expect, it } from "vitest";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
it("current browse with authored PostCSS renders safe text, binds filters/pages and rejects old-owner responses (not Next build)", async () => {
  // Actual authored utilities; default hosted Next build remains a separate required gate.
  const css = (await postcss([tailwind({ base: process.cwd() })]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
  const bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{CurrentHistoryPane}from'./app/me/asks/current-history-view';
window.owner=${JSON.stringify(alice)};window.calls=[];window.held=[];window.fetch=async(raw,init)=>{
const url=new URL(raw,location.origin),owner=window.owner;if(url.pathname!='/api/me/history'||init.headers['X-Keryx-Expected-Wallet']!==owner)throw Error('Unexpected authority');
window.calls.push({query:Object.fromEntries(url.searchParams),owner});const row={id:owner===${JSON.stringify(alice)}?'alice':'bob',createdAt:'2026-10-09T12:00:00.000Z',question:owner===${JSON.stringify(alice)}?'<img data-injection onerror=alert(1)>':'Bob private question',provenance:null,funding:'other-or-unknown',recordedSpendUsdc:0.1,recordedCreatorAllocationUsdc:0.04,paymentMode:'offline',isFollowUp:false};
const result={version:1,wallet:owner,scope:'attributed-current-store',storeNetwork:'eip155:5042002',rows:[row],nextCursor:url.searchParams.has('cursor')?null:'synthetic_cursor'};
if(window.delay){window.delay=false;return new Promise(resolve=>window.held.push(()=>resolve(Response.json(result))));}return Response.json(result);};
createRoot(document.getElementById('root')).render(<CurrentHistoryPane/>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "isolated-history-auth", setup(plugin) {
      plugin.onResolve({ filter: /use-siwe-auth$/ }, () => ({ path: "auth", namespace: "fixture-auth" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture-auth" }, () => ({ resolveDir: process.cwd(), loader: "js", contents: "import{useState,useEffect}from'react';export function useSiweAuth(){const[owner,setOwner]=useState(window.owner);useEffect(()=>{const update=()=>setOwner(window.owner);window.addEventListener('fixture-owner',update);return()=>window.removeEventListener('fixture-owner',update)},[]);return{session:owner?{address:owner}:null}}" }));
      plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture-link" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture-link" }, () => ({ resolveDir: process.cwd(), loader: "js", contents: "import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children)}" }));
    } }],
  })).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try { for (const width of [412, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route("**/*", route => route.request().url() === "https://synthetic.example/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
    const page = await context.newPage(); await page.goto("https://synthetic.example/"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.getByRole("link", { name: "<img data-injection onerror=alert(1)>", exact: true }).waitFor(); expect(await page.locator("[data-injection]").count()).toBe(0);
    await page.getByLabel("Question contains (case sensitive)").fill("%_"); await page.getByLabel("Surface", { exact: true }).selectOption("api"); await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await page.getByRole("button", { name: "Older page", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { calls: { query: { cursor?: string } }[] }).calls.at(-1)?.query.cursor === "synthetic_cursor");
    const call = await page.evaluate(() => (window as unknown as { calls: { query: Record<string, string> }[] }).calls.at(-1)); expect(call?.query).toMatchObject({ search: "%_", surface: "api", cursor: "synthetic_cursor" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const switchOwner = (owner: string | null) => page.evaluate(value => { const fixture = window as unknown as { owner: string | null }; fixture.owner = value; window.dispatchEvent(new Event("fixture-owner")); }, owner);
    await switchOwner(bob); await page.getByRole("link", { name: "Bob private question", exact: true }).waitFor(); expect(await page.getByRole("link", { name: "<img data-injection onerror=alert(1)>", exact: true }).count()).toBe(0);
    await page.evaluate(() => { (window as unknown as { delay: boolean }).delay = true; }); await switchOwner(alice);
    await page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1); await switchOwner(bob); await page.getByRole("link", { name: "Bob private question", exact: true }).waitFor();
    await page.evaluate(() => { (window as unknown as { held: (() => void)[] }).held.splice(0).forEach(release => release()); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); expect(await page.getByRole("link", { name: "<img data-injection onerror=alert(1)>", exact: true }).count()).toBe(0);
    await switchOwner(null); await page.getByText("Sign in to browse your attributed history.", { exact: true }).waitFor(); expect(await page.getByRole("link", { name: "Bob private question", exact: true }).count()).toBe(0);
    await context.close();
  } } finally { await browser.close(); }
}, 60000);
