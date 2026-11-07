import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{TopicWatchManager}from'./components/keryx/topic-watch-manager';
    window.wallet=${JSON.stringify(owner)};window.calls=[];window.plans=[];window.held=[];window.mutations=[];
    window.failMutation=false;window.holdMutation=false;window.released=0;
    window.row=(question='Initial review',wallet=window.wallet)=>({key:{ownerWallet:wallet,watchId:'11111111-2222-4333-8444-555555555555'},
      spec:{watchId:'11111111-2222-4333-8444-555555555555',question,keywords:['transformer'],authors:[],venues:[],cadenceMs:86400000,
        periodMs:604800000,maximumChecksPerPeriod:7,maximumRowsPerCheck:32,maximumDigestItems:16,expiresAtMs:Date.now()+86400000,
        requestedCaps:{perCheckMicroUsdc:0,perPeriodMicroUsdc:0},consent:{manualMetadata:true,emptyHeartbeat:false}},
      revision:1,status:'active',nextSlot:0,history:[]});
    window.rows=[window.row()];
    window.fetch=async(url,init={})=>{
      const method=init.method||'GET';window.calls.push({url:String(url),method,headers:init.headers,body:init.body});
      if(!String(url).startsWith('/api/me/topic-watches'))throw Error('Unexpected endpoint');
      if(init.headers['x-keryx-expected-wallet']!==window.wallet)return Response.json({error:'owner mismatch'},{status:409});
      if(method==='GET'){
        const plan=window.plans.shift()||'immediate',payload=JSON.stringify({watches:window.rows});
        if(plan==='latest-error')return Response.json({error:'LATEST_LIST_ERROR'},{status:503});
        if(plan==='response')return new Promise(resolve=>window.held.push(()=>{window.released++;resolve(new Response(payload));}));
        if(plan==='body'||plan==='body-error')return new Response(new ReadableStream({start(controller){window.held.push(()=>{
          window.released++;if(plan==='body-error')controller.error(Error('STALE_LIST_ERROR'));
          else{controller.enqueue(new TextEncoder().encode(payload));controller.close();}});}}));
        return new Response(payload);
      }
      if(window.failMutation){window.failMutation=false;throw Error('CURRENT_MUTATION_FAILURE');}
      const respond=()=>{const watch=window.rows[0];
        if(init.headers['If-Match']!=='"'+watch.revision+'"')return Response.json({error:'revision conflict'},{status:409});
        const body=init.body?JSON.parse(init.body):null;watch.revision++;
        if(method==='PUT')watch.spec=body;else if(method==='DELETE')watch.status='cancelled';
        else if(body.action==='pause')watch.status='paused';else throw Error('Unexpected mutation');
        return Response.json({result:{status:'controlled',paidRequests:0}});};
      if(window.holdMutation)return new Promise(resolve=>window.mutations.push(()=>resolve(respond())));
      return respond();
    };
    createRoot(document.getElementById('root')).render(<TopicWatchManager/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "watch-owner-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? "import React from'react';export default function Link(props){return <a {...props}/>;}"
        : "import{useEffect,useState}from'react';export function useSiweAuth(){const[wallet,setWallet]=useState(window.wallet);useEffect(()=>{const change=()=>setWallet(window.wallet);window.addEventListener('fixture-owner',change);return()=>window.removeEventListener('fixture-owner',change);},[]);return{session:{address:wallet,role:'asker'}};}" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

type Harness = { wallet: string; rows: Array<{ spec: { question: string }; revision: number }>; row(question: string, wallet?: string): Harness["rows"][number];
  plans: string[]; held: Array<() => void>; mutations: Array<() => void>; failMutation: boolean; holdMutation: boolean;
  calls: Array<{ method: string; headers: Record<string, string>; body?: string }> };
async function mount() {
  const context = await browser.newContext({ serviceWorkers: "block" }), errors: string[] = [];
  await context.route("**/*", route => route.request().resourceType() === "document" && route.request().url() === "https://watch-refresh.test/editor"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://watch-refresh.test/editor"); await page.addScriptTag({ content: bundle });
  await page.getByRole("heading", { name: "Initial review", exact: true }).waitFor();
  return { context, page, errors };
}
async function holdRefresh(page: Page, plan = "body") {
  await page.evaluate(plan => (window as unknown as Harness).plans.push(plan), plan);
  await page.getByRole("button", { name: "Refresh watches", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as Harness).held.length === 1);
}
async function release(page: Page) {
  await page.evaluate(async () => {
    (window as unknown as Harness).held.shift()!();
    // Resolve the response/body and allow the mounted React tree to commit.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as Harness).calls);

it.each(["response", "body"])("keeps the newer list after an older %s finishes", async phase => {
  const { context, page, errors } = await mount();
  try {
    await holdRefresh(page, phase);
    await page.evaluate(() => { const f = window as unknown as Harness; f.rows = [f.row("Latest review")]; });
    await page.getByRole("button", { name: "Refresh watches", exact: true }).click();
    await page.getByRole("heading", { name: "Latest review", exact: true }).waitFor(); await release(page);
    expect(await page.getByRole("heading", { name: "Latest review", exact: true }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "Initial review", exact: true }).count()).toBe(0);
    expect((await calls(page)).map(call => call.method)).toEqual(["GET", "GET", "GET"]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("ignores a stale read error after a newer successful list", async () => {
  const { context, page } = await mount();
  try {
    await holdRefresh(page, "body-error");
    await page.evaluate(() => { const f = window as unknown as Harness; f.rows = [f.row("Latest review")]; });
    await page.getByRole("button", { name: "Refresh watches", exact: true }).click();
    await page.getByRole("heading", { name: "Latest review", exact: true }).waitFor(); await release(page);
    expect(await page.getByRole("heading", { name: "Latest review", exact: true }).count()).toBe(1);
    expect(await page.getByRole("alert").count()).toBe(0); expect((await calls(page)).length).toBe(3);
  } finally { await context.close(); }
});
it("retains the newest list failure when an older success arrives", async () => {
  const { context, page } = await mount();
  try {
    await holdRefresh(page); await page.evaluate(() => (window as unknown as Harness).plans.push("latest-error"));
    await page.getByRole("button", { name: "Refresh watches", exact: true }).click(); await page.getByRole("alert").waitFor(); await release(page);
    expect(await page.getByRole("alert").textContent()).toContain("LATEST_LIST_ERROR");
    expect(await page.getByRole("heading", { name: "Initial review", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Create watch", exact: true }).isDisabled()).toBe(true);
    expect((await calls(page)).length).toBe(3);
  } finally { await context.close(); }
});

it.each(["pause", "cancel", "save"].flatMap(action => ["body", "body-error"].map(plan => ({ action, plan }))))("preserves accepted $action after an older $plan arrives", async ({ action, plan }) => {
  const { context, page } = await mount();
  try {
    await holdRefresh(page, plan);
    if (action === "save") {
      await page.getByRole("button", { name: "Edit settings", exact: true }).click();
      await page.getByLabel("Review question", { exact: true }).fill("Saved review");
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByRole("button", { name: "Save settings", exact: true }).click();
      await page.getByRole("heading", { name: "Saved review", exact: true }).waitFor();
    } else {
      await page.getByRole("button", { name: action === "pause" ? "Pause" : "Cancel watch", exact: true }).click();
      if (action === "pause") await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
      else await page.getByText("Cancellation is retained. This watch ID cannot be reused.").waitFor();
    }
    await page.getByText("controlled. Paid requests: 0.", { exact: true }).waitFor(); await release(page);
    if (action === "save") expect(await page.getByRole("heading", { name: "Saved review", exact: true }).count()).toBe(1);
    else if (action === "pause") expect(await page.getByRole("button", { name: "Resume", exact: true }).count()).toBe(1);
    else expect(await page.getByRole("button", { name: "Cancel watch", exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole("alert").count()).toBe(0);
    expect(await page.getByText("controlled. Paid requests: 0.", { exact: true }).count()).toBe(1);
    const requests = await calls(page), writes = requests.filter(call => call.method !== "GET");
    expect(writes).toHaveLength(1); expect(writes[0].headers["If-Match"]).toBe('"1"');
    expect(requests.filter(call => call.method === "GET")).toHaveLength(3);
    expect(requests.every(call => call.headers["x-keryx-expected-wallet"] === owner)).toBe(true);
  } finally { await context.close(); }
});

it("invalidates a pending read as soon as a mutation starts, before its acknowledgement", async () => {
  const { context, page } = await mount();
  try {
    await page.evaluate(() => { const f = window as unknown as Harness; f.rows = [f.row("Older server snapshot")]; f.holdMutation = true; });
    await holdRefresh(page); await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as Harness).mutations.length === 1); await release(page);
    expect(await page.getByRole("heading", { name: "Initial review", exact: true }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "Older server snapshot", exact: true }).count()).toBe(0);
    await page.evaluate(() => (window as unknown as Harness).mutations.shift()!());
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    expect((await calls(page)).filter(call => call.method !== "GET")).toHaveLength(1);
  } finally { await context.close(); }
});
it("does not let an older successful read clear a current mutation failure", async () => {
  const { context, page } = await mount();
  try {
    await holdRefresh(page); await page.evaluate(() => { (window as unknown as Harness).failMutation = true; });
    await page.getByRole("button", { name: "Pause", exact: true }).click(); await page.getByRole("alert").waitFor(); await release(page);
    expect(await page.getByRole("alert").textContent()).toContain("CURRENT_MUTATION_FAILURE");
    expect((await calls(page)).map(call => call.method)).toEqual(["GET", "GET", "POST"]);
  } finally { await context.close(); }
});

it.each(["focus", "keryx:auth"])("keeps private drafts and rows cleared after %s even when a read finishes later", async event => {
  const { context, page } = await mount();
  try {
    await page.getByLabel("Review question", { exact: true }).fill("PRIVATE unsaved watch draft");
    await page.getByLabel("I consent", { exact: false }).check(); await holdRefresh(page);
    await page.evaluate(event => window.dispatchEvent(new Event(event)), event); await page.getByRole("alert").waitFor(); await release(page);
    expect(await page.getByLabel("Review question", { exact: true }).inputValue()).toBe("");
    expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
    expect(await page.getByRole("heading", { name: "Initial review", exact: true }).count()).toBe(0);
    expect(await page.getByRole("alert").textContent()).toBe("Account changed. Refresh to verify this session.");
    expect((await calls(page)).length).toBe(2);
  } finally { await context.close(); }
});
it("cannot restore the previous wallet's rows after an owner switch", async () => {
  const { context, page } = await mount();
  try {
    await holdRefresh(page);
    await page.evaluate(wallet => { const f = window as unknown as Harness; f.wallet = wallet; f.rows = [f.row("Other owner review", wallet)]; window.dispatchEvent(new Event("fixture-owner")); }, other);
    await page.getByRole("heading", { name: "Other owner review", exact: true }).waitFor(); await release(page);
    expect(await page.getByRole("heading", { name: "Other owner review", exact: true }).count()).toBe(1);
    expect(await page.getByRole("heading", { name: "Initial review", exact: true }).count()).toBe(0);
    expect(await page.getByLabel("Review question", { exact: true }).inputValue()).toBe("");
    expect((await calls(page)).map(call => call.headers["x-keryx-expected-wallet"])).toEqual([owner, owner, other]);
  } finally { await context.close(); }
});
