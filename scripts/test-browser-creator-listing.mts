/** Actual listing UI with synthetic wallet/API. No signatures or transactions. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { ARC_MAINNET_PROFILE,ARC_TESTNET_PROFILE,type ArcNetworkProfile } from "../lib/arc-network-profile";
const creator = `0x${"a".repeat(40)}`, payout = `0x${"b".repeat(40)}`, registry = `0x${"d".repeat(40)}`;
declare global { interface Window {
  setListingWallet: (value: { address?: string; chainId?: number }) => void;
  listingWrites: { account: string; chainId: number; functionName: string; args: unknown[] }[];
  listingReceiptChain: number;
  setListingReceipt: (value: { status: "success" | "reverted" }) => void;
  listingToasts: { kind: string; message: string }[];
} }
async function exercise(profile:ArcNetworkProfile,registryVersion:1|3){
const originalRevision="9007199254740993";
const onchainId=`0x${"1".repeat(64)}`;
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
  define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(profile.name), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION": JSON.stringify(String(registryVersion)), "process.env.NODE_ENV": '"development"' }, plugins: [{ name: "synthetic-wallet", setup(b) {
    b.onResolve({ filter: /^wagmi$|^sonner$/ }, a => ({ path: a.path, namespace: "fixture" }));
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
  let currentPayout = payout, currentRegistry=registry, unavailable = false;
  let currentVersion:number|undefined=registryVersion,currentRevision:string|undefined=originalRevision;
  const setWallet=(value:{address?:string;chainId?:number})=>page.evaluate(w=>window.setListingWallet(w),value);
  let hold: Promise<void> | undefined, observed: (() => void) | undefined;
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://listing.invalid") return route.abort();
    if (url.pathname === "/api/creator/synthetic/listing") {
      observed?.(); await hold;
      if (unavailable) return route.fulfill({ status: 503, json: { error: "synthetic outage" } });
      return route.fulfill({ json: {
      mode: "onchain", fetchPrice: 0.002, active: true, creator, registryAddress: currentRegistry,
      registryVersion:currentVersion,revision:currentVersion===1?undefined:currentRevision,
      onchainId, current: { payoutWallet: currentPayout, authors: [{ wallet: payout, basisPoints: 10000 }], fetchPriceUsdc6: "2000", contentCid: "synthetic", tags: "research" },
    } }); }
    return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("https://listing.invalid"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const save = page.getByRole("button", { name: "Save price", exact: true });
  const delist = page.getByRole("button", { name: "Delist source", exact: true });
  await save.waitFor(); await page.getByRole("slider").focus(); await page.keyboard.press("ArrowRight");
  assert(await save.isDisabled()); assert(await delist.isDisabled());
  await page.getByText(`Connect your creator wallet on ${profile.testnet?profile.label:"Arc mainnet"} before changing this listing.`, { exact: true }).waitFor();
  for (const wallet of [{ address: payout, chainId: profile.chainId }, { chainId: profile.chainId }]) {
    await setWallet(wallet);
    assert(await save.isDisabled()); assert(await delist.isDisabled());
  }
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 0);
  await setWallet({address:creator,chainId:profile.chainId});
  await save.click(); await page.waitForFunction(() => window.listingWrites.length === 1);
  await delist.click(); await page.getByRole("button", { name: "Click again to confirm", exact: false }).click();
  await page.waitForFunction(() => window.listingWrites.length === 2);
  const writes = await page.evaluate(() => window.listingWrites);
  assert.deepEqual(writes.map(x => [x.account, x.chainId, x.functionName]), [[creator, profile.chainId, registryVersion===1?"update":"updatePrice"], [creator, profile.chainId, "deactivate"]]);
  if(registryVersion===1){
    assert.equal(writes[0].args[1], payout); assert.equal(writes[0].args[3], "3000");
    assert.deepEqual(writes[1].args,[onchainId]);
  }else{
    assert.deepEqual(writes[0].args,[onchainId,originalRevision,"3000"]);
    assert.deepEqual(writes[1].args,[onchainId,originalRevision]);
  }
  assert.equal(await page.evaluate(() => window.listingReceiptChain), profile.chainId);
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
    await setWallet({address:creator,chainId:profile.chainId});
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
  const reviewedWrite=(await page.evaluate(() => window.listingWrites))[0];
  if(registryVersion===1)assert.equal(reviewedWrite.args[1], currentPayout);
  else assert.deepEqual(reviewedWrite.args,[onchainId,originalRevision,"3000"],"V3 price edits never resubmit payout or author terms");

  unavailable = true;
  await delist.click(); await page.getByRole("button", { name: "Click again to confirm", exact: false }).click();
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("could not be refreshed")));
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 1);
  unavailable = false;

  // A deployment version change cannot switch the selector family of a bundled page.
  await freshPage();currentVersion=registryVersion===1?3:1;
  await save.click();await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Wallet or source changed")));
  assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Foreign registry version must not reach the wallet");
  currentVersion=registryVersion;

  if(registryVersion===3){
    // A revision change alone is signing state, including values beyond JS safe integers.
    await freshPage();currentRevision="9007199254740994";
    await save.click();await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Listing changed")));
    assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Stale revision cannot open a wallet prompt");
    await page.getByRole("slider").focus();await page.keyboard.press("ArrowRight");
    await save.click();await page.waitForFunction(()=>window.listingWrites.length===1);
    assert.deepEqual((await page.evaluate(()=>window.listingWrites))[0].args,[onchainId,currentRevision,"3000"],"Refreshed revision stays exact when signed");
    currentRevision=originalRevision;

    for(const invalidRevision of [undefined,"0","01","18446744073709551616"]){
      await freshPage();currentRevision=invalidRevision;
      await save.click();await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Listing data is unavailable")));
      assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Missing or malformed V3 revision grants no signing authority");
      currentRevision=originalRevision;
    }

    await freshPage();currentVersion=undefined;
    await delist.click();await page.getByRole("button",{name:"Click again to confirm",exact:false}).click();
    await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Listing data is unavailable")));
    assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Omitted V3 version cannot downgrade to a legacy delist");
    currentVersion=registryVersion;

    await freshPage();currentRevision="9007199254740992";
    await delist.click();await page.getByRole("button",{name:"Click again to confirm",exact:false}).click();
    await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Listing changed")));
    assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Delisting rejects an obsolete or mismatched revision");
    currentRevision=originalRevision;
  }

  await freshPage();
  let release!: () => void;
  hold = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { observed = resolve; });
  await save.click(); await requested;
  await setWallet({address:payout,chainId:profile.chainId});
  await page.getByText("Switch accounts before signing.", { exact: false }).waitFor();
  release(); hold = undefined; observed = undefined;
  await page.waitForFunction(() => window.listingToasts.some(x => x.kind === "error" && x.message.includes("Wallet or source changed")));
  assert.equal((await page.evaluate(() => window.listingWrites)).length, 0);
  if(!profile.testnet){
    await freshPage();currentRegistry=`0x${"e".repeat(40)}`;
    await save.click();await page.waitForFunction(()=>window.listingToasts.some(x=>x.kind==="error"&&x.message.includes("Wallet or source changed")));
    assert.equal((await page.evaluate(()=>window.listingWrites)).length,0,"Foreign server registry must never reach a mainnet wallet");
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${profile.name} registry V${registryVersion}: creator listing pins wallet/network/registry/version, distinguishes revert, refuses stale payout and unavailable authority, and stops after wallet changes during refresh.${registryVersion===3?" Exact revision-bound price/delist calls reject stale, missing and malformed revisions or version downgrades.":" Legacy V1 update/delist selectors remain compatible."} Synthetic wallet; no signing or settlement.`);
} finally { await browser.close(); }
}
for(const profile of [ARC_TESTNET_PROFILE,ARC_MAINNET_PROFILE])for(const version of [1,3] as const)await exercise(profile,version);
