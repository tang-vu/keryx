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
  let progressMode: "pending" | "error" | "foreign" | "missing" | "observed" | "revoked" | "switch" = "pending";
  let progressCalls = 0;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const req = route.request();
    if (req.url() === "https://withdrawal-history.test/")
      return route.fulfill({ contentType: "text/html", body: "<main></main>" });
    if (req.url() === "https://withdrawal-history.test/api/me/withdrawals/status") {
      assert.equal(req.method(), "POST"); assert.equal(req.headers().referer, undefined);
      assert.deepEqual(req.postDataJSON(), { id: first.id }); progressCalls++;
      if (progressMode === "switch") {
        await page.evaluate(address => (window as unknown as { mount: (value: string) => void }).mount(address), other);
        await page.getByRole("button", { name: "Load account history", exact: true }).waitFor();
      }
      const status = progressMode === "error" ? 503 : progressMode === "revoked" ? 401 : progressMode === "missing" ? 404 : 200;
      const basic = { wallet: owner, requestId: first.id, recipient: progressMode === "foreign" ? other : owner,
        amountMicros: first.amountMicros, status: "awaiting-transfer-evidence", mintStatus: "not-checked", chainFinalityVerified: false };
      const result = status !== 200 ? { error: "private progress diagnostic" } : progressMode === "observed"
        ? { ...basic, status: "attestation-stored", mintStatus: "finalized-observed", chainFinalityVerified: true, transactionHash: `0x${"ab".repeat(32)}`,
          blockHash: `0x${"cd".repeat(32)}`, blockNumber: "12345", observedAt: "2026-09-11T14:00:00Z", finalityBasis: "operator-selected-rpc" }
        : basic;
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) }).catch(error => {
        if (progressMode !== "switch") throw error;
      });
    }
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
  const item = page.getByRole("listitem").filter({ hasText: first.id });
  await item.getByRole("button", { name: "Check progress" }).click();
  await item.getByText("Transfer evidence is still pending. Do not create a replacement request to retry it.", { exact: true }).waitFor();
  for (const next of ["error", "foreign"] as const) {
    progressMode = next; await item.getByRole("button", { name: "Check progress" }).click();
    await item.getByText("Progress could not be read. This does not mean the withdrawal failed.", { exact: true }).waitFor();
    assert.equal(await page.getByText("private progress diagnostic").count(), 0);
  }
  progressMode = "missing"; await item.getByRole("button", { name: "Check progress" }).click();
  await item.getByText("The server could not find this request. Keep its ID and any recovery file; do not treat it as cancelled.", { exact: true }).waitFor();
  progressMode = "observed"; await item.getByRole("button", { name: "Check progress" }).click();
  const transaction = item.getByRole("link", { name: "View reported mint transaction" }); await transaction.waitFor();
  assert.equal(await transaction.getAttribute("href"), `https://testnet.arcscan.app/tx/0x${"ab".repeat(32)}`);
  await item.getByText("Observation uses the operator's RPC; this browser has not independently verified settlement.", { exact: true }).waitFor();
  progressMode = "revoked"; await item.getByRole("button", { name: "Check progress" }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).waitFor(); assert.equal(await page.getByRole("listitem").count(), 0);
  await page.getByRole("button", { name: "Load account history", exact: true }).click();
  await page.getByText(`Request ID: ${first.id}`, { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "View reported mint transaction" }).count(), 0);
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
  mode = "normal"; await mount(owner);
  await page.getByRole("button", { name: "Load account history", exact: true }).click();
  await item.waitFor(); progressMode = "switch";
  await item.getByRole("button", { name: "Check progress" }).click();
  await page.getByRole("button", { name: "Load account history", exact: true }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 0); assert.equal(progressCalls, 7);
  // Exercise the actual account wrapper with controlled auth/wallet hooks. The
  // history must remain available without a signer; sign-out must unmount it.
  const accountBundle = await build({ stdin: { contents: `
import {WithdrawalAccount} from './components/keryx/withdrawal-account';
import {createElement,StrictMode} from 'react'; import {createRoot} from 'react-dom/client';
const root=createRoot(document.querySelector('main'));
window.mountAccount=(address,connected)=>{window.testSession=address?{address}:null;window.testAddress=connected;
root.render(createElement(StrictMode,null,createElement(WithdrawalAccount,{limits:null})));};`,
    resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env": "{}" }, plugins: [{ name: "account-hook-fixtures", setup(build) {
      build.onResolve({ filter: /^(wagmi|next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "wagmi"
        ? "export const useAccount=()=>({address:window.testAddress});export const useWalletClient=()=>({data:undefined});"
        : args.path === "next/link" ? "import {createElement} from 'react';export default props=>createElement('a',props);"
          : "export const useSiweAuth=()=>({session:window.testSession});", resolveDir: process.cwd() }));
    } }] });
  await page.goto("https://withdrawal-history.test/"); await page.addScriptTag({ content: accountBundle.outputFiles[0].text });
  const mountAccount = (selected: string | null, connected?: string) => page.evaluate(({ selected, connected }) =>
    (window as unknown as { mountAccount: (owner: string | null, wallet?: string) => void }).mountAccount(selected, connected), { selected, connected });
  mode = "normal"; await mountAccount(owner);
  await page.getByRole("button", { name: "Load account history", exact: true }).click();
  await page.getByText(`Request ID: ${first.id}`, { exact: true }).waitFor();
  await mountAccount(owner, other);
  assert.equal(await page.getByRole("listitem").count(), 2);
  assert.equal(await page.getByRole("button", { name: /sign|send|prepare withdrawal/i }).count(), 0);
  await mountAccount(null);
  await page.getByRole("link", { name: "Sign in to manage withdrawals" }).waitFor();
  assert.equal(await page.getByRole("listitem").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: Chromium private account history and server-reported progress, pagination, failure/foreign-report rejection, mint link, session revocation and account switch with empty IndexedDB; synthetic intercepted HTTP, no payment.");
} finally { await browser.close(); }
