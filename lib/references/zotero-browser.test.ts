import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PAPER_CATALOG } from "../papers/catalog";
import copy from "../../locales/en/zotero.json";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, token = "SYNTHETICKEY000000000001";
let browser: Browser, bundle: string;
const screenshotDirectory = mkdtempSync(join(tmpdir(), "keryx-zotero-ui-"));
beforeAll(async () => {
  const fixture = { version: 1, scope: "personal-bibliography", title: "PRIVATE REVIEW TITLE", question: "PRIVATE QUESTION", entries: [{ paper: PAPER_CATALOG[0], savedAt: "2026-10-11T00:00:00Z", screening: "include", notes: "PRIVATE PERSONAL NOTES" }] };
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ZoteroView}from'./app/me/references/zotero-view';
    localStorage.setItem('keryx-literature-workspace-v1',${JSON.stringify(JSON.stringify(fixture))});
    window.auth={address:${JSON.stringify(alice)}};window.calls=[];window.connected=false;window.holdConnect=false;window.held=[];window.listenerReady=false;
    window.fetch=async(url,init={})=>{const method=init.method||'GET',owner=init.headers['X-Keryx-Expected-Wallet'];window.calls.push({url:String(url),method,body:init.body,owner});
      if(!String(url).startsWith('/api/me/references/zotero'))throw Error('Unexpected request');
      if(method==='GET')return Response.json({connected:owner===${JSON.stringify(alice)}&&window.connected,userId:window.connected?'1234':null});
      if(method==='PUT'){const respond=()=>{window.connected=true;return Response.json({connected:true,userId:'1234'})};if(window.holdConnect)return new Promise(resolve=>window.held.push(()=>resolve(respond())));return respond();}
      if(method==='DELETE'){window.connected=false;return Response.json({revoked:true})}
      if(String(url).endsWith('/collections'))return Response.json({collections:[{key:'ABCD2345',name:'Chosen collection'}]});
      if(String(url).endsWith('/send'))return Response.json({references:1,writes:2,collection:'ABCD2345',provider:'zotero'});throw Error('Unexpected method');};
    createRoot(document.getElementById('root')).render(<ZoteroView/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "isolated-reference-account", setup(plugin) {
    plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}" :
      "import{useState,useEffect}from'react';export function useSiweAuth(){const[session,set]=useState(window.auth);useEffect(()=>{const listener=()=>set(window.auth);window.addEventListener('auth',listener);window.listenerReady=true;return()=>window.removeEventListener('auth',listener)},[]);return{session}}" }));
  } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  expect(dirname(screenshotDirectory)).toBe(resolve(tmpdir()));
  expect(screenshotDirectory.split(/[\\/]/).at(-1)).toMatch(/^keryx-zotero-ui-/);
  rmSync(screenshotDirectory, { recursive: true });
});
async function page(width = 1366, connected = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
  await page.route("https://fixture.example/**", route => route.fulfill({ contentType: "text/html", body: '<html><head><style>body{font:16px system-ui;margin:16px}input,select{display:block;max-width:100%;box-sizing:border-box;width:100%;padding:8px}button{padding:8px;margin:8px 8px 8px 0;min-height:44px}section>*{margin-bottom:16px}</style></head><body><main id="root"></main></body></html>' }));
  await page.goto("https://fixture.example/"); await page.addScriptTag({ content: bundle.replace("window.connected=false;", `window.connected=${connected};`) });
  await page.waitForFunction(() => (window as unknown as { listenerReady: boolean }).listenerReady);
  return { context, page };
}
it.each([320, 1366])("requires explicit connection, collection and send actions at %i pixels, excluding private prose", async width => {
  const f = await page(width);
  try {
    const key = f.page.getByLabel(copy.keyLabel); await key.waitFor({ state: "visible" });
    expect(await f.page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.map(call => call.method))).toEqual(["GET"]);
    await key.fill(token); await f.page.getByRole("button", { name: copy.connect, exact: true }).click();
    await f.page.getByRole("button", { name: copy.load }).waitFor({ state: "visible" });
    expect(await f.page.locator('input[type="password"]').count()).toBe(0);
    await f.page.getByRole("button", { name: copy.load }).click(); await f.page.getByLabel(copy.collection).selectOption("ABCD2345");
    f.page.on("dialog", dialog => dialog.accept()); await f.page.getByRole("button", { name: `${copy.saved} (1)`, exact: true }).click();
    await f.page.getByText(copy.sent, { exact: true }).waitFor();
    const calls = await f.page.evaluate(() => (window as unknown as { calls: { method: string; body?: string }[] }).calls);
    expect(calls.map(call => call.method)).toEqual(["GET", "PUT", "POST", "POST"]);
    const sent = JSON.parse(calls[3].body!); expect(sent).toEqual({ kind: "papers", collection: "ABCD2345", papers: [PAPER_CATALOG[0]] });
    expect(calls[3].body).not.toMatch(/PRIVATE REVIEW|PRIVATE QUESTION|PRIVATE PERSONAL/);
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await f.page.screenshot({ path: join(screenshotDirectory, `zotero-ui-${width}.png`), fullPage: true });
    await f.page.getByRole("button", { name: copy.disconnect }).click(); await f.page.getByText(copy.disconnected, { exact: true }).waitFor();
    expect(await f.page.getByLabel(copy.keyLabel).inputValue()).toBe(""); expect(await f.page.locator("select").count()).toBe(0);
    expect(await f.page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
  } finally { await f.context.close(); }
});
it("clears an entered key and withholds a delayed connection result after an account change", async () => {
  const f = await page();
  try {
    await f.page.getByLabel(copy.keyLabel).fill(token); await f.page.evaluate(() => { (window as unknown as { holdConnect: boolean }).holdConnect = true; });
    await f.page.getByRole("button", { name: copy.connect, exact: true }).click();
    await f.page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
    await f.page.evaluate(address => { (window as unknown as { auth: unknown }).auth = { address }; window.dispatchEvent(new Event("auth")); }, bob);
    await f.page.waitForFunction(address => (window as unknown as { calls: { owner: string }[] }).calls.some(call => call.owner === address), bob);
    await f.page.evaluate(() => { (window as unknown as { held: Array<() => void> }).held.splice(0).forEach(release => release()); });
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await f.page.getByLabel(copy.keyLabel).inputValue()).toBe(""); expect(await f.page.getByRole("button", { name: copy.load }).count()).toBe(0);
    expect(await f.page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
  } finally { await f.context.close(); }
});
