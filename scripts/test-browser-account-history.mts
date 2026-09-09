import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";
const walletA = `0x${"a".repeat(40)}`, walletB = `0x${"b".repeat(40)}`;
const id = (n: number) => `a2a_${n.toString(16).padStart(64, "0")}`;
const row = (n: number, question: string) => ({ id: id(n), question, status: "queued", createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z", mode: "deep", packagePriceUsdc: 0.05 });
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchAccountJobs}from'./components/keryx/research-account-jobs';window.auth=null;createRoot(document.getElementById('root')).render(<ResearchAccountJobs/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-account", setup(b) {
  b.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? `import React from 'react';export default function Link(p){return <a {...p}/>}` : `import{useEffect,useState}from'react';export function useSiweAuth(){const[session,setSession]=useState(window.auth);useEffect(()=>{const update=()=>setSession(window.auth);window.addEventListener('fixture-auth',update);return()=>window.removeEventListener('fixture-auth',update)},[]);return{session}}` }));
} }] });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let wallet = walletA, fail = true, delay = false, held: Route | undefined, historyReads = 0, resultReads = 0;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    assert.equal(route.request().method(), "GET", "History must never sign, submit or pay");
    const url = new URL(route.request().url());
    if (url.pathname === "/api/me/jobs") {
      historyReads++;
      if (delay) { delay = false; held = route; return; }
      if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      const older = url.searchParams.has("cursor");
      return route.fulfill({ json: { wallet, jobs: wallet === walletB ? [row(3, "Wallet B question")] : older ? [row(2, "Older wallet A question")] : [row(1, "Wallet A question")], nextCursor: wallet === walletA && !older ? "next" : null } });
    }
    if (url.pathname === "/api/agent/ask") { resultReads++; return route.fulfill({ json: { queryId: url.searchParams.get("queryId"), status: "queued" } }); }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://history.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("link", { name: "Sign in with the wallet that paid" }).waitFor(); assert.equal(historyReads, 0);
  const signIn = (address: string | null) => page.evaluate(address => { (window as unknown as { auth: unknown }).auth = address ? { address, role: "asker" } : null; window.dispatchEvent(new Event("fixture-auth")); }, address);
  await signIn(walletA); await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText(/No paid jobs found/).count(), 0);
  fail = false; await page.getByRole("button", { name: "Refresh paid jobs" }).click(); await page.getByText("Wallet A question", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load older jobs" }).click(); await page.getByText("Older wallet A question", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Follow this job" }).first().click();
  await page.waitForFunction(() => document.querySelector('input')?.value.startsWith('a2a_'));
  await page.getByText(/queued ·/).first().waitFor();
  assert(resultReads >= 1); assert.equal(new URL(page.url()).search, "");
  await page.getByRole("button", { name: "Close job" }).click();
  delay = true; await page.getByRole("button", { name: "Refresh paid jobs" }).click();
  for (let n = 0; n < 50 && !held; n++) await page.waitForTimeout(10);
  assert(held);
  wallet = walletB; await signIn(walletB); await page.getByText("Wallet B question", { exact: true }).waitFor();
  await held.fulfill({ json: { wallet: walletA, jobs: [row(1, "Late wallet A question")], nextCursor: null } }).catch(() => {});
  await page.waitForTimeout(50); assert.equal(await page.getByText("Late wallet A question", { exact: true }).count(), 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await signIn(null); await page.getByRole("link", { name: "Sign in with the wallet that paid" }).waitFor();
  assert.equal(await page.getByText("Wallet B question", { exact: true }).count(), 0); assert.deepEqual(errors, []);
  console.log("PASS: authenticated history, outage/empty distinction, pagination, GET-only follow-up, wallet-switch stale-response isolation and mobile layout.");
} finally { await browser.close(); }
