import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseEvidenceProcurement, type EvidenceProcurementPacket } from "./contracts";
import { procurementRequestHash, procurementOfferMessage } from "./engine";
import { evidenceProcurementCopy as copy } from "./copy";

const signer = privateKeyToAccount(generatePrivateKey());
const packet: EvidenceProcurementPacket = { version: 1, scope: "private-evidence-procurement", request: { id: "synthetic-request", network: "eip155:5042002", decision: "Synthetic private comparison", budgetMicroUsdc: "100000", expiresAt: "2080-01-01T00:00:00Z", requirements: [{ id: "rate", question: "Observed request limit", priority: 8, status: "missing" }] }, offers: [], selectedOfferIds: [], deliveries: [], reviews: [] };
type Fixture = { mode: string; revokes: string[]; downloads: { text: string; name: string; type: string }[] };
let browser: Browser, bundle: string, expected: string;
beforeAll(async () => {
  const offer = { id: "one", requestHash: procurementRequestHash(packet.request), providerWallet: signer.address, sourceUrl: "https://provider.example/report", deliverable: "Retained exact excerpts", priceMicroUsdc: "50000", requirementIds: ["rate"], expiresAt: "2079-12-31T00:00:00Z", nonce: "nonce-one", signature: "" };
  offer.signature = await signer.signMessage({ message: procurementOfferMessage(packet.request, offer) }); packet.offers = [offer]; packet.selectedOfferIds = [offer.id]; expected = JSON.stringify(parseEvidenceProcurement(packet));
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{EvidenceProcurementWorkspace}from'./components/keryx/evidence-procurement-workspace';
    const blobs=new Map();let sequence=0;const f=window.fixture={mode:'okay',downloads:[],revokes:[]};
    const create=document.createElement.bind(document);document.createElement=function(tag,...args){if(tag==='a'&&f.mode==='element')throw Error('PRIVATE_ELEMENT_DETAIL');return create(tag,...args)};
    URL.createObjectURL=blob=>{if(f.mode==='url')throw Error('PRIVATE_URL_DETAIL');const id='blob:procurement/'+(++sequence);blobs.set(id,blob);return id};URL.revokeObjectURL=id=>f.revokes.push(id);
    HTMLAnchorElement.prototype.click=function(){if(f.mode==='click')throw Error('PRIVATE_CLICK_DETAIL');const blob=blobs.get(this.href),entry={text:'',name:this.download,type:blob.type};f.downloads.push(entry);blob.text().then(text=>entry.text=text)};createRoot(document.getElementById('root')).render(<EvidenceProcurementWorkspace/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const state = (page: Page) => page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const button = (page: Page) => page.getByRole("button", { name: copy.workspace.downloadPrivatePlaintextPacket, exact: true });
const error = (page: Page) => page.getByText("Download unavailable. Try again.", { exact: true });
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ serviceWorkers: "block" }); const errors: string[] = [], requests: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://procurement-download.test/" ? route.fulfill({ contentType: "text/html", body: '<main id="root"></main>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message)); await page.goto("https://procurement-download.test/"); await page.addScriptTag({ content: bundle }); await page.locator('input[type="file"]').setInputFiles({ name: "packet.json", mimeType: "application/json", buffer: Buffer.from(expected) }); await page.getByRole("button", { name: copy.workspace.replaceTabWithValidatedPacket, exact: true }).click(); await expect.poll(() => button(page).isEnabled()).toBe(true); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://procurement-download.test/"]); expect(await page.locator("body").textContent()).not.toContain("PRIVATE_"); expect(await page.evaluate(() => localStorage.length)).toBe(0); expect(await page.locator("a[download]").count()).toBe(0);
  } finally { await context.close(); }
}
it.each(["url", "element", "click"])("recovers %s export failure and retries exact signature-bearing proposal bytes", async mode => fixture(async page => {
  await page.evaluate(mode => { (window as unknown as { fixture: Fixture }).fixture.mode = mode; }, mode); await button(page).click(); await error(page).waitFor(); expect((await state(page)).downloads).toEqual([]); expect(await page.getByText(copy.messages.packetDownloaded, { exact: true }).count()).toBe(0); if (mode !== "url") await expect.poll(async () => (await state(page)).revokes.length).toBe(1);
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "okay"; }); await button(page).click(); await page.getByText(copy.messages.packetDownloaded, { exact: true }).waitFor(); expect(await error(page).count()).toBe(0); await expect.poll(async () => (await state(page)).downloads[0]?.text).toBe(expected); expect((await state(page)).downloads[0]).toMatchObject({ name: "private-evidence-procurement-packet.json", type: "application/json" }); await expect.poll(async () => (await state(page)).revokes.length).toBe(mode === "url" ? 1 : 2);
}));
it("clears failed export feedback and disables stale packet export when clearing the tab", async () => fixture(async page => {
  await page.evaluate(() => { (window as unknown as { fixture: Fixture }).fixture.mode = "url"; }); await button(page).click(); await error(page).waitFor(); await page.getByRole("button", { name: copy.workspace.clearTabPacket, exact: true }).click(); await page.getByText(copy.messages.cleared, { exact: true }).waitFor(); expect(await error(page).count()).toBe(0); expect(await button(page).isDisabled()).toBe(true); expect((await state(page)).downloads).toEqual([]);
}));
