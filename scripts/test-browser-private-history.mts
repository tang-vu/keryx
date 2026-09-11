import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";

const walletA = `0x${"a".repeat(40)}`, walletB = `0x${"b".repeat(40)}`;
const id = (n: number) => `prv_${n.toString(16).padStart(64, "0")}`;
const row = (n: number, question: string) => ({ id: id(n), question, createdAt: "2026-09-09T00:00:00.000Z",
  researchMode: "quick", model: null, packageVersion: "1.0.0", priceMicros: "50000", record: "private-intent" });
const answer = "Synthetic private answer <img src=x onerror=alert(1)>";
function result(wallet: string, question: string) {
  return { wallet, format: "private-result-v1", status: "completed", request: { question, researchMode: "quick", model: null, packageVersion: "1.0.0", creatorBudgetMicros: "30000" },
    spend: { format: "private-spend-v1", chainFinalityVerified: false, incoming: { status: "settled", priceMicros: "50000" }, creator: {
      budgetMicros: "30000", committedMicros: "2000", unresolvedMicros: "2000", processingMicros: "0", confirmedMicros: "0", uncommittedMicros: "28000", payments: [] } },
    result: { answer, engine: "synthetic", savedAt: "2026-09-09T00:00:00.000Z", subClaims: [], citations: [], evidence: [], claimCoverage: [],
      decisions: [{ sourceName: "Synthetic source", action: "SKIP", rationale: "Evidence does not support the question.", price: 0.002, targets: [] }] } };
}
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ResearchPrivateJobs}from'./components/keryx/research-private-jobs';window.auth=null;createRoot(document.getElementById('root')).render(<ResearchPrivateJobs/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-private-account", setup(b) {
  b.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link" ? `import React from 'react';export default function Link(p){return <a {...p}/ >}` : `import{useEffect,useState}from'react';export function useSiweAuth(){const[session,setSession]=useState(window.auth);useEffect(()=>{const update=()=>setSession(window.auth);window.addEventListener('fixture-auth',update);window.addEventListener('keryx:auth',update);return()=>{window.removeEventListener('fixture-auth',update);window.removeEventListener('keryx:auth',update)}},[]);return{session}}` }));
} }] });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let wallet = walletA, fail = true, delay = false, revoked = false, interrupted = false, reads = 0;
  let held: Route | undefined;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    assert.equal(url.search, "", "Private selectors must not enter URLs");
    if (url.pathname.startsWith("/api/")) {
      assert.equal(route.request().method(), "POST");
      assert(["/api/me/private-jobs/history", "/api/me/private-jobs/result"].includes(url.pathname), "No payment or other endpoints allowed");
      reads++;
      if (revoked) return route.fulfill({ status: 401, json: { error: "Sign in" } });
      if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      const body = route.request().postDataJSON();
      if (url.pathname.endsWith("/history")) return route.fulfill({ json: { wallet, format: "private-history-v1",
        jobs: wallet === walletB ? [row(3, "Wallet B private question")] : body.cursor ? [row(2, "Older private question")] : [row(1, "Wallet A private question")],
        nextCursor: wallet === walletA && !body.cursor ? { id: id(1), createdAt: "2026-09-09T00:00:00.000Z" } : null } });
      assert.deepEqual(Object.keys(body), ["id"]);
      if (delay) { delay = false; held = route; return; }
      const selected = result(wallet, wallet === walletB ? "Wallet B private question" : "Wallet A private question");
      return route.fulfill({ json: interrupted ? { ...selected, status: "interrupted", result: null,
        interruption: { reason: "worker-interrupted", recordedAt: "2026-09-11T00:00:00.000Z" } } : selected });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.goto("https://private-history.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("link", { name: "Sign in to view private jobs" }).waitFor(); assert.equal(reads, 0);
  const signIn = (address: string | null) => page.evaluate(address => { (window as unknown as { auth: unknown }).auth = address ? { address, role: "asker" } : null; window.dispatchEvent(new Event("fixture-auth")); }, address);
  await signIn(walletA); await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText(/No private jobs found/).count(), 0);
  fail = false; await page.getByRole("button", { name: "Refresh private jobs" }).click(); await page.getByText("Wallet A private question", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load older private jobs" }).click(); await page.getByText("Older private question", { exact: true }).waitFor();
  await page.getByRole("button", { name: "View private job", exact: true }).first().click(); await page.getByText(answer, { exact: true }).waitFor();
  assert.equal(await page.locator("img").count(), 0); await page.getByText("Evidence does not support the question.", { exact: true }).waitFor();
  await page.getByText("Unresolved", { exact: true }).waitFor();
  interrupted = true; await page.getByRole("button", { name: "Refresh this job" }).click();
  await page.getByText(/Research was interrupted and closed to new creator payments/).waitFor();
  assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
  await page.getByText(/No refund has been issued by this action/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  interrupted = false; await page.getByRole("button", { name: "Refresh this job" }).click();
  await page.getByText(answer, { exact: true }).waitFor();
  delay = true; await page.getByRole("button", { name: "Refresh this job" }).click();
  for (let n = 0; n < 100 && !held; n++) await page.waitForTimeout(10);
  assert(held);
  wallet = walletB; await signIn(walletB); await page.getByText("Wallet B private question", { exact: true }).waitFor();
  await held.fulfill({ json: result(walletA, "Wallet A private question") }).catch(() => {});
  await page.waitForTimeout(50); assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
  assert.equal(await page.getByText("Wallet A private question", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "View private job", exact: true }).click(); await page.getByText(answer, { exact: true }).waitFor();
  revoked = true; await page.evaluate(() => { (window as unknown as { auth: unknown }).auth = null; });
  await page.getByRole("button", { name: "Refresh this job" }).click(); await page.getByRole("link", { name: "Sign in to view private jobs" }).waitFor();
  assert.equal(await page.getByText(answer, { exact: true }).count(), 0);
  assert.equal(await page.getByText("Wallet B private question", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: private account history, pagination, safe text rendering, read-only body selectors, stale result isolation and revoked-session clearing. Synthetic transport only.");
} finally { await browser.close(); }
