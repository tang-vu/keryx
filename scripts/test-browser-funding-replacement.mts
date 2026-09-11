/** Real React and IndexedDB; synthetic RPC only. No funded wallet or network transaction. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fundingTransaction } from "../lib/buyer/funding-policy";
declare global { interface Window { fundingJournal: typeof import("../lib/buyer/funding-journal"); setFundingPayer: (payer: string) => void; } }
const payer = `0x${"a".repeat(40)}`, oldHash = `0x${"1".repeat(64)}`, replacementHash = `0x${"2".repeat(64)}`, blockHash = `0x${"3".repeat(64)}`;
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ResearchFunding} from './components/keryx/research-funding';
  import * as journal from './lib/buyer/funding-journal'; window.fundingJournal=journal;
  window.fundingChain={getChainId:async()=>5042002,
    getTransaction:async({hash})=>{const x=await window.rpcFixture('tx',hash);return {...x,value:BigInt(x.value),blockNumber:BigInt(x.blockNumber)}},
    getTransactionReceipt:async({hash})=>{const x=await window.rpcFixture('receipt',hash);return {...x,blockNumber:BigInt(x.blockNumber)}},
    getBlockNumber:async()=>102n,getBlock:async()=>({hash:'${blockHash}',number:101n})};
  const noop=()=>{};
  function Harness(){const [payer,setPayer]=React.useState('${payer}');window.setFundingPayer=setPayer;
    return React.createElement(ResearchFunding,{payer,initialAmount:0.05,disabled:false,onBusy:noop,onChanged:noop});}
  createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,
    React.createElement(Harness)));
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "wallet-free", setup(b) {
    b.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useWalletClient=()=>({});export const usePublicClient=()=>window.fundingChain;" }));
  } }] });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let tx: Record<string, unknown> = {}, receipt: Record<string, unknown> = {}, activeHash = replacementHash;
  await context.exposeFunction("rpcFixture", (kind: string, hash: string) => {
    if (hash !== activeHash) throw new Error("Original is unavailable; no inferred failure");
    return kind === "tx" ? tx : receipt;
  });
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' }));
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  async function mount() { await page.goto("https://funding.invalid"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
  await mount();
  const row = await page.evaluate(async ({ payer, oldHash }) => {
    const api = window.fundingJournal, row = await api.createFundingRecord(payer, "50000");
    await api.claimFundingStep(row.id, "approval", 7, "100"); await api.saveFundingHash(row.id, "approval", oldHash);
    return api.readFundingRecord(row.id);
  }, { payer, oldHash });
  const planned = fundingTransaction(row, "approval");
  tx = { hash: replacementHash, from: payer, to: planned.to, input: planned.data, value: "0", nonce: 7, blockHash, blockNumber: "101" };
  receipt = { transactionHash: replacementHash, blockHash, blockNumber: "101", status: "success" };
  await mount(); await page.locator("summary").click();
  await page.getByText("1. Approve: submitted", { exact: true }).waitFor();
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(replacementHash);
  await page.getByRole("button", { name: "Check replacement transaction", exact: true }).click();
  await page.getByText("The matching approval is finalized", { exact: false }).waitFor();
  const approved = await page.evaluate(id => window.fundingJournal.readFundingRecord(id), row.id);
  assert.equal(approved.approval.status, "confirmed"); assert.equal(approved.approval.originalHash, oldHash); assert(approved.activePayer);
  await page.evaluate(async id => {
    await window.fundingJournal.claimFundingStep(id, "deposit", 8, "100");
    await window.fundingJournal.saveFundingHash(id, "deposit", `0x${"4".repeat(64)}`);
  }, row.id);
  activeHash = `0x${"6".repeat(64)}`;
  tx = { ...tx, hash: activeHash, nonce: 8, to: payer, input: "0x" }; receipt = { ...receipt, transactionHash: activeHash };
  await mount(); await page.locator("summary").click();
  await page.getByText("2. Deposit: submitted", { exact: true }).waitFor();
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(`0x${"f".repeat(64)}`);
  await page.getByRole("button", { name: "Check replacement transaction", exact: true }).click();
  await page.getByText("Could not complete this step.", { exact: false }).waitFor();
  assert((await page.evaluate(id => window.fundingJournal.readFundingRecord(id), row.id)).activePayer);
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(activeHash);
  await page.getByRole("button", { name: "Check replacement transaction", exact: true }).click();
  await page.getByText("The original transaction was replaced by a different call.", { exact: false }).waitFor();
  const replaced = await page.evaluate(id => window.fundingJournal.readFundingRecord(id), row.id);
  assert.equal(replaced.deposit.status, "replaced"); assert.equal(replaced.activePayer, undefined);
  assert.equal(await page.getByText("A saved deposit is confirmed on chain.", { exact: false }).count(), 0);
  await mount(); await page.locator("summary").click();
  await page.getByText("original replaced by a different call; deposit not confirmed", { exact: false }).waitFor();
  assert.deepEqual(errors, []);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const depositCall = fundingTransaction(row, "deposit");
  await fresh.exposeFunction("rpcFixture", (kind: string, hash: string) => {
    assert.equal(hash, replacementHash);
    return kind === "tx" ? { ...tx, hash, to: depositCall.to, input: depositCall.data }
      : { ...receipt, transactionHash: hash };
  });
  await fresh.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' }));
  const recoveryPage = await fresh.newPage(); recoveryPage.on("pageerror", error => errors.push(error.message));
  await recoveryPage.goto("https://funding.invalid"); await recoveryPage.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const path of process.env.BUYER_UI_CSS?.split("|") ?? []) await recoveryPage.addStyleTag({ path });
  await recoveryPage.locator("summary").click();
  await recoveryPage.getByLabel("Previous deposit transaction hash", { exact: true }).fill(replacementHash);
  await recoveryPage.getByRole("button", { name: "Check previous deposit", exact: true }).click();
  await recoveryPage.getByText("Successful deposit call for 0.05 USDC", { exact: false }).waitFor();
  await recoveryPage.getByText("This is a past deposit, not your current available balance.", { exact: false }).waitFor();
  if (process.env.BUYER_UI_CSS) assert(await recoveryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile funding layout must not overflow");
  if (process.env.BUYER_UI_SCREENSHOT) await recoveryPage.screenshot({ path: process.env.BUYER_UI_SCREENSHOT, fullPage: true });
  assert.equal((await recoveryPage.evaluate(payer => window.fundingJournal.listFundingRecords(payer), payer)).length, 0, "Historical observation must not reconstruct a signing plan");
  await recoveryPage.evaluate(() => window.setFundingPayer(`0x${"b".repeat(40)}`));
  assert.equal(await recoveryPage.getByText("Successful deposit call", { exact: false }).count(), 0, "Account change clears the historical observation");
  assert.deepEqual(errors, []); await fresh.close();
  console.log("PASS: Chromium replacement recovery, unknown hashes stay locked, changed calls are not deposits, retained history, and past-deposit lookup with an empty journal and payer-change clearing. Synthetic RPC; no signing or settlement.");
} finally { await browser.close(); }
