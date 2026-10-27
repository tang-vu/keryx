import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { createMessages } from "../i18n/messages";
import { monthlyQuoteSchema, monthlyRecoveryFile } from "../monthly/protocol";
import { BUYER_PROFILE } from "./protocol";

const copy = createMessages("en"), payer = "0x" + "a".repeat(40), monthlyId = "monthly_" + "1".repeat(64);
const quote = monthlyQuoteSchema.parse({ plan: "research-monthly-v1", requests: 4, termDays: 30, researchMode: "deep", packageVersion: "1.0.0", creatorBudgetMicros: 50000, serviceFeeMicros: 160000, totalMicros: 360000, separateTotalMicros: 400000, roundingMicros: 0, payee: "0x" + "b".repeat(40), network: BUYER_PROFILE.networkId, quoteId: "2".repeat(64) });
const request = { monthlyId, requestId: "00000000-0000-4000-8000-000000000001", question: "What evidence supports this synthetic claim?", payer };
type Fixture = { mode: string; signs: number; http: number; paid: number; intent: unknown; revokes: string[]; downloads: { text: string; name: string; connected: boolean }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ResearchMonthly}from'./components/keryx/research-monthly';import{BUYER_PROFILE,authorizationWithNonce}from'./lib/buyer/protocol';import{monthlyStorageKeys}from'./lib/monthly/local-recovery';
    const f=window.fixture={mode:'okay',signs:0,http:0,paid:0,revokes:[],downloads:[]},blobs=new Map();let sequence=0;const payer=${JSON.stringify(payer)},quote=${JSON.stringify(quote)},keys=monthlyStorageKeys(BUYER_PROFILE,payer);
    const requirement={scheme:'exact',network:BUYER_PROFILE.networkId,asset:BUYER_PROFILE.usdcAddress,amount:'360000',payTo:quote.payee,maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:BUYER_PROFILE.gatewayWallet}};
    const authorization=authorizationWithNonce(payer,requirement,'0x'+'3'.repeat(64));f.intent={schema:'keryx-monthly-intent-v1',monthlyId:${JSON.stringify(monthlyId)},quote,authorization};
    if(!window.empty){localStorage.setItem(keys.last,JSON.stringify(f.intent.monthlyId));localStorage.setItem(keys.intent(f.intent.monthlyId),JSON.stringify({intent:f.intent,state:'prepared'}));localStorage.setItem(keys.request,JSON.stringify(${JSON.stringify(request)}));}
    window.fetch=async(url,init)=>{f.http++;if(new Headers(init.headers).has('payment-signature')){f.paid++;throw Error('UNEXPECTED_PAID')}if(url!=='https://keryx.cc/api/research/monthly'||init.method!=='POST')throw Error('BAD_TRANSPORT');return new Response('{}',{status:402,headers:{'payment-required':btoa(JSON.stringify({x402Version:2,resource:{url:'/api/research/monthly'},accepts:[requirement]})),'x-keryx-monthly-authorization':JSON.stringify(authorization),'x-keryx-monthly-expires':String(Math.floor(Date.now()/1000)+600)}})};
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('SECRET_ELEMENT');return create(tag,...args)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('SECRET_URL');const id='blob:monthly/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('SECRET_CLICK');const blob=blobs.get(this.href),entry={text:'',name:this.download,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<ResearchMonthly quote={quote}/>);` }, plugins: [{ name: "unfunded-wallet", setup(b) {
    b.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wallet", namespace: "fixture" }));
    b.onResolve({ filter: /buyer\/connected-wallet$/ }, () => ({ path: "connected", namespace: "fixture" }));
    b.onResolve({ filter: /^\.\/(wallet-picker|research-funding|research-job|research-job-target)$/ }, () => ({ path: "leaves", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "wallet" ? `const wallet={getAddresses:async()=>[${JSON.stringify(payer)}],getChainId:async()=>${BUYER_PROFILE.chainId}};export const useAccount=()=>({address:${JSON.stringify(payer)},chainId:${BUYER_PROFILE.chainId}});export const useWalletClient=()=>({data:wallet});` : path === "connected" ? `export const connectedBuyerWallet=()=>({readWallet:async()=>({address:${JSON.stringify(payer)},chainId:${BUYER_PROFILE.chainId},gatewayBalanceMicros:'1000000'}),sign:async()=>{window.fixture.signs++;throw Error('UNEXPECTED_SIGNATURE')}});` : "export const WalletPicker=()=>null,ResearchFunding=()=>null,ResearchJob=()=>null,ResearchJobTarget=()=>null;" }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
async function fixture(test: (page: Page) => Promise<void>, empty = false) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://monthly-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://monthly-download.test/"); await page.evaluate(empty => { Object.assign(window, { empty }); }, empty); await page.addScriptTag({ content: bundle }); await page.getByRole("heading", { name: copy("monthlyResearch.title"), exact: true }).waitFor(); if (!empty) await page.getByRole("button", { name: copy("monthlyResearch.downloadPurchase"), exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://monthly-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("SECRET_"); expect((await state(page)).signs).toBe(0); expect((await state(page)).paid).toBe(0); expect(await page.locator("a[download]").count()).toBe(0);
  } finally { await context.close(); }
}
it.each(["purchase", "request"].flatMap(kind => ["url", "element", "click"].map(mode => ({ kind, mode }))))("recovers explicit $kind $mode failures without signing and retries exact bytes", async ({ kind, mode }) => fixture(async page => {
  const button = page.getByRole("button", { name: copy(kind === "purchase" ? "monthlyResearch.downloadPurchase" : "monthlyResearch.downloadRequest"), exact: true });
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button.click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button.click(); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(JSON.stringify(kind === "purchase" ? (await state(page)).intent : monthlyRecoveryFile(request), null, 2) + "\n"); expect((await state(page)).downloads[0]).toMatchObject({ name: "keryx-monthly-recovery.json", connected: false }); expect((await state(page)).http).toBe(0); expect(await page.getByText("Download unavailable. Try again.", { exact: true }).count()).toBe(0); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "url" ? 1 : 2);
}));
it.each(["url", "click"])("stops the actual purchase client before signing when mandatory recovery export fails at %s", async mode => fixture(async page => {
  await page.getByRole("checkbox").check(); await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await page.getByRole("button", { name: copy("monthlyResearch.buy", { amount: "0.360000" }), exact: true }).click(); await page.getByText("Download unavailable. Try again.", { exact: true }).waitFor(); expect((await state(page)).http).toBe(1); expect((await state(page)).downloads).toEqual([]); const saved = await page.evaluate(() => Object.values(localStorage).map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(value => value?.state)); expect(saved).toHaveLength(1); expect(saved[0].state).toBe("prepared");
}, true));
