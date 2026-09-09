/** Real React/IndexedDB/signature path with an unfunded synthetic wallet and intercepted HTTP. */
import { build } from "esbuild";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { buyerTypedData, authorizationSchema } from "../lib/buyer/protocol";
import { buyerJobId } from "../lib/buyer/policy";
import { a2aResearchPackageForVersion } from "../lib/a2a/research-package-definition";
import { researchReceiptDigest, sha256 } from "../lib/research-receipt-integrity";
import { decodeFunctionData, erc20Abi } from "viem";
import { GATEWAY_DEPOSIT_ABI } from "../lib/buyer/funding-policy";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"b".repeat(40)}`;
const question = "Browser checkout regression";
const requirement = { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "50000", payTo: payee,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {createWalletClient,custom} from 'viem';
  import {ResearchRequest} from './components/keryx/research-request';
  import {ResearchWorkspace} from './components/keryx/research-workspace';
  import {ResearchSavedJobs} from './components/keryx/research-saved-jobs';
  window.testBuyerWallet=createWalletClient({account:'${account.address}',transport:custom({request:request=>window.syntheticWalletRequest(request)},{retryCount:0})});
  window.testFundingChain={getChainId:async()=>5042002,readContract:async()=>200000n,getBalance:async()=>1000000000000000000n,
    estimateGas:async()=>21000n,estimateFeesPerGas:async()=>({maxFeePerGas:1000000n,maxPriorityFeePerGas:1000000n}),
    getTransactionCount:async()=>window.syntheticFundingState('nonce'),getBlockNumber:async()=>BigInt(await window.syntheticFundingState('head')),
    getTransaction:async({hash})=>{const value=await window.syntheticFundingState('tx',hash);return {...value,value:BigInt(value.value),blockNumber:BigInt(value.blockNumber)};},
    getTransactionReceipt:async({hash})=>{const value=await window.syntheticFundingState('receipt',hash);return {...value,blockNumber:BigInt(value.blockNumber)};}};
  createRoot(document.getElementById('root')).render(React.createElement(ResearchWorkspace,null,
    React.createElement(ResearchRequest,{mode:'quick',budget:0.03,version:'1.0.0',total:0.05,payee:'${payee}'}),React.createElement(ResearchSavedJobs)));
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, metafile: true,
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-wagmi", setup(b) {
    b.onResolve({ filter: /^(wagmi|next\/image)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents: args.path === "next/image" ? "export default function Image(){return null;}" : `
      export const useAccount=()=>({address:'${account.address}',chainId:5042002});
      export const useWalletClient=()=>({data:window.testBuyerWallet});
      export const usePublicClient=()=>window.testFundingChain;
      export const useSwitchChain=()=>({switchChainAsync:async()=>{},isPending:false});
      export const useConnect=()=>({connect:()=>{},connectors:[],isPending:false});
    `, loader: "js" }));
  } }] });
assert(!Object.keys(bundle.metafile.inputs).some(path => /^lib\/(config|db\/)/.test(path)), "Server dependency in browser UI bundle");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(15_000);
  let signed = 0; let paid = 0; let lookups = 0;
  let fundingTransactions = 0; let fundingNonce = 7; let head = 100; let gatewayAvailable = "0";
  const funding = new Map<string, { tx: object; receipt: object }>();
  await context.exposeFunction("syntheticFundingState", (kind: string, hash?: string) => {
    if (kind === "nonce") return fundingNonce;
    if (kind === "head") return head;
    const saved = hash ? funding.get(hash) : null;
    if (!saved) throw new Error("Synthetic funding transaction missing");
    return kind === "tx" ? saved.tx : saved.receipt;
  });
  let paidId = ""; let completed = false; let substituted = false;
  const answer = "Synthetic research answer for browser recovery.";
  function receipt() {
    const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { id: paidId,
      question: substituted ? "Substituted research question" : question, answer, answerSha256: sha256(answer), budgetUsdc: 0.03, researchMode: "quick" },
      agency: { decisions: [{ sourceName: "Synthetic source", action: "SKIP", rationale: "No relevant evidence", priceUsdc: 0.001, targets: [] }] },
      settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0, pendingCreatorUsdc: 0, simulatedCreatorUsdc: 0 } };
    return { payload, integrity: { algorithm: "sha256", canonicalization: "keryx-json-v1", scope: "payload", digest: researchReceiptDigest(payload) } };
  }
  const errors: string[] = [];
  await context.exposeFunction("syntheticWalletRequest", async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return "0x4cef52";
    if (method === "eth_sendTransaction") {
      const value = params?.[0] as { from: string; to: string; data: `0x${string}`; nonce: string; value: string };
      assert.equal(value.from.toLowerCase(), account.address.toLowerCase());
      assert.equal(Number(BigInt(value.nonce)), fundingNonce); assert.equal(BigInt(value.value ?? "0"), BigInt(0));
      const approving = value.to.toLowerCase() === requirement.asset.toLowerCase();
      const decoded = approving ? decodeFunctionData({ abi: erc20Abi, data: value.data }) : decodeFunctionData({ abi: GATEWAY_DEPOSIT_ABI, data: value.data });
      assert.equal(decoded.functionName, approving ? "approve" : "deposit");
      assert.equal(String(decoded.args?.[0]).toLowerCase(), (approving ? requirement.extra.verifyingContract : requirement.asset).toLowerCase());
      assert.equal(decoded.args?.[1], BigInt(50000));
      if (!approving) { assert.equal(value.to.toLowerCase(), requirement.extra.verifyingContract.toLowerCase()); gatewayAvailable = "50000"; }
      const hash = `0x${String(++fundingTransactions).padStart(64, "0")}`;
      const blockNumber = String(head + 1), blockHash = `0x${"d".repeat(64)}`;
      funding.set(hash, { tx: { hash, from: value.from, to: value.to, input: value.data, value: "0", nonce: fundingNonce, blockHash, blockNumber },
        receipt: { transactionHash: hash, blockHash, blockNumber, status: "success" } });
      fundingNonce++; head += 2;
      if (!approving) throw new Error("Synthetic lost response after deposit broadcast");
      return hash;
    }
    if (method === "eth_signTypedData_v4") {
      signed++;
      const data = JSON.parse(String(params?.[1]));
      assert.equal(Number(data.domain.chainId), 5042002);
      assert.equal(data.domain.verifyingContract.toLowerCase(), requirement.extra.verifyingContract.toLowerCase());
      const authorization = authorizationSchema.parse({ ...data.message, value: BigInt(data.message.value).toString(),
        validAfter: BigInt(data.message.validAfter).toString(), validBefore: BigInt(data.message.validBefore).toString() });
      assert.equal(authorization.value, "50000"); assert.equal(authorization.to.toLowerCase(), payee);
      return account.signTypedData(buyerTypedData(authorization));
    }
    throw new Error("Unexpected wallet operation");
  });
  await context.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/api/session/credit") {
      await route.fulfill({ json: { status: "known", address: account.address, network: "eip155:5042002", available: gatewayAvailable } }); return;
    }
    if (url.pathname === "/api/agent/ask") {
      if (request.method() === "GET") {
        lookups++;
        if (!completed) { await route.fulfill({ status: 404, json: {} }); return; }
        await route.fulfill({ json: { status: "completed", queryId: paidId, answer, researchPackage: a2aResearchPackageForVersion("quick", "1.0.0"),
          pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03, settledCreatorSpendUsdc: 0, pendingCreatorSpendUsdc: 0, unusedCreatorReserveUsdc: 0.03 } } }); return;
      }
      if (request.headers()["payment-signature"]) {
        paid++; assert.equal(JSON.parse(request.postData()!).question, question);
        paidId = buyerJobId(JSON.parse(Buffer.from(request.headers()["payment-signature"], "base64").toString()).authorization);
        await route.fulfill({ status: 500, headers: { "payment-response": encode({ success: true, payer: account.address, network: "eip155:5042002", transaction: "synthetic-payment" }) }, body: "delivery interrupted" }); return;
      }
      await route.fulfill({ status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [requirement] }) }, body: "{}" }); return;
    }
    if (url.pathname === `/api/dispatch/${paidId}/receipt`) {
      const value = receipt(); await route.fulfill({ json: value, headers: { "x-keryx-receipt-digest": value.integrity.digest } }); return;
    }
    await route.fulfill({ status: 200, contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root" class="mx-auto max-w-[1080px] space-y-10 px-4 py-12 sm:px-[30px]"></main>' });
  });
  const page = await context.newPage(); page.on("pageerror", error => { errors.push(error.message); console.error(`Synthetic checkout runtime: ${error.message}`); });
  async function mount() {
    await page.goto("https://keryx.cc/research");
    if (process.env.BUYER_UI_CSS) await page.addStyleTag({ content: await readFile(process.env.BUYER_UI_CSS, "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  }
  await mount();
  await page.getByLabel("Research question", { exact: true }).fill(question);
  await page.locator("summary").filter({ hasText: "Add USDC to Gateway" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Prepare deposit", exact: true }).click();
  await page.getByRole("button", { name: "Approve 0.05 USDC", exact: true }).waitFor();
  assert.equal(fundingTransactions, 0);
  await page.getByRole("button", { name: "Approve 0.05 USDC", exact: true }).click();
  await page.getByText("1. Approve: confirmed", { exact: true }).waitFor();
  assert.equal(fundingTransactions, 1);
  await page.getByRole("button", { name: "Deposit 0.05 USDC", exact: true }).click();
  await page.getByText("Wallet or storage response is uncertain.", { exact: false }).waitFor();
  assert.equal(fundingTransactions, 2);
  await mount();
  await page.getByLabel("Research question", { exact: true }).fill(question);
  await page.locator("summary").filter({ hasText: "Add USDC to Gateway" }).click();
  await page.getByText("2. Deposit: possible", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Deposit 0.05 USDC", exact: true }).count(), 0);
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(`0x${"2".padStart(64, "0")}`);
  await page.getByRole("button", { name: "Check original transaction", exact: true }).click();
  await page.getByText("A saved deposit is confirmed on chain.", { exact: false }).waitFor();
  assert.equal(fundingTransactions, 2);
  await page.locator("summary").filter({ hasText: "Add USDC to Gateway" }).click();
  await page.getByRole("button", { name: "Check Gateway balance", exact: true }).click();
  await page.getByText("Available: 0.05 USDC", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Review 0.05 USDC purchase", exact: true }).click();
  const buy = page.getByRole("button", { name: "Buy research — 0.05 USDC", exact: true });
  assert(await buy.isDisabled());
  await page.getByRole("checkbox").check();
  await page.getByLabel("Research question", { exact: true }).fill("Changed question");
  assert(await buy.isDisabled()); assert.equal(signed, 0);
  await page.getByLabel("Research question", { exact: true }).fill(question);
  const downloadPromise = page.waitForEvent("download");
  await buy.click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "keryx-recovery.json");
  const recovery = await readFile((await download.path())!, "utf8");
  const intent = JSON.parse(recovery);
  assert.equal(intent.request.question, question); assert(!recovery.includes('"signature"'));
  await page.getByText("The submission is uncertain.", { exact: false }).waitFor();
  await page.getByText("No order was found.", { exact: false }).waitFor();
  assert.equal(signed, 1); assert.equal(paid, 1); assert(lookups >= 1);
  assert.equal(new URL(page.url()).search, ""); assert(!page.url().includes(intent.queryId));
  await mount();
  await page.getByRole("button", { name: new RegExp(question) }).click();
  await page.getByText("No order was found.", { exact: false }).waitFor();
  await page.getByText("The seller acknowledged the payment", { exact: false }).waitFor();
  assert.equal(signed, 1); assert.equal(paid, 1);
  await page.getByRole("button", { name: "Remove local record", exact: true }).click();
  await page.getByText("It does not cancel work", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Confirm local removal", exact: true }).click();
  await page.getByText("No jobs saved here yet.", { exact: false }).waitFor();
  await page.getByLabel("Import recovery file", { exact: true }).setInputFiles({ name: "recovery.json", mimeType: "application/json", buffer: Buffer.from(recovery) });
  await page.getByText("No order was found.", { exact: false }).waitFor();
  await page.getByRole("button", { name: /imported recovery/ }).waitFor();
  completed = true;
  await page.getByRole("button", { name: "Refresh this job", exact: true }).click();
  await page.getByText("Receipt integrity and original-request binding verified locally.", { exact: false }).waitFor();
  await page.getByRole("heading", { name: "Research answer", exact: true }).waitFor();
  await page.locator("summary").filter({ hasText: "Source decisions" }).click();
  await page.getByText("No relevant evidence", { exact: true }).waitFor();
  const receiptDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified receipt", exact: true }).click();
  assert.equal((await receiptDownload).suggestedFilename(), "keryx-receipt.json");
  if (process.env.BUYER_UI_CSS) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile horizontal overflow");
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Desktop horizontal overflow");
    if (process.env.BUYER_UI_SCREENSHOT) await page.screenshot({ path: process.env.BUYER_UI_SCREENSHOT, fullPage: true });
  }
  substituted = true;
  await page.getByRole("button", { name: "Refresh this job", exact: true }).click();
  await page.getByText("Could not load or verify this job and receipt.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Download verified receipt", exact: true }).count(), 0);
  assert.equal(signed, 1); assert.equal(paid, 1); assert.equal(fundingTransactions, 2); assert.deepEqual(errors, []);
  console.log("PASS: React two-step Gateway funding, lost deposit response and reload/hash recovery without replay, checkout review, changed question refusal, durable recovery, one signature/POST, HTTP-500 uncertainty, reload/import GET-only recovery, verified completed receipt and tamper refusal. Synthetic RPC/wallet; all HTTP intercepted.");
} finally { await browser.close(); }
