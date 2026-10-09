/** Hermetic real Chromium UI/WebCrypto/export assurance. No app DB, wallet, environment loader or provider. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { ledgerFixture, ledgerPayment, ledgerRun } from "../lib/operator-ledger/test-fixture.ts";
import { ledgerDigest } from "../lib/operator-ledger/projection.ts";
import { operatorLedgerCsv, verifyOperatorLedger } from "../lib/operator-ledger/export.ts";
import type { OperatorLedger } from "../lib/operator-ledger/contracts.ts";

const browserRun = ledgerRun({ id: "44444444-4444-4444-8444-444444444444", fundingOwner: "browser", askerFunded: true,
  asker: `0x${"c".repeat(40)}`, provenance: { version: 1, surface: "web", ownershipMethod: "session" } });
const corpus = [ledgerFixture(), ledgerFixture([browserRun], [ledgerPayment({ queryId: browserRun.id })]),
  ledgerFixture([ledgerRun({ fundingOwner: undefined })]),
  ledgerFixture([ledgerRun({ fundingOwner: "offline", paymentMode: "offline" })], [ledgerPayment({ settled: false, settlementStatus: "simulated", txHash: null })]),
  ledgerFixture([ledgerRun({ settledPayments: 2 })], [ledgerPayment({ amountUsdc: 9007199254.74099 }), ledgerPayment({ id: "huge-two", amountUsdc: 9007199254.74099,
    authorizationId: "huge-auth-two", txHash: "33333333-3333-4333-8333-333333333333" })])];
const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {OperatorLedgerView} from './components/keryx/operator-ledger-view.tsx';
import {verifyBrowserOperatorLedger} from './lib/operator-ledger/client.ts';
window.ledgerVerify=verifyBrowserOperatorLedger; createRoot(document.getElementById('root')).render(React.createElement(OperatorLedgerView));`,
  resolveDir: process.cwd(), sourcefile: "ledger-browser-fixture.tsx", loader: "tsx" },
  bundle: true, write: false, format: "iife", platform: "browser", tsconfig: resolve("tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
let mode: "ok" | "empty" | "tamper" = "ok", requests = 0;
const server = createServer((request, response) => {
  if (++requests > 200) { response.writeHead(503).end(); return; }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET") { response.writeHead(405).end(); return; }
  if (url.pathname === "/fixture.js") { response.writeHead(200, { "content-type": "text/javascript" }).end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/operator/ledger") { response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><div id=root style='max-width:1100px;margin:auto;overflow-wrap:anywhere'></div><script src=/fixture.js></script>"); return; }
  if (url.pathname === "/api/operator/ledger") {
    const value = mode === "empty" ? ledgerFixture([], []) : structuredClone(corpus[0]);
    value.payload.window.days = Number(url.searchParams.get("days") ?? 7);
    value.payload.window.from = new Date(Date.parse(value.payload.window.readStartedAt) - value.payload.window.days * 86_400_000).toISOString();
    value.integrity.digest = ledgerDigest(value.payload);
    if (mode === "tamper") value.payload.entries[0].debitMicroUsdc = "1";
    const csv = url.searchParams.get("format") === "csv";
    response.writeHead(200, { "content-type": csv ? "text/csv" : "application/json", "cache-control": "no-store", "X-Keryx-Ledger-Digest": value.integrity.digest,
      ...(csv ? { "content-disposition": "attachment; filename=public-transfer-fixture.csv" } : {}) });
    response.end(csv ? operatorLedgerCsv(value) : JSON.stringify(value)); return;
  }
  response.writeHead(404).end();
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const address = server.address(); assert(address && typeof address === "object"); const origin = `http://127.0.0.1:${address.port}`;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`${origin}/operator/ledger`);
  try { await page.getByText("0.015700 USDC", { exact: true }).first().waitFor({ timeout: 10_000 }); }
  catch (error) { console.error(JSON.stringify({ browserErrors: errors, body: (await page.locator("body").innerText()).slice(0, 4000), requests })); throw error; }
  const parity = await page.evaluate(async ({ corpus, retained }) => {
    const verify = (window as unknown as { ledgerVerify(value: unknown, digest?: string): Promise<OperatorLedger> }).ledgerVerify;
    for (let i = 0; i < corpus.length; i++) {
      const original = corpus[i], reordered = { integrity: original.integrity, payload: Object.fromEntries(Object.entries(original.payload).reverse()) };
      if ((await verify(reordered, retained[i])).integrity.digest !== retained[i]) throw new Error("Browser parity mismatch");
    }
    const original = structuredClone(corpus[0]), pending = verify(original, retained[0]);
    original.payload.entries[0].debitMicroUsdc = "1";
    if ((await pending).payload.entries[0].debitMicroUsdc !== "15700") throw new Error("Async mutation escaped snapshot");
    let refused = false; try { await verify(original, retained[0]); } catch { refused = true; }
    if (!refused) throw new Error("Tamper was accepted");
    return { cases: corpus.length, secureContext: window.isSecureContext };
  }, { corpus, retained: corpus.map(value => value.integrity.digest) });
  assert.equal(parity.cases, 5); assert.equal(parity.secureContext, true);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const summary = page.locator("summary").first(); if (!(await page.locator("details").first().getAttribute("open"))) await summary.click();
    const text = await page.locator("body").innerText();
    assert(!/PRIVATE-CUSTOMER|PRIVATE-ANSWER|PRIVATE-RATIONALE|auth-one|payment-one/.test(text));
  }
  const downloadPromise = page.waitForEvent("download"); await page.getByText("Download balanced CSV", { exact: true }).click();
  const stream = await (await downloadPromise).createReadStream(); assert(stream);
  let csv = ""; for await (const chunk of stream) { csv += chunk.toString(); assert(Buffer.byteLength(csv) <= 2_000_000); }
  assert.equal(csv, operatorLedgerCsv(corpus[0]));
  await page.locator("#ledger-days").selectOption("31"); await page.getByText("0.015700 USDC", { exact: true }).first().waitFor();
  mode = "tamper"; await page.getByRole("button", { name: "Read again", exact: true }).click();
  await page.getByText(/Public transfer evidence is unavailable/).waitFor();
  mode = "empty"; await page.getByRole("button", { name: "Read again", exact: true }).click();
  await page.getByText("No eligible public web dispatches were observed in this bounded slice.", { exact: true }).waitFor();
  assert.equal(errors.length, 0); verifyOperatorLedger(corpus[0]);
  console.log(JSON.stringify({ gate: "public-job-ledger-browser", actualWebCryptoCases: parity.cases, functionalWidths: [390, 1280], cssLayoutQualified: false, csvBalanced: true,
    tamperRefused: true, emptyScopePreserved: true, privatePayloadAbsent: true, requests }));
} finally {
  try { await browser?.close(); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
