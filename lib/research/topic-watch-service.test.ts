import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { localTopicWatchMetadata } from "./topic-watch-service";
import { PAPER_CATALOG } from "../papers/catalog";
import type { PaperRecord } from "../papers/types";
import type { TopicWatchMetadataRequest } from "./topic-watches";

it("local metadata is bounded and never reaches fetch, paid, search or model capabilities", async () => {
  const tripwire = vi.fn(() => { throw new Error("network reached"); }); vi.stubGlobal("fetch", tripwire);
  try {
    const batch = await localTopicWatchMetadata.read({ scope: "metadata-only", key: { ownerWallet: `0x${"a".repeat(40)}`, watchId: "watch" },
      checkId: "c".repeat(64), question: "transformer", keywords: ["transformer"], authors: [], venues: [], maximumRows: 2, deadlineAtMs: Date.now() + 1000 }) as { rows: unknown[] };
    expect(batch.rows.length).toBeLessThanOrEqual(2); expect(tripwire).not.toHaveBeenCalled();
    const source = readFileSync(new URL("./topic-watch-service.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(?:papers\/search|scholarly\/(?:provider|arxiv|crossref)|payments|llm|scheduler)["']/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  } finally { vi.unstubAllGlobals(); }
});

describe("constrained local catalog filtering before the finite row cap (authored, UNRUN)", () => {
  const rouge = "ROUGE: A Package for Automatic Evaluation of Summaries";
  const flash = "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness";
  async function read(keywords: string[], authors: string[], venues: string[], maximumRows: number) {
    const request: TopicWatchMetadataRequest = { scope: "metadata-only",
      key: { ownerWallet: `0x${"a".repeat(40)}`, watchId: "watch" }, checkId: "c".repeat(64),
      question: "Constrained local comparison", keywords, authors, venues, maximumRows, deadlineAtMs: Date.now() + 1000 };
    return await localTopicWatchMetadata.read(request) as {
      status: string; complete: boolean; rows: { state: string; record: PaperRecord }[];
    };
  }
  it("finds genuine catalog record 40 ROUGE by Chin-Yew Lin with keyword a and the UI default 32", async () => {
    expect(PAPER_CATALOG).toHaveLength(40); expect(PAPER_CATALOG[39].title).toBe(rouge);
    expect(PAPER_CATALOG.filter(record => record.title.toLowerCase().includes("a"))).toHaveLength(40);
    const batch = await read(["a"], ["Chin-Yew Lin"], [], 32);
    expect(batch.status).toBe("available"); expect(batch.complete).toBe(true);
    expect(batch.rows.map(row => row.record.title)).toEqual([rouge]);
    expect(batch.rows[0].record.authors).toEqual(["Chin-Yew Lin"]);
  });
  it("finds genuine Tri Dao attention metadata with limit 1 after earlier title matches", async () => {
    expect(PAPER_CATALOG[0].title).toBe("Attention Is All You Need");
    const batch = await read(["attention"], ["Tri Dao"], [], 1);
    expect(batch.rows.map(row => row.record.title)).toEqual([flash]);
    expect(batch.rows[0].record.authors).toContain("Tri Dao");
  });
  it.each([
    { author: "ＣＨＩＮ-ＹＥＷ  ＬＩＮ", venue: "ＴＥＸＴ  ＳＵＭＭＡＲＩＺＡＴＩＯＮ  ＢＲＡＮＣＨＥＳ  ＯＵＴ", title: rouge },
    { author: "Jaehyung Kim", venue: "ICLR 2024 poster", title: "SuRe: Summarizing Retrievals using Answer Candidates for Open-domain QA of LLMs" },
  ])("matches complete normalized author AND venue before cap 1: $title", async ({ author, venue, title }) => {
    const batch = await read(["Ａ"], [author], [venue], 1);
    expect(batch.status).toBe("available"); expect(batch.rows.map(row => row.record.title)).toEqual([title]);
    expect(batch.rows[0].state).toBe("observed");
  });
  it("applies an optional venue alone before cap 1", async () => {
    const batch = await read(["a"], [], ["Text Summarization Branches Out"], 1);
    expect(batch.rows.map(row => row.record.title)).toEqual([rouge]);
  });
  it.each([
    { authors: ["Chin-Yew Lin"], venues: ["ICLR 2024 poster"] },
    { authors: ["Lin"], venues: ["Text Summarization Branches Out"] },
    { authors: ["Chin-Yew Lin"], venues: ["Text Summarization"] },
  ])("returns no match for nonconjunctive or partial constraints: %j", async ({ authors, venues }) => {
    const batch = await read(["a"], authors, venues, 1);
    expect(batch).toMatchObject({ status: "empty", complete: true, rows: [] });
  });
});

describe("mounted manual watch controls in a real browser (authored, UNRUN)", () => {
  let browser: Browser, bundle: string;
  beforeAll(async () => {
    bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';import{createRoot}from'react-dom/client';import{TopicWatchManager}from'./components/keryx/topic-watch-manager';
      window.calls=[];window.rows=[];window.hold=false;window.held=[];
      window.holdBody=false;window.bodyHeld=[];window.bodyReleased=0;
      window.fetch=async(url,init={})=>{const method=init.method||'GET';window.calls.push({url:String(url),method,headers:init.headers,body:init.body});
        if(!String(url).startsWith('/api/me/topic-watches'))throw Error('Unexpected request');
        if(method==='GET')return Response.json({watches:window.rows});
        const body=init.body?JSON.parse(init.body):null;
        if(method==='POST'&&url==='/api/me/topic-watches'){
          const respond=()=>{window.rows.push({key:{ownerWallet:'0x'+'a'.repeat(40),watchId:body.watchId},spec:body,revision:1,status:'active',nextSlot:0,history:[]});
            const payload={result:{status:'created',paidRequests:0}};
            if(window.holdBody)return new Response(new ReadableStream({start(controller){window.bodyHeld.push(()=>{
              controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));controller.close();window.bodyReleased++;});}}),{headers:{'Content-Type':'application/json'}});
            return Response.json(payload)};
          return window.hold?new Promise(resolve=>window.held.push(()=>resolve(respond()))):respond();}
        const watch=window.rows[0];if(init.headers['If-Match']!=='"'+watch.revision+'"')return Response.json({error:'conflict'},{status:409});
        watch.revision++;
        if(method==='PUT')watch.spec=body;
        else if(method==='DELETE')watch.status='cancelled';
        else if(body.action==='pause')watch.status='paused';else if(body.action==='resume')watch.status='active';
        else if(body.action==='check'){watch.nextSlot++;watch.history.push({kind:'check',slot:0,status:'unchanged',newMatches:0})}
        return Response.json({result:{status:body?.action==='check'?'unchanged':'controlled',paidRequests:0}});
      };
      createRoot(document.getElementById('root')).render(<TopicWatchManager/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{ name: "watch-account-fixture", setup(plugin) {
        plugin.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
          ? "import React from 'react';export default function Link(props){return <a {...props}/>}"
          : "export function useSiweAuth(){return{session:{address:'0x'+'a'.repeat(40),role:'asker'}}}" }));
      } }] })).outputFiles[0].text;
    browser = await chromium.launch({ headless: true });
  }, 30000);
  afterAll(async () => { await browser?.close(); });
  async function sameOriginFixture(context: BrowserContext) {
    await context.route("**/*", route => {
      const url = route.request().url();
      return route.request().resourceType() === "document" &&
        (url === "https://watch284.invalid/editor" || url === "https://watch284.invalid/peer")
        ? route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><div id="root"></div>' })
        : route.abort();
    });
    const page = await context.newPage(); await page.goto("https://watch284.invalid/editor");
    await page.addScriptTag({ content: bundle }); await page.getByText("No private watches saved.").waitFor();
    return page;
  }
  it.each([360, 1366])("requires consent and actual clicks for create/edit/pause/resume/check/cancel at %ipx", async width => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    try {
      const page = await sameOriginFixture(context);
      expect(await page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.every(call => call.method === "GET"))).toBe(true);
      await page.getByLabel("Review question", { exact: true }).fill("PRIVATE review question");
      await page.getByLabel("Title keywords", { exact: false }).fill("transformer");
      await page.getByRole("button", { name: "Create watch", exact: true }).click();
      expect(await page.evaluate(() => (window as unknown as { rows: unknown[] }).rows.length)).toBe(0);
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByRole("button", { name: "Create watch", exact: true }).click();
      await page.getByRole("heading", { name: "PRIVATE review question" }).waitFor();
      await page.getByRole("button", { name: "Edit settings", exact: true }).click();
      await page.getByLabel("Review question", { exact: true }).fill("Edited private question");
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByRole("button", { name: "Save settings", exact: true }).click();
      await page.getByRole("heading", { name: "Edited private question" }).waitFor();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Check local metadata now" }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      await page.getByRole("button", { name: "Check local metadata now" }).click();
      await page.getByText("unchanged. Paid requests: 0.", { exact: true }).waitFor();
      expect(await page.getByRole("button", { name: "Edit settings" }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Cancel watch" }).click();
      await page.getByText("Cancellation is retained. This watch ID cannot be reused.").waitFor();
      expect(await page.getByRole("button", { name: "Cancel watch" }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { calls: { method: string; body?: string }[] }).calls.filter(call => call.method === "POST" && call.body?.includes('"action":"check"')).length)).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  }, 30000);
  it("discards a late same-wallet create response after the account authority event", async () => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await sameOriginFixture(context);
      await page.evaluate(() => { (window as unknown as { hold: boolean }).hold = true; });
      await page.getByLabel("Review question", { exact: true }).fill("LATE PRIVATE QUESTION");
      await page.getByLabel("Title keywords", { exact: false }).fill("transformer");
      await page.getByLabel("I consent", { exact: false }).check(); await page.getByRole("button", { name: "Create watch", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { held: unknown[] }).held.length === 1);
      await page.evaluate(() => { window.dispatchEvent(new Event("keryx:auth")); });
      await page.getByText("Account changed. Refresh to verify this session.").waitFor();
      await page.evaluate(() => { (window as unknown as { held: (() => void)[] }).held.splice(0).forEach(resolve => resolve()); });
      await page.waitForFunction(() => !(document.querySelector('button') as HTMLButtonElement).disabled);
      expect(await page.locator("body").textContent()).not.toContain("LATE PRIVATE QUESTION");
      expect(await page.getByLabel("Review question", { exact: true }).inputValue()).toBe("");
    } finally { await context.close(); }
  });
  it("native same-origin BroadcastChannel clears same-wallet drafts, consent, watches and results", async () => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await sameOriginFixture(context), peer = await context.newPage();
      await peer.goto("https://watch284.invalid/peer");
      expect(await page.evaluate(() => location.origin)).toBe("https://watch284.invalid");
      expect(await peer.evaluate(() => location.origin)).toBe("https://watch284.invalid");
      await page.getByLabel("Review question", { exact: true }).fill("BROADCAST PRIVATE WATCH");
      await page.getByLabel("Title keywords", { exact: false }).fill("transformer");
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByRole("button", { name: "Create watch", exact: true }).click();
      await page.getByRole("heading", { name: "BROADCAST PRIVATE WATCH" }).waitFor();
      await page.getByText("created. Paid requests: 0.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Edit settings", exact: true }).click();
      await page.getByLabel("Review question", { exact: true }).fill("BROADCAST PRIVATE DRAFT");
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByLabel("Show a quiet line", { exact: false }).check();
      const calls = await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls.length);
      await peer.evaluate(() => { const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close(); });
      await page.getByText("Account changed. Refresh to verify this session.").waitFor();
      expect(await page.getByLabel("Review question", { exact: true }).inputValue()).toBe("");
      expect(await page.getByLabel("Title keywords", { exact: false }).inputValue()).toBe("");
      expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
      expect(await page.getByLabel("Show a quiet line", { exact: false }).isChecked()).toBe(false);
      expect(await page.getByRole("heading", { name: "BROADCAST PRIVATE WATCH" }).count()).toBe(0);
      expect(await page.getByText("created. Paid requests: 0.", { exact: true }).count()).toBe(0);
      expect(await page.getByRole("heading", { name: "Edit unchecked watch" }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Create watch", exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { calls: unknown[] }).calls.length)).toBe(calls);
      await page.getByRole("button", { name: "Refresh watches", exact: true }).click();
      await page.getByRole("heading", { name: "BROADCAST PRIVATE WATCH" }).waitFor();
      expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
      expect(await page.getByText("created. Paid requests: 0.", { exact: true }).count()).toBe(0);
    } finally { await context.close(); }
  }, 30000);
  it.each(["broadcast", "focus"] as const)("discards a late same-wallet native response body after %s invalidation", async notification => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await sameOriginFixture(context), peer = await context.newPage();
      await peer.goto("https://watch284.invalid/peer");
      expect(await page.evaluate(() => location.origin)).toBe("https://watch284.invalid");
      expect(await peer.evaluate(() => location.origin)).toBe("https://watch284.invalid");
      await page.evaluate(() => { (window as unknown as { holdBody: boolean }).holdBody = true; });
      await page.getByLabel("Review question", { exact: true }).fill("LATE BODY PRIVATE QUESTION");
      await page.getByLabel("Title keywords", { exact: false }).fill("transformer");
      await page.getByLabel("I consent", { exact: false }).check();
      await page.getByRole("button", { name: "Create watch", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as { bodyHeld: unknown[] }).bodyHeld.length === 1);
      expect(await page.getByRole("button", { name: "Refresh watches", exact: true }).isDisabled()).toBe(true);
      if (notification === "broadcast") await peer.evaluate(() => {
        const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close();
      });
      else await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
      await page.getByText("Account changed. Refresh to verify this session.").waitFor();
      expect(await page.getByLabel("Review question", { exact: true }).inputValue()).toBe("");
      expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
      await page.evaluate(() => { (window as unknown as { bodyHeld: (() => void)[] }).bodyHeld.splice(0).forEach(release => release()); });
      await page.waitForFunction(() => !(document.querySelector('button') as HTMLButtonElement).disabled);
      expect(await page.evaluate(() => (window as unknown as { bodyReleased: number }).bodyReleased)).toBe(1);
      expect(await page.locator("body").textContent()).not.toContain("LATE BODY PRIVATE QUESTION");
      expect(await page.getByText("created. Paid requests: 0.", { exact: true }).count()).toBe(0);
      expect(await page.getByRole("button", { name: "Create watch", exact: true }).isDisabled()).toBe(true);
      expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
      expect(await page.evaluate(() => (window as unknown as { calls: { method: string }[] }).calls.filter(call => call.method === "GET").length)).toBe(1);
      await page.getByRole("button", { name: "Refresh watches", exact: true }).click();
      await page.getByRole("heading", { name: "LATE BODY PRIVATE QUESTION" }).waitFor();
      expect(await page.getByText("created. Paid requests: 0.", { exact: true }).count()).toBe(0);
      expect(await page.getByLabel("I consent", { exact: false }).isChecked()).toBe(false);
    } finally { await context.close(); }
  }, 30000);
});
