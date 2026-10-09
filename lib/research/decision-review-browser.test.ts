import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import copy from "../../locales/en/decision-reviews.json";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null, id, runId, round: 0, ordinal: 0,
  sourceName: "ALICE PRIVATE SOURCE", modelAction: "BUY", codeAction: "BUY", codeRule: "selected", initialCodeAction: "BUY", initialCodeRule: "selected",
  terms: { assetId: "asset", sourceId: "source", owned: true, network: "eip155:5042002", payTo: alice, priceMicroUsdc: "1", listPriceMicroUsdc: "1", citationBudgetMicroUsdc: "5" },
  reviewFirst: true, cohort: "unknown", cohortEvidence: null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), state: "held", verdict: null };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DecisionReviews}from'./components/keryx/decision-reviews';
    window.auth=null;window.ready=false;window.committedOwner=null;window.calls=[];window.held=[];window.consumed=[];window.delay=false;window.loseAck=false;window.record=${JSON.stringify(record)};
    window.fetch=async(url,init)=>{const owner=init.headers['X-Keryx-Expected-Wallet'],method=init.method||'GET';window.calls.push({owner,method,body:init.body,signal:init.signal,credentials:init.credentials});
      if(!String(url).startsWith('/api/me/decision-reviews'))throw Error('Unexpected request');
      const respond=(value)=>new Response(new ReadableStream({pull(controller){window.consumed.push(owner);controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();}}),{headers:{'Content-Type':'application/json'}});
      if(method==='GET'){const result={reviews:owner===${JSON.stringify(alice)}?[window.record]:[]};if(window.delay&&owner===${JSON.stringify(alice)})return new Promise(resolve=>window.held.push(()=>resolve(respond(result))));return respond(result);}
      const input=JSON.parse(init.body);window.record={...window.record,state:'consumed',verdict:{value:input.value,context:input.context,codeAction:window.record.codeAction,codeRule:window.record.codeRule,createdAt:new Date().toISOString(),reason:input.reason}};
      if(window.loseAck){window.loseAck=false;window.emitRecord(window.record);throw Error('Lost acknowledgement');}return respond({review:window.record});};
    function Probe(){const[incoming,set]=useState();window.emitRecord=r=>set([r]);return <DecisionReviews runId=${JSON.stringify(runId)} records={incoming} capturedOwner=${JSON.stringify(alice)} live/>;}
    createRoot(document.getElementById('root')).render(<Probe/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "explicit-owner-only", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? "import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}" :
        "import{useEffect,useState}from'react';export function useSiweAuth(){const[session,set]=useState(window.auth);useEffect(()=>{const update=()=>set(window.auth);window.addEventListener('auth',update);window.ready=true;return()=>{window.ready=false;window.removeEventListener('auth',update)}},[]);useEffect(()=>{window.committedOwner=session?.address??null},[session]);return{session}}" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function signIn(page: Page, address: string) {
  await page.waitForFunction(() => (window as unknown as { ready: boolean }).ready);
  await page.evaluate(address => { (window as unknown as { auth: unknown }).auth = { address }; window.dispatchEvent(new Event("auth")); }, address);
  await page.waitForFunction(address => (window as unknown as { committedOwner: string }).committedOwner === address, address);
}
async function fixture(width = 1366) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" }), external: string[] = [];
  await context.route("**/*", route => route.request().url() === "https://reviews.test/" ? route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>' }) : (external.push(route.request().url()), route.abort()));
  const page = await context.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://reviews.test/"); await page.addScriptTag({ content: bundle }); await page.getByRole("link", { name: copy.signedOut }).waitFor();
  return { context, page, external, errors };
}
it.each([320, 1366])("requires explicit owner requests and retries lost ACK with the exact original gate intent at %ipx", async width => {
  const f = await fixture(width);
  try {
    expect(await f.page.evaluate(() => (window as unknown as { calls: unknown[] }).calls)).toEqual([]);
    await signIn(f.page, alice); await f.page.getByRole("button", { name: copy.load, exact: true }).click(); await f.page.getByText(record.sourceName, { exact: true }).waitFor();
    await f.page.getByLabel(copy.reason).fill("PRIVATE REASON"); await f.page.evaluate(() => { (window as unknown as { loseAck: boolean }).loseAck = true; });
    await f.page.getByRole("button", { name: copy.agree, exact: true }).click(); await f.page.getByText(copy.failed, { exact: true }).waitFor();
    await f.page.getByRole("button", { name: copy.retry, exact: true }).click(); await f.page.getByText(copy.saved, { exact: true }).waitFor();
    const posts = await f.page.evaluate(() => (window as unknown as { calls: { method: string; body: string; credentials: string }[] }).calls.filter(call => call.method === "POST"));
    expect(posts).toHaveLength(2); expect(posts[0].body).toBe(posts[1].body); expect(JSON.parse(posts[1].body)).toMatchObject({ id, context: "gate", value: "agree", reason: "PRIVATE REASON" });
    expect(posts.every(call => call.credentials === "same-origin")).toBe(true); expect(await f.page.getByText(copy.waiting, { exact: true }).count()).toBe(0);
    expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
}, 10000);
it("discards an old owner's delivered private response after a committed owner switch", async () => {
  const f = await fixture();
  try {
    await signIn(f.page, alice); await f.page.evaluate(() => { (window as unknown as { delay: boolean }).delay = true; });
    await f.page.getByRole("button", { name: copy.load, exact: true }).click();
    await f.page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
    await signIn(f.page, bob); await f.page.getByRole("button", { name: copy.load, exact: true }).click(); await f.page.getByText(copy.empty, { exact: true }).waitFor();
    expect(await f.page.evaluate(alice => (window as unknown as { calls: { owner: string; signal: AbortSignal }[] }).calls.find(call => call.owner === alice)!.signal.aborted, alice)).toBe(true);
    await f.page.evaluate(() => (window as unknown as { held: (() => void)[] }).held.shift()!());
    await f.page.waitForFunction(alice => (window as unknown as { consumed: string[] }).consumed.includes(alice), alice);
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await f.page.getByText(record.sourceName, { exact: true }).count()).toBe(0); expect(f.errors).toEqual([]); expect(f.external).toEqual([]);
  } finally { await f.context.close(); }
}, 10000);
