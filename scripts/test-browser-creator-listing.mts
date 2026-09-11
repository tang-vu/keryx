/** Actual listing UI with synthetic wallet/API. No signatures or transactions. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
const creator = `0x${"a".repeat(40)}`, payout = `0x${"b".repeat(40)}`, registry = `0x${"d".repeat(40)}`;
declare global { interface Window {
  setListingWallet: (value: { address?: string; chainId?: number }) => void;
  listingWrites: { account: string; chainId: number; functionName: string; args: unknown[] }[];
  listingReceiptChain: number;
  setListingReceipt: (value: { status: "success" | "reverted" }) => void;
  listingToasts: { kind: string; message: string }[];
} }
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ListingControlsPanel} from './app/creator/[id]/listing-controls-panel';
window.listingWrites=[]; window.listingToasts=[];
function Harness(){const [wallet,setWallet]=React.useState({address:'${creator}',chainId:1});
  const [receipt,setReceipt]=React.useState();window.listingReceipt=receipt;window.setListingReceipt=setReceipt;
  window.listingWallet=wallet; window.setListingWallet=setWallet;
  return React.createElement(ListingControlsPanel,{creatorId:'synthetic'});}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false,
  define: { "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "synthetic-wallet", setup(b) {
    b.onResolve({ filter: /^wagmi$|^sonner$|^@\/lib\/registry\/registry-client$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.path === "wagmi" ? `
export const useAccount=()=>window.listingWallet;
export const useWriteContract=()=>({writeContractAsync:async args=>{
  window.listingWrites.push(JSON.parse(JSON.stringify(args,(_,v)=>typeof v==='bigint'?String(v):v)));
  return '0x'+'9'.repeat(64); }});
export const useWaitForTransactionReceipt=({chainId})=>{window.listingReceiptChain=chainId;return {isLoading:false,isSuccess:!!window.listingReceipt,data:window.listingReceipt}};
` : a.path === "sonner" ? `export const toast=Object.fromEntries(['success','error','loading','dismiss'].map(kind=>[kind,message=>window.listingToasts.push({kind,message})]));` : "export const REGISTRY_ABI=[];" }));
  } }] });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let currentPayout = payout, unavailable = false;
  let hold: Promise<void> | undefined, observed: (() => void) | undefined;
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://listing.invalid") return route.abort();
    if (url.pathname === "/api/creator/synthetic/listing") {
      observed?.(); await hold;
      if (unavailable) return route.fulfill({ status: 503, json: { error: "synthetic outage" } });
      return route.fulfill({ json: {
      mode: "onchain", fetchPrice: 0.002, active: true, creator, registryAddress: registry,
      onchainId: `0x${"1".repeat(64)}`, current: { payoutWallet: currentPayout, authors: [], fetchPriceUsdc6: "2000", contentCid: "synthetic", tags: "research" },
    } }); }
    return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("https://listing.invalid"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const save = page.getByRole("button", { name: "Save price", exact: true });
  const delist = page.getByRole("button", { name: "Delist source", exact: true });
  await save.waitFor(); await page.getByRole("slider").focus(); await page.keyboard.press("ArrowRight");
  assert(await save.isDisabled()); assert(await delist.isDisabled());
  await page.getByText("Connect your creator wallet on Arc Testnet before changing this listing.", { exact: true }).waitFor();
  for (const wallet of [{ address: payout, chainId: 5042002 }, { chainId: 5042002 }]) {
    await page.evaluate(w => window.setListingWallet(w), wallet);
    assert(await save.isDisabled()); assert(await delist.isDisabled());
  }
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 0);
  await page.evaluate(address => window.setListingWallet({ address, chainId: 5042002 }), creator);
  await save.click(); await page.waitForFunction(() => window.listingWrites.length === 1);
  await delist.click(); await page.getByRole("button", { name: "Click again to confirm", exact: false }).click();
  await page.waitForFunction(() => window.listingWrites.length === 2);
  const writes = await page.evaluate(() => window.listingWrites);
  assert.deepEqual(writes.map(x => [x.account, x.chainId, x.functionName]), [[creator, 5042002, "update"], [creator, 5042002, "deactivate"]]);
  assert.equal(writes[0].args[1], payout); assert.equal(writes[0].args[3], "3000");
  assert.equal(await page.evaluate(() => window.listingReceiptChain), 5042002);
  await page.evaluate(() => window.setListingReceipt({ status: "reverted" }));
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("Transaction reverted")));
  assert.equal((await page.evaluate(() => window.listingToasts.filter(x => x.kind === "success"))).length, 0);
  await page.evaluate(() => window.setListingReceipt({ status: "success" }));
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "success" && x.message === "Transaction confirmed. Refreshing registry state."));

  // A price edit must not silently restore the payout wallet from page-load time.
  async function freshPage() {
    await page.goto("https://listing.invalid"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const path of process.env.CREATOR_UI_CSS?.split("|") ?? []) await page.addStyleTag({ path });
    await save.waitFor();
    await page.evaluate(address => window.setListingWallet({ address, chainId: 5042002 }), creator);
    await page.getByRole("slider").focus(); await page.keyboard.press("ArrowRight");
  }
  await freshPage(); currentPayout = `0x${"c".repeat(40)}`;
  await save.click();
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("Listing changed")));
  await page.getByText(currentPayout, { exact: true }).waitFor({ state: "visible" });
  await page.getByText("The listing changed. Review these details before choosing your change again.", { exact: true }).waitFor();
  if (process.env.CREATOR_UI_CSS) assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Creator review must fit a mobile viewport");
  if (process.env.CREATOR_UI_SCREENSHOT) await page.screenshot({ path: process.env.CREATOR_UI_SCREENSHOT, fullPage: true });
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 0);
  await page.getByRole("slider").focus(); await page.keyboard.press("ArrowRight");
  await save.click(); await page.waitForFunction(() => window.listingWrites.length === 1);
  assert.equal((await page.evaluate(() => window.listingWrites))[0].args[1], currentPayout);

  unavailable = true;
  await delist.click(); await page.getByRole("button", { name: "Click again to confirm", exact: false }).click();
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("could not be refreshed")));
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 1);
  unavailable = false;

  await freshPage();
  let release!: () => void;
  hold = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { observed = resolve; });
  await save.click(); await requested;
  await page.evaluate(address => window.setListingWallet({ address, chainId: 5042002 }), payout);
  await page.getByText("Switch accounts before signing.", { exact: false }).waitFor();
  release(); hold = undefined; observed = undefined;
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("Wallet or source changed")));
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: creator listing pins wallet/network, distinguishes revert, refuses stale payout and unavailable authority, and stops after wallet changes during refresh. Synthetic wallet; no signing or settlement.");
} finally { await browser.close(); }
