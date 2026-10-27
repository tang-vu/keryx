import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { createReadCheckpointCapture } from "../agent/read-checkpoint-capture";
import { actualReadCheckpoint } from "./actual-read-policy";
import { actualReadCopy as copy } from "./actual-read-copy";

const collector = createReadCheckpointCapture(true), check = { kind: "channel", creatorFree: false, cache: false } as const;
collector.append(check, actualReadCheckpoint(check), { candidate: 1, round: 0, proposal: "BUY", plan: "BUY", price: .002 });
const capture = collector.finish();
if (capture?.status !== "available") throw Error("Synthetic retained capture unavailable");
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ReadCheckpointVerify}from'./components/keryx/read-checkpoint-verify';
    const root=createRoot(document.getElementById('root')),capture=${JSON.stringify(capture)},create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    const fixture=window.proofDownload={created:[],revoked:[],mode(value){URL.createObjectURL=blob=>{if(value==='throw')throw Error('PRIVATE_EXPORT_DETAIL');const url=create(blob);fixture.created.push(url);return url}},mount(value){root.render(<ReadCheckpointVerify capture={value}/>)} };
    URL.revokeObjectURL=url=>{fixture.revoked.push(url);revoke(url)};fixture.mode('ok');fixture.mount(capture);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
type Fixture = { created: string[]; revoked: string[]; mode(value: string): void; mount(value: typeof capture | null): void };
async function fixture(test: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, acceptDownloads: true, serviceWorkers: "block" });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => { requests.push(route.request().url()); return route.request().url() === "https://proof-download.test/" ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://proof-download.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: copy.download, exact: true }).waitFor(); await test(page);
    expect(errors).toEqual([]); expect(requests).toEqual(["https://proof-download.test/"]);
  } finally { await context.close(); }
}

it("retains the exact packet, filename and native URL lifetime", async () => fixture(async page => {
  const waiting = page.waitForEvent("download"); await page.getByRole("button", { name: copy.download, exact: true }).click();
  const download = await waiting; expect(download.suggestedFilename()).toBe("read-checkpoints.json");
  const stream = await download.createReadStream(); if (!stream) throw Error("Native proof download missing");
  const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
  expect(Buffer.concat(parts).toString("utf8")).toBe(JSON.stringify(capture.packet));
  expect(await page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.revoked.length)).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.revoked.length)).toBe(1);
}));

it("shows a generic download failure, preserves the retained digest and recovers on explicit retry", async () => fixture(async page => {
  await page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.mode("throw"));
  await page.getByRole("button", { name: copy.download, exact: true }).click();
  await page.getByRole("alert").waitFor(); expect(await page.getByRole("alert").textContent()).toBe("Download unavailable. Try again.");
  expect(await page.locator("body").textContent()).not.toContain("PRIVATE_EXPORT_DETAIL");
  expect(await page.locator("body").textContent()).toContain(capture.retainedDigest);
  await page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.mode("ok"));
  const waiting = page.waitForEvent("download"); await page.getByRole("button", { name: copy.download, exact: true }).click(); await waiting;
  expect(await page.getByRole("alert").count()).toBe(0);
}));

it("clears an old download failure when the retained capture is removed", async () => fixture(async page => {
  await page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.mode("throw"));
  await page.getByRole("button", { name: copy.download, exact: true }).click(); await page.getByRole("alert").waitFor();
  await page.evaluate(() => (window as unknown as { proofDownload: Fixture }).proofDownload.mount(null));
  await expect.poll(() => page.getByRole("alert").count()).toBe(0);
  expect(await page.getByRole("button", { name: copy.download, exact: true }).count()).toBe(0);
}));
