/** Actual owned-history components + successful production CSS. Synthetic transport only; no Next router/backend delivery claim. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ownedHistoryCopy as copy } from "../locales/en/owned-history";
import { ownedRowSchema, type OwnedHistoryRow } from "../lib/history/owned-history";
const dist = resolve(process.env.NEXT_DIST_DIR ?? ".next");
assert((await readFile(join(dist, "BUILD_ID"), "utf8")).trim(), "A successful stock build must precede browser acceptance");
const cssFiles = (await readdir(join(dist, "static", "chunks"))).filter(file => file.endsWith(".css"));
assert(cssFiles.length, "Actual production CSS is required");
const css = (await Promise.all(cssFiles.map(file => readFile(join(dist, "static", "chunks", file), "utf8")))).join("\n");
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const row = (owner: string, id: string, question: string): OwnedHistoryRow => ownedRowSchema.parse({ id, question,
  createdAt: "2026-10-12T00:00:00.000Z", provenance: null, recordedSpendUsdc: .000001, recordedCreatorAllocationUsdc: .000001,
  paymentMode: "real", isFollowUp: false, ownerWallet: owner, ownership: { method: "recorded", claimedAt: null }, visibility: "private", revision: 0,
  networks: ["eip155:5042002"], funding: "paid", ownSettledSpendMicros: 1, sponsoredSettledSpendMicros: 0, receiptsTruncated: false, paidCreators: [],
  links: { report: `/api/me/asks/${id}`, receipts: `/api/me/asks/${id}?format=receipts`, references: `/api/me/asks/${id}?format=bibtex`, privacy: `/api/me/run-privacy/${id}` } });
const bundle = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{MyAsksView}from'./app/me/asks/my-asks-view';window.auth={address:${JSON.stringify(alice)},role:'asker'};createRoot(document.getElementById('root')).render(<MyAsksView/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
  plugins: [{ name: "synthetic-history-session", setup(builder) {
    builder.onResolve({ filter: /^(next\/link|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents: args.path === "next/link"
      ? `import React from'react';export default function Link({prefetch,onNavigate,...p}){return <a {...p}/>}`
      : `import{useEffect,useState}from'react';export function useSiweAuth(){const[session,setSession]=useState(window.auth);useEffect(()=>{const update=()=>setSession(window.auth);window.addEventListener('fixture-auth',update);return()=>window.removeEventListener('fixture-auth',update)},[]);return{session}}` }));
  } }] });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block", acceptDownloads: true });
    try {
      const page = await context.newPage(), errors: string[] = [], forbidden: string[] = [];
      page.on("pageerror", error => errors.push(error.message)); page.on("popup", () => forbidden.push("popup")); page.on("worker", () => forbidden.push("worker"));
      await context.routeWebSocket("**/*", socket => { forbidden.push("WebSocket"); socket.close(); });
      let owner = alice, unavailable = true, erased = false, delay = false, held: Route | undefined, legacy = 0, ownedReads = 0;
      const mutations: Array<{ method: string; body: Record<string, unknown> }> = [];
      const packet = (wallet: string, cursor = false) => ({ version: 2, wallet, scope: "wallet-owned-current-store", storeNetwork: "eip155:5042002",
        rows: erased ? [] : [row(wallet, wallet === bob ? "owned_b" : cursor ? "older_a" : "owned_a", wallet === bob ? "Wallet B original" : cursor ? "Older A original" : "Original A <img src=x>")],
        nextCursor: cursor || wallet === bob || erased ? null : "older_cursor", scanLimited: false, claimsAvailable: true, membershipAvailable: false });
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://owned-history.test") { forbidden.push("external"); return route.abort(); }
        if (url.pathname === "/" && request.method() === "GET") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
        if (url.pathname === "/api/me/asks" && request.method() === "GET") {
          if (url.searchParams.get("view") === "recent") { legacy++; return route.fulfill({ json: { asks: [], totals: {
            dispatches: 0, spentUsdc: 0, toCreatorsUsdc: 0, citations: 0, trialDispatches: 0, trialToCreatorsUsdc: 0 }, truncated: false } }); }
          assert.equal(url.searchParams.get("contract"), "owned"); assert.equal(request.headers()["x-keryx-expected-wallet"], owner);
          ownedReads++; if (delay) { delay = false; held = route; return; }
          if (unavailable) return route.fulfill({ status: 503, json: { error: "privacy_unavailable" } });
          return route.fulfill({ json: packet(owner, url.searchParams.has("cursor")) });
        }
        if (url.pathname === "/api/me/asks/export" && request.method() === "GET") {
          assert.equal(request.headers()["x-keryx-expected-wallet"], owner);
          return route.fulfill({ json: { version: 2, wallet: owner, scope: "wallet-owned-current-store", rows: packet(owner).rows,
            complete: true, truncated: false, nextCursor: null, bounds: { maxPages: 20, maxRows: 1000, maxBytes: 2097152 }, pages: 1,
            claimsAvailable: true, membershipAvailable: false, qualification: "Synthetic current-store export; no real membership or delivery proof." } });
        }
        if (url.pathname === "/api/me/asks/owned_a" && request.method() === "GET")
          return route.fulfill({ json: { wallet: owner, run: { id: "owned_a", answer: "Original answer <img src=x>" } } });
        if (url.pathname === "/api/me/run-privacy/owned_a" && ["PATCH", "DELETE"].includes(request.method())) {
          assert.equal(request.headers()["x-keryx-expected-wallet"], alice); const body = request.postDataJSON();
          assert.equal(body.revision, 0); assert.match(body.requestId, /^[a-f0-9-]{36}$/); assert.deepEqual(Object.keys(body).sort(), request.method() === "PATCH" ? ["requestId", "revision", "visibility"] : ["requestId", "revision"]);
          mutations.push({ method: request.method(), body }); erased = request.method() === "DELETE"; return route.fulfill({ json: { ok: true } });
        }
        forbidden.push(`${request.method()} unsupported`); return route.abort();
      });
      await page.goto("https://owned-history.test/"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.waitForFunction(() => document.querySelectorAll('button').length > 0).catch(error => {
        assert.deepEqual(errors, [], "Owned history fixture failed before its first render");
        throw error;
      });
      await page.waitForLoadState("networkidle");
      assert(legacy > 0); assert.equal(ownedReads, 0, "Privacy OFF leaves the ordinary ledger default");
      await page.getByRole("button", { name: copy.title, exact: true }).click(); await page.getByRole("alert").waitFor();
      assert.equal(await page.getByText(copy.empty, { exact: true }).count(), 0, "Unavailable is not an empty owner history");
      unavailable = false; await page.getByRole("button", { name: copy.refresh, exact: true }).click();
      await page.getByText("Original A <img src=x>", { exact: true }).waitFor(); assert.equal(await page.locator("img").count(), 0);
      await page.getByText(/\$0\.000001/).first().waitFor();
      await page.getByRole("button", { name: copy.next, exact: true }).click(); await page.getByText("Older A original", { exact: true }).waitFor();
      await page.getByRole("button", { name: copy.previous, exact: true }).click(); await page.getByText("Original A <img src=x>", { exact: true }).waitFor();
      await page.getByRole("button", { name: copy.report, exact: true }).click(); await page.getByText("Original answer <img src=x>", { exact: true }).waitFor(); assert.equal(await page.locator("img").count(), 0);
      const download = page.waitForEvent("download"); await page.getByRole("button", { name: copy.exportJson, exact: true }).click(); assert.equal((await download).suggestedFilename(), "keryx-history.json");
      const mutationResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/me/run-privacy/owned_a" && response.request().method() === "PATCH");
      await page.getByRole("button", { name: copy.save, exact: true }).click(); await mutationResponse; assert.equal(mutations.at(-1)?.method, "PATCH");
      await page.getByText("Original A <img src=x>", { exact: true }).waitFor();
      page.once("dialog", dialog => { assert.equal(dialog.message(), copy.confirmErase); void dialog.accept(); });
      await page.getByRole("button", { name: copy.erase, exact: true }).click(); await page.getByText(copy.empty, { exact: true }).waitFor(); assert.equal(mutations.at(-1)?.method, "DELETE");
      erased = false; await page.getByRole("button", { name: copy.refresh, exact: true }).click(); await page.getByText("Original A <img src=x>", { exact: true }).waitFor();
      delay = true; await page.getByRole("button", { name: copy.refresh, exact: true }).click();
      for (let attempt = 0; attempt < 100 && !held; attempt++) await page.waitForTimeout(10); assert(held);
      owner = bob; await page.evaluate(address => { (window as unknown as { auth: unknown }).auth = { address, role: "asker" }; window.dispatchEvent(new Event("fixture-auth")); }, bob);
      await page.getByText("Wallet B original", { exact: true }).waitFor(); await held.fulfill({ json: packet(alice) }).catch(() => {});
      await page.waitForTimeout(50); assert.equal(await page.getByText("Original A <img src=x>", { exact: true }).count(), 0);
      await page.evaluate(() => { (window as unknown as { auth: unknown }).auth = null; window.dispatchEvent(new Event("fixture-auth")); });
      await page.getByText(copy.signedOut, { exact: true }).waitFor(); assert.equal(await page.getByText("Wallet B original", { exact: true }).count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0); assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
      console.log(JSON.stringify({ width, legacyDefault: true, explicitOwnedRefusal: true, syntheticRowsAndMutations: true, staleOwnerCleared: true, forbidden: 0, overflow: false, productionCssFiles: cssFiles.length }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
