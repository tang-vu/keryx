/** Real private React/client/IndexedDB/EOA path. HTTP and wallet RPC are synthetic. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationSchema, buyerTypedData, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC } from "../lib/buyer/protocol";
import { createPrivateQuote } from "../lib/a2a/private-quote";
import { preparePrivateResearchIntent, type PrivateResearchIntent } from "../lib/a2a/private-research-intent";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`), payer = account.address.toLowerCase();
const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
const provider = { modelId: "deepseek-flash", provider: "deepseek" as const, baseUrl: "https://synthetic.example/v1", apiKey: "synthetic-not-secret" };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{createWalletClient,custom}from'viem';
import{ResearchPrivateCheckout}from'./components/keryx/research-private-checkout';
window.wallet=createWalletClient({account:'${payer}',transport:custom({request:r=>window.walletRequest(r)},{retryCount:0})});
createRoot(document.getElementById('root')).render(<ResearchPrivateCheckout merchants={${JSON.stringify(merchants)}}/>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "private-ui-fixture", setup(b) {
    b.onResolve({ filter: /^(wagmi|next\/link|@\/lib\/hooks\/use-siwe-auth|\.\/wallet-picker|\.\/research-funding)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
      args.path === "wagmi" ? `export const useAccount=()=>({address:'${payer}',chainId:5042002});export const useWalletClient=()=>({data:window.wallet});export const useSwitchChain=()=>({switchChainAsync:async()=>{},isPending:false});`
      : args.path === "next/link" ? `import React from'react';export default function Link(p){return <a {...p}/>}`
      : args.path === "./wallet-picker" ? `export function WalletPicker(){return null}`
      : args.path === "./research-funding" ? `export function ResearchFunding(){return null}`
      : `export function useSiweAuth(){return{session:{address:'${payer}',role:'user'}}}` }));
  } }] });
const css = await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  let allowed = false, signed = 0, posted = 0, recovered = 0, sessionOwner = payer, walletOwner = payer;
  let last: PrivateResearchIntent | undefined;
  const errors: string[] = [];
  await context.exposeFunction("walletRequest", async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_accounts") return [walletOwner];
    if (method === "eth_chainId") return "0x4cef52";
    assert.equal(method, "eth_signTypedData_v4", "No funding or other wallet operation is permitted");
    const data = JSON.parse(String(params?.[1]));
    assert.equal(Number(data.domain.chainId), 5042002); assert.equal(data.domain.verifyingContract.toLowerCase(), BUYER_GATEWAY.toLowerCase());
    const authorization = authorizationSchema.parse({ ...data.message, value: BigInt(data.message.value).toString(),
      validAfter: BigInt(data.message.validAfter).toString(), validBefore: BigInt(data.message.validBefore).toString() });
    assert.equal(authorization.from.toLowerCase(), payer); assert.equal(authorization.to.toLowerCase(), merchants.privatePayee); assert.equal(authorization.value, "50000");
    signed++; return account.signTypedData(buyerTypedData(authorization));
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, "https://keryx.cc");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<main id="root" style="max-width:1080px;margin:auto;padding:16px"></main>' });
    if (url.pathname === "/api/session/credit") {
      assert.equal(url.searchParams.get("address")?.toLowerCase(), payer);
      return route.fulfill({ json: { status: "known", address: payer, network: BUYER_NETWORK, available: "50000" } });
    }
    assert.equal(url.search, "", "Private request context must never enter URLs");
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: { session: { address: sessionOwner, role: "user" } } });
    assert.equal(request.method(), "POST");
    if (url.pathname === "/api/me/private-jobs/quote") return route.fulfill({ json: { wallet: payer, purchasingAvailable: allowed,
      quote: createPrivateQuote(request.postDataJSON(), { provider, requirement, merchants }) } });
    if (url.pathname === "/api/agent/private-ask") {
      assert(allowed); posted++; last = await preparePrivateResearchIntent(request.postDataJSON(), requirement, merchants);
      // Response loss after admission: the UI must recover, never send another payment.
      return route.abort("failed");
    }
    assert.equal(url.pathname, "/api/me/private-jobs/result");
    assert(last); assert.deepEqual(request.postDataJSON(), { id: last.id }); recovered++;
    const saved = last.submission.request;
    return route.fulfill({ json: { wallet: payer, format: "private-result-v1", status: "completed",
      request: { question: saved.question, researchMode: saved.researchMode, model: saved.model, packageVersion: saved.packageVersion, creatorBudgetMicros: "30000" },
      spend: { format: "private-spend-v1", chainFinalityVerified: false, incoming: { status: "settled", priceMicros: "50000" },
        creator: { budgetMicros: "30000", committedMicros: "0", confirmedMicros: "0", unresolvedMicros: "0", processingMicros: "0", uncommittedMicros: "30000", payments: [] } },
      result: { answer: "Synthetic private browser answer", engine: "synthetic", savedAt: new Date().toISOString(), subClaims: [], decisions: [], citations: [], evidence: [], claimCoverage: [] } } });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  const mount = async () => { await page.goto("https://keryx.cc/"); await page.addStyleTag({ content: css.css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
  await mount();
  await page.getByLabel("Private research question").fill("Synthetic private browser question");
  await page.getByRole("button", { name: "Review private price", exact: true }).click();
  await page.getByText("This account can preview terms, but private purchasing is currently unavailable.").waitFor();
  assert(await page.getByRole("button", { name: "Buy private research", exact: true }).isDisabled()); assert.equal(signed, 0);
  allowed = true;
  await page.getByRole("button", { name: "Review private price", exact: true }).click();
  await page.getByText("Review the exact price and AI policy before buying.").waitFor();
  await page.getByText(/Endpoint: https:\/\/synthetic.example/).waitFor();
  assert(await page.getByRole("button", { name: "Buy private research", exact: true }).isDisabled());
  await page.getByRole("checkbox", { name: /I accept these terms/ }).check();
  await page.getByRole("button", { name: "Buy private research", exact: true }).click();
  await page.getByText("Synthetic private browser answer", { exact: true }).waitFor();
  assert.equal(posted, 1); assert.equal(signed, 1); assert.equal(recovered, 1);
  assert(await page.getByRole("button", { name: "Buy private research", exact: true }).isDisabled());
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "desktop overflow");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export private recovery", exact: true }).click();
  const file = await download; assert.equal(file.suggestedFilename(), "keryx-recovery.json");
  const exported = JSON.parse(await readFile((await file.path())!, "utf8")); assert.equal(exported.id, last!.id);
  await mount();
  await page.getByRole("button", { name: "Recover saved private job", exact: true }).click();
  await page.getByText("Synthetic private browser answer", { exact: true }).waitFor();
  assert.equal(posted, 1); assert.equal(signed, 1);
  sessionOwner = merchants.publicResearchPayee;
  await page.getByRole("button", { name: "Recover private purchase", exact: true }).click();
  await page.getByText(/This action did not finish/).waitFor();
  assert.equal(recovered, 2, "wrong session cannot read another result");
  sessionOwner = payer;
  await page.getByRole("button", { name: "Review a new purchase", exact: true }).click();
  await page.getByLabel("Private research question").fill("Second synthetic question");
  await page.getByRole("button", { name: "Review private price", exact: true }).click();
  await page.getByText("Review the exact price and AI policy before buying.").waitFor();
  await page.getByRole("checkbox", { name: /I accept these terms/ }).check();
  walletOwner = merchants.publicResearchPayee;
  await page.getByRole("button", { name: "Buy private research", exact: true }).click();
  await page.getByText(/This action did not finish/).waitFor();
  assert.equal(posted, 1); assert.equal(signed, 1); assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Delete local private data", exact: true }).click();
  await page.getByRole("group", { name: "Confirm local private deletion" }).waitFor();
  await page.getByRole("button", { name: "Keep local data", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Recover saved private job", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Delete local private data", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete local data", exact: true }).click();
  await page.getByText(/Local private data deleted/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Recover saved private job", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Private research question").inputValue(), "");
  await mount();
  await page.getByRole("button", { name: "Refresh local private jobs", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector<HTMLInputElement>('input[type="file"]')?.disabled);
  assert.equal(await page.getByRole("button", { name: "Recover saved private job", exact: true }).count(), 0);
  await page.getByLabel("Import private recovery").setInputFiles({ name: "private-recovery.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await page.getByText(/Private recovery imported/).waitFor();
  await page.getByRole("button", { name: "Recover private purchase", exact: true }).click();
  await page.getByText("Synthetic private browser answer", { exact: true }).waitFor();
  assert.equal(posted, 1); assert.equal(signed, 1); assert.deepEqual(errors, []);
  console.log("PASS: private React quote/review/EOA checkout, durable response-loss recovery, reload/export, account and wallet changes, pilot gating, consent and mobile/desktop layout. Synthetic HTTP only; no funded payment.");
} finally { await browser.close(); }
