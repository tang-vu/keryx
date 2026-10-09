import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PAPER_CATALOG } from "../papers/catalog";
import copy from "../../locales/en/bibliographies.json";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", token = "1".repeat(64);
let browser: Browser, bundle: string;
beforeAll(async () => {
  const fixture = { version: 1, scope: "personal-bibliography", title: "PRIVATE LOCAL TITLE", question: "PRIVATE QUESTION", entries: [{ paper: PAPER_CATALOG[0],
    savedAt: "2026-10-09T00:00:00Z", screening: "include", notes: "PRIVATE SCREENING NOTES" }] };
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{BibliographiesView}from'./app/me/bibliographies/bibliographies-view';
    localStorage.setItem('keryx-literature-workspace-v1',${JSON.stringify(JSON.stringify(fixture))});
    window.auth=null;window.calls=[];window.stores={};window.delayCreate=false;window.held=[];
    window.fetch=async(url,init={})=>{const method=init.method||'GET',owner=init.headers['X-Keryx-Expected-Wallet'];
      window.calls.push({url:String(url),method,body:init.body,headers:init.headers});if(!String(url).startsWith('/api/me/bibliographies'))throw Error('Unexpected request');
      if(!window.auth||owner!==window.auth.address)return Response.json({},{status:409});
      if(method==='GET')return Response.json({bibliographies:window.stores[owner]||[]});
      if(method==='POST'){const input=JSON.parse(init.body),saved={id:${JSON.stringify(id)},title:input.title,count:input.papers.length,revision:1,createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z'};
        const respond=()=>{window.stores[owner]=[saved];return Response.json({bibliography:saved,urlPath:'/api/bibliographies/${token}.bib'},{status:201});};
        if(window.delayCreate)return new Promise(resolve=>window.held.push(()=>resolve(respond())));return respond();}
      if(method==='PUT'){const saved={...window.stores[owner][0],revision:2};window.stores[owner]=[saved];return Response.json({bibliography:saved});}
      if(method==='DELETE'){window.stores[owner]=[];return Response.json({revoked:true});}throw Error('Unexpected method');};
    createRoot(document.getElementById('root')).render(<BibliographiesView/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "explicit-owner-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}" :
        "import{useEffect,useState}from'react';export function useSiweAuth(){const[session,set]=useState(window.auth);useEffect(()=>{const update=()=>set(window.auth);window.addEventListener('fixture-auth',update);return()=>window.removeEventListener('fixture-auth',update)},[]);return{session}}" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
const signIn = (page: Page, address: string | null) => page.evaluate(address => {
  (window as unknown as { auth: unknown }).auth = address ? { address, role: "asker" } : null; window.dispatchEvent(new Event("fixture-auth"));
}, address);

it.each([320, 1366])("requires explicit create/update/revoke and withholds private workspace prose at %ipx", async width => {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  try {
    const external: string[] = [];
    await context.route("**/*", route => route.request().url() === "https://bibliographies.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }) : (external.push(route.request().url()), route.abort()));
    const page = await context.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
    await page.goto("https://bibliographies.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("link", { name: copy.signIn }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls)).toEqual([]);
    await signIn(page, alice); await page.getByText(copy.empty, { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.map(call => call.method))).toEqual(["GET"]);
    await page.getByLabel(copy.titleLabel, { exact: true }).fill("My owner review"); await page.getByRole("button", { name: copy.create, exact: true }).click();
    await page.getByLabel(copy.secretLabel, { exact: true }).waitFor(); expect(await page.getByLabel(copy.secretLabel).inputValue()).toBe(`https://bibliographies.test/api/bibliographies/${token}.bib`);
    expect(await page.locator(`a[href*="${token}"]`).count()).toBe(0);
    const posted = await page.evaluate(() => JSON.parse((window as unknown as { calls: { method: string; body: string }[] }).calls.find(call => call.method === "POST")!.body));
    expect(posted).toEqual({ title: "My owner review", papers: [PAPER_CATALOG[0]] }); expect(JSON.stringify(posted)).not.toContain("PRIVATE");
    await page.getByRole("button", { name: copy.replace, exact: true }).click(); await page.getByText(copy.updated, { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { calls: { method: string; headers: Record<string, string> }[] }).calls.find(call => call.method === "PUT")!.headers["If-Match"])).toBe('"1"');
    await page.getByRole("button", { name: copy.revoke, exact: true }).click(); await page.getByText(copy.revoked, { exact: true }).waitFor();
    expect(await page.getByLabel(copy.secretLabel).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { calls: { method: string; headers: Record<string, string> }[] }).calls.find(call => call.method === "DELETE")!.headers["If-Match"])).toBe('"2"');
    const raw = await page.evaluate(() => localStorage.getItem("keryx-literature-workspace-v1")!); expect(raw).toContain("PRIVATE SCREENING NOTES"); expect(raw).not.toContain(token);
    await signIn(page, null); await page.getByRole("link", { name: copy.signIn }).waitFor();
    expect(external).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("an old owner's delayed create response cannot reveal its one-time URL to a new owner", async () => {
  const context = await browser.newContext();
  try {
    await context.route("**/*", route => route.request().url() === "https://bibliographies.test/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
    const page = await context.newPage(); await page.goto("https://bibliographies.test/"); await page.addScriptTag({ content: bundle });
    await signIn(page, alice); await page.getByText(copy.empty, { exact: true }).waitFor();
    await page.evaluate(() => { (window as unknown as { delayCreate: boolean }).delayCreate = true; });
    await page.getByLabel(copy.titleLabel).fill("Alice private review"); await page.getByRole("button", { name: copy.create, exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
    await signIn(page, bob); await page.getByText(copy.empty, { exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { held: (() => void)[] }).held.shift()!());
    expect(await page.getByLabel(copy.secretLabel).count()).toBe(0); expect(await page.getByText("Alice private review").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.filter(call => call.method === "POST").length)).toBe(1);
  } finally { await context.close(); }
});
