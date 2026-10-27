import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { prepareWithdrawIntent } from "./withdraw-intent";
import { withdrawRequestSchema, withdrawTypedData, type WithdrawPolicy } from "./withdraw-protocol";
import { createWithdrawalRequest } from "./withdrawal-request";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en"), account = privateKeyToAccount(generatePrivateKey()), fixed = Date.now();
const policy: WithdrawPolicy = { owner: account.address, recipient: account.address, domain: 26, gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B", asset: "0x3600000000000000000000000000000000000000", maxValueMicros: "50000", maxFeeMicros: "2010000" };
type Fixture = { mode: string; mount(owner: string): void; revokes: string[]; handoffs: boolean[]; downloads: { text: string; name: string; connected: boolean }[] };
let browser: Browser, bundle: string, expected: string;
beforeAll(async () => {
  const burnIntent = withdrawRequestSchema.shape.burnIntent.parse(prepareWithdrawIntent(account.address, BigInt(50000)));
  const original = await createWithdrawalRequest({ burnIntent, signature: await account.signTypedData(withdrawTypedData(burnIntent)) }, policy);
  expected = JSON.stringify({ format: "keryx-withdrawal-recovery-v1", network: "eip155:5042002", recoveryOnly: true, exportedAt: new Date(fixed).toISOString(), original }, null, 2);
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{WithdrawalRecoveryPanel}from'./components/keryx/withdrawal-recovery-panel';import{importWithdrawalBrowserJournal}from'./lib/gateway/withdrawal-browser-journal';
    const root=createRoot(document.getElementById('root')),f=window.fixture={mode:'okay',revokes:[],handoffs:[],downloads:[],mount(owner){root.render(<WithdrawalRecoveryPanel address={owner}/>)}},blobs=new Map();let sequence=0;
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('SECRET_ELEMENT');return create(tag,...args)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('SECRET_URL');const id='blob:withdrawal/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('SECRET_CLICK');const url=this.href,blob=blobs.get(url),entry={text:'',name:this.download,connected:this.isConnected};f.downloads.push(entry);blob.text().then(text=>entry.text=text);setTimeout(()=>f.handoffs.push(!f.revokes.includes(url)),0)};
    importWithdrawalBrowserJournal(${JSON.stringify(original)},${JSON.stringify(account.address)}).then(()=>f.mount(${JSON.stringify(account.address)}));` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const button = (page: Page) => page.getByRole("button", { name: copy("withdrawalRecovery.download"), exact: true });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://withdrawal-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://withdrawal-download.test/"); await page.clock.setFixedTime(fixed); await page.addScriptTag({ content: bundle }); await button(page).waitFor(); await expect.poll(() => button(page).isEnabled()).toBe(true); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://withdrawal-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("SECRET_"); expect(await page.locator("a[download]").count()).toBe(0);
  } finally { await context.close(); }
}
it.each(["okay", "url", "element", "click"])("exports exact signed recovery bytes with cleanup through %s", async mode => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page).click();
  if (mode !== "okay") { await page.getByText(copy("withdrawalRecovery.unavailable"), { exact: true }).waitFor(); expect((await state(page)).downloads).toEqual([]); if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1); await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page).click(); }
  await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: "keryx-withdrawal-recovery.json", connected: false }); await expect.poll(async () => (await state(page)).handoffs).toEqual([true]); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "element" || mode === "click" ? 2 : 1);
}));
it("clears prior owner rows and errors on wallet change", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page).click(); await page.getByText(copy("withdrawalRecovery.unavailable"), { exact: true }).waitFor(); await page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture.mount("0x" + "c".repeat(40))); await page.getByText(copy("withdrawalRecovery.empty"), { exact: true }).waitFor(); expect(await button(page).count()).toBe(0); expect((await state(page)).downloads).toEqual([]);
}));
