import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { PRIVATE_JOB_HISTORY_QUALIFICATION, privateJobHistoryCapabilities, privateJobHistoryExportSchema } from "./private-job-history-contract";
import { ownedHistoryCopy } from "@/locales/en/owned-history";

const wallet = "0x" + "a".repeat(40), copy = ownedHistoryCopy.privateJobs;
const envelope = { format: "private-job-history-v1", wallet, scope: "exact-payer-private-current-store", capabilities: privateJobHistoryCapabilities, qualification: PRIVATE_JOB_HISTORY_QUALIFICATION };
const list = { ...envelope, rows: [], nextCursor: null, scanLimited: false, scannedIntents: 0 };
const packet = privateJobHistoryExportSchema.parse({ ...envelope, rows: [], nextCursor: null, complete: true, truncated: false, pages: 1, bounds: { maxPages: 20, maxRows: 500, maxBytes: 2097152 } });
const fields = ["id", "createdAt", "intentCreatedAt", "savedAt", "question", "researchMode", "model", "provenance", "incomingSettlement", "ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"];
const metadata = { wallet, scope: packet.scope, complete: true, truncated: false, nextCursor: null, bounds: packet.bounds, capabilities: packet.capabilities, qualification: packet.qualification };
const csv = [["record", ...fields], ["metadata", JSON.stringify(metadata), ...Array(fields.length - 1).fill("")]].map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n") + "\r\n";
type Fixture = { mode: string; foreign: boolean; hold: boolean; release(): void; requests: { path: string; body: unknown; wallet: string | null }[]; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; type: string; connected: boolean }[] };
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{PrivateJobHistoryWorkspace}from'./components/keryx/private-job-history-workspace';
    const f=window.fixture={mode:'okay',foreign:false,hold:false,requests:[],revokes:[],handoffs:[],downloads:[]};const blobs=new Map();let sequence=0;
    window.fetch=async(path,init)=>{f.requests.push({path,body:JSON.parse(init.body),wallet:new Headers(init.headers).get('x-keryx-expected-wallet')});if(init.credentials!=='same-origin'||init.redirect!=='error'||init.referrerPolicy!=='no-referrer'||init.cache!=='no-store')throw Error('BAD_PRIVATE_CONTRACT');const exported=path==='/api/me/private-jobs/export';if(!exported&&path!=='/api/me/private-jobs')throw Error('BAD_PATH');if(exported&&f.hold)await new Promise(resolve=>f.release=resolve);return Response.json(exported?{...${JSON.stringify(packet)},...(f.foreign?{wallet:'0x'+'b'.repeat(40)}:{})}:${JSON.stringify(list)});};
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('SECRET_ELEMENT');return create(tag,...args)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('SECRET_URL');const id='blob:history/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('SECRET_CLICK');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,type:blob.type,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};createRoot(document.getElementById('root')).render(<PrivateJobHistoryWorkspace/>);` }, plugins: [{ name: "synthetic-auth", setup(b) { b.onResolve({ filter: /use-siwe-auth$/ }, () => ({ path: "auth", namespace: "auth" })); b.onLoad({ filter: /.*/, namespace: "auth" }, () => ({ contents: `const session={address:${JSON.stringify(wallet)},role:'asker'};export const useSiweAuth=()=>({session,address:session.address,isConnected:true,authState:'idle',refresh:async()=>session});` })); } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://history-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://history-download.test/"); await page.addScriptTag({ content: bundle }); await page.getByRole("button", { name: copy.actions.json, exact: true }).waitFor(); await expect.poll(async () => page.getByRole("button", { name: copy.actions.json, exact: true }).isEnabled()).toBe(true); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://history-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("SECRET_"); expect(await page.locator("a[download]").count()).toBe(0);
    expect((await state(page)).requests.every(request => request.wallet === wallet)).toBe(true); expect(await page.evaluate(() => localStorage.length)).toBe(0);
  } finally { await context.close(); }
}
it.each(["json", "csv"].flatMap(format => ["okay", "url", "element", "click"].map(mode => ({ format, mode }))))("hands off detached $format bytes with delayed cleanup after $mode", async ({ format, mode }) => fixture(async page => {
  const button = page.getByRole("button", { name: format === "json" ? copy.actions.json : copy.actions.csv, exact: true });
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button.click();
  if (mode !== "okay") { await page.getByRole("alert").waitFor(); expect((await state(page)).downloads).toEqual([]); if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1); await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await page.getByRole("button", { name: copy.actions.apply, exact: true }).click(); await button.click(); }
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(format === "json" ? JSON.stringify(packet) : csv); expect((await state(page)).downloads[0]).toMatchObject({ name: `keryx-private-job-history.${format}`, type: format === "json" ? "application/json" : "text/csv;charset=utf-8", connected: false }); await expect.poll(async () => (await state(page)).handoffs).toEqual([true]); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "click" || mode === "element" ? 2 : 1);
  expect((await state(page)).requests.at(-1)?.body).toEqual({ limit: 25, format: "json" });
}));
it("refuses foreign-wallet exports before allocating a private URL", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.foreign = true; }); await page.getByRole("button", { name: copy.actions.json, exact: true }).click(); await page.getByRole("alert").waitFor(); expect((await state(page)).downloads).toEqual([]); expect((await state(page)).revokes).toEqual([]);
}));
it("discards a held export after a same-tab authentication boundary", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.hold = true; }); await page.getByRole("button", { name: copy.actions.json, exact: true }).click(); await expect.poll(async () => (await state(page)).requests.length).toBe(2); await page.evaluate(() => window.dispatchEvent(new Event("keryx:auth"))); await page.getByText(copy.auth.waiting, { exact: true }).waitFor(); await page.evaluate(async () => { (window as unknown as { fixture: Fixture }).fixture.release(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }); expect((await state(page)).downloads).toEqual([]); expect((await state(page)).revokes).toEqual([]);
}));
