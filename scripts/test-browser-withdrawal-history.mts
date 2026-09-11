/** Real Chromium UI with synthetic intercepted history; no credentials, wallet or payment. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const owner = `0x${"11".repeat(20)}`, other = `0x${"22".repeat(20)}`;
const row = (n: number) => ({ id: `0x${n.toString(16).padStart(64, "0")}`, owner, recipient: owner,
  createdAt: `2026-09-11T14:00:${String(n).padStart(2, "0")}.123456+00:00`, amountMicros: "50000", maxFeeMicros: "1000" });
const first = row(3), second = row(2), oldest = row(1);
const cursor = { id: second.id, createdAt: second.createdAt };
const bundle = await build({ stdin: { contents: `
import {WithdrawalHistoryPanel} from './components/keryx/withdrawal-history-panel';
import {createElement,StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
const root=createRoot(document.querySelector('main'));
window.mount=address=>root.render(createElement(StrictMode,null,createElement(WithdrawalHistoryPanel,{address})));`,
  resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env": "{}" } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let mode: "normal" | "error" | "revoked" | "duplicate" | "switch" = "normal", calls = 0;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const req = route.request();
    if (req.url() === "https://withdrawal-history.test/")
      return route.fulfill({ contentType: "text/html", body: "<main></main>" });
    assert.equal(req.url(), "https://withdrawal-history.test/api/me/withdrawals/history");
    assert.equal(req.method(), "POST"); assert.equal(req.headers().referer, undefined); calls++;
    const input = req.postDataJSON();
    assert.deepEqual(input, input.cursor ? { cursor } : {});
    if (mode === "switch") {
      await page.evaluate(address => (window as unknown as { mount: (value: string) => void }).mount(address), other);
      await page.getByRole("button", { name: "Load account history", exact: true }).waitFor();
    }
    const status = mode === "error" ? 503 : mode === "revoked" ? 401 : 200;
    const body = status !== 200 ? { error: "private server diagnostic" } : input.cursor
      ? { wallet: owner, requests: mode === "duplicate" ? [first] : [oldest], nextCursor: null }
      : { wallet: owner, requests: [first, second], nextCursor: cursor };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(error => {
      if (mode !== "switch") throw error; // Owner remount may abort the intercepted request.
    });
  });
  const mount = async (address: string) => page.evaluate(value =>
    (window as unknown as { mount: (selected: string) => void }).mount(value), address);
  await page.goto("https://withdrawal-history.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await mount(owner);
  await page.getByRole("button", { name: "Load account history", exact: true }).waitFor(); assert.equal(calls, 0);
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).length), 0);
  await page.getByRole("button", { name: "Load account history", exact: true }).click();
  await page.getByText(`Request ID: ${first.id}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 2);
  assert.equal(await page.getByText("Requested: 0.05 USDC", { exact: true }).count(), 2);
  mode = "error"; await page.getByRole("button", { name: "Load older requests" }).click();
  await page.getByRole("status").filter({ hasText: "History could not be loaded" }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 2);
  assert.equal(await page.getByText("private server diagnostic").count(), 0);
  mode = "duplicate"; await page.getByRole("button", { name: "Load older requests" }).click();
  await page.getByRole("status").filter({ hasText: "History could not be loaded" }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 2);
  mode = "normal"; await page.getByRole("button", { name: "Load older requests" }).click();
  await page.getByText(`Request ID: ${oldest.id}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 3);
  assert.equal(await page.getByRole("button", { name: "Load older requests" }).count(), 0);
  mode = "revoked"; await page.getByRole("button", { name: "Refresh account history" }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 0);
  mode = "switch"; await page.getByRole("button", { name: "Load account history", exact: true }).click();
  await page.getByRole("button", { name: "Load account history", exact: true }).waitFor();
  // A fresh account view cannot retain either the old rows or sign-in message.
  await page.waitForFunction(() => !document.querySelector('[role="status"]')?.textContent?.includes("Loading"));
  assert.equal(await page.getByRole("listitem").count(), 0);
  assert.equal(await page.getByRole("link", { name: "Sign in", exact: true }).count(), 0);
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).length), 0);
  assert.equal(await page.getByRole("button", { name: /sign|send|withdraw USDC/i }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: Chromium private account history, pagination, failure retention, duplicate rejection, session revocation and account switch with empty IndexedDB; synthetic intercepted HTTP, no payment.");
} finally { await browser.close(); }
