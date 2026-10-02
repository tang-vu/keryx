/** Hermetic Monthly checkout/recovery UI. Synthetic EOA, intercepted HTTP, no settlement. */
import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationWithNonce, buyerTypedData } from "../lib/buyer/protocol.ts";
import { buyerJobId } from "../lib/buyer/policy.ts";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"b".repeat(40)}`;
const quote = { plan: "research-monthly-v1", requests: 4, termDays: 30, researchMode: "deep", packageVersion: "1.0.0",
  creatorBudgetMicros: 50000, serviceFeeMicros: 160000, totalMicros: 360000, separateTotalMicros: 400000,
  roundingMicros: 0, payee, network: "eip155:5042002", quoteId: "a".repeat(64) };
const requirement = { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "360000", payTo: payee,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } } as const;
const authorization = authorizationWithNonce(account.address, requirement, `0x${"2".repeat(64)}`);
const id = buyerJobId(authorization).replace(/^a2a_/, "monthly_");
const intent = { schema: "keryx-monthly-intent-v1", monthlyId: id, quote, authorization };
const bundle = await build({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';import{ResearchMonthly}from'./components/keryx/research-monthly';
  window.walletReady=false;window.testWallet={getAddresses:async()=>['${account.address}'],getChainId:async()=>5042002,
    signMessage:async value=>window.syntheticSignMessage(value.message),signTypedData:async value=>window.syntheticSignTyped(value.message)};
  createRoot(document.getElementById('root')).render(React.createElement(ResearchMonthly,{quote:${JSON.stringify(quote)}}));`,
  resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, metafile: true,
  define: { "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined",
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" }, plugins: [{ name: "hermetic-monthly", setup(b) {
    b.onResolve({ filter: /^(wagmi|next\/image)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onResolve({ filter: /research-funding|wallet-picker|gateway\/read-credit/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents:
      args.path.includes("research-funding") ? "export function ResearchFunding(){return null}" :
      args.path.includes("wallet-picker") ? "export function WalletPicker(){return 'Connect the plan payer'}" :
      args.path.includes("read-credit") ? "export async function readGatewayCredit(){return 1000000n}" :
      args.path === "next/image" ? "export default function Image(){return null}" : `
        import{useSyncExternalStore}from'react';const subscribe=f=>{window.addEventListener('wallet-change',f);return()=>window.removeEventListener('wallet-change',f)};
        const ready=()=>useSyncExternalStore(subscribe,()=>window.walletReady,()=>false);
        export const useAccount=()=>({address:ready()?'${account.address}':undefined,chainId:5042002});
        export const useWalletClient=()=>({data:ready()?window.testWallet:undefined});
        export const useConnect=()=>({connectors:[],isPending:false});`, loader: "js", resolveDir: process.cwd() }));
  } }] });
assert(!Object.keys(bundle.metafile.inputs).some(path => /^lib\/(config|db\/)/.test(path)), "Server code leaked to browser bundle");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(15000);
  const errors: string[] = []; let paid = 0; let status = 0;
  await context.exposeFunction("syntheticSignMessage", (message: string) => account.signMessage({ message }));
  await context.exposeFunction("syntheticSignTyped", (value: Record<string, string>) => account.signTypedData(buyerTypedData({ from: value.from, to: value.to, value: String(value.value),
    validAfter: String(value.validAfter), validBefore: String(value.validBefore), nonce: value.nonce })));
  await context.route("https://keryx.cc/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: "<div id='root'></div><script src='/bundle.js'></script>" });
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text });
    if (request.method() === "POST") {
      if (request.headers()["payment-signature"]) { paid++; return route.abort(); }
      return route.fulfill({ status: 402, headers: { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] })).toString("base64"), "x-keryx-monthly-authorization": JSON.stringify({ ...authorization, validAfter: String(Math.floor(Date.now()/1000)-600), validBefore: String(Math.floor(Date.now()/1000)+691200) }), "x-keryx-monthly-expires": String(Math.floor(Date.now()/1000)+600) }, body: "{}" });
    }
    if (url.pathname === "/api/research/monthly") { status++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ remaining: 4, expired: false,
      purchase: { id, payer: account.address, expiresAt: new Date(Date.now() + 86400_000).toISOString() }, redemptions: [] }) }); }
    throw new Error(`Unexpected hermetic route ${url.pathname}`);
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ intent, id }) => { if (!localStorage.getItem("fixture-ready")) {
    localStorage.setItem("fixture-ready", "1"); localStorage.setItem("keryx.monthly.last", JSON.stringify(id));
    localStorage.setItem(`keryx.monthly.intent.${id}`, JSON.stringify({ intent, state: "submitted" }));
    localStorage.setItem("keryx.monthly.request", JSON.stringify({ monthlyId: id, question: "Malformed stored request missing payer" }));
  } }, { intent, id });
  await page.goto("https://keryx.cc/fixture");
  await page.getByText("A submitted purchase remains unresolved", { exact: false }).waitFor();
  assert.equal(errors.length, 0, "Malformed stored request must not crash UI");
  assert.equal(await page.getByRole("button", { name: "Check plan status" }).isDisabled(), true);
  await page.evaluate(() => { (window as any).walletReady = true; window.dispatchEvent(new Event("wallet-change")); });
  await page.getByRole("checkbox").check();
  assert.equal(await page.getByRole("button", { name: "Buy Monthly", exact: false }).isDisabled(), true, "Uncertain saved debit must block fresh purchase");
  await page.getByRole("button", { name: "Check plan status" }).click();
  await page.getByText("4 requests remaining", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Buy Monthly", exact: false }).click();
  await page.getByText("Purchase is uncertain", { exact: false }).waitFor();
  assert.equal(paid, 1); assert.equal(status, 1);
  await page.reload(); await page.getByText("A submitted purchase remains unresolved", { exact: false }).waitFor();
  await page.evaluate(() => { (window as any).walletReady = true; window.dispatchEvent(new Event("wallet-change")); });
  await page.getByRole("checkbox").check();
  assert.equal(await page.getByRole("button", { name: "Buy Monthly", exact: false }).isDisabled(), true);
  assert.equal(paid, 1); assert.equal(errors.length, 0);
  await context.close();
  console.log("Monthly browser: malformed recovery refusal, disconnected wallet, exact synthetic signing, one uncertain debit and refresh purchase guard passed (no settlement).");
} finally { await browser.close(); }
