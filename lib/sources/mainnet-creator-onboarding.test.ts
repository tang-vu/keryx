import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { registrationId } from "./registration-status";

const creator = `0x${"11".repeat(20)}` as const, other = `0x${"22".repeat(20)}` as const;
const registry = `0x${"33".repeat(20)}` as const, hash = `0x${"44".repeat(32)}` as const;
const event = [{ type: "event", name: "SourceRegistered", inputs: [
  { name: "id", type: "bytes32", indexed: true }, { name: "creator", type: "address", indexed: true },
  { name: "contentCid", type: "string", indexed: false },
] }] as const;
const feeds = [1, 2].map(index => {
  const urlHash = `0x${String(index).repeat(64)}` as Hex;
  return { rssUrl: `https://creator.example/feed-${index}.xml`, ok: true, status: 200, mode: "onchain", sourceId: `source-${index}`,
    registryAddress: registry, registerParams: { urlHash, payoutWallet: creator, authors: [{ wallet: creator, basisPoints: 10000 }],
      fetchPriceUsdc6: "16000", contentCid: "", tags: "" } };
});
const receipts = feeds.map(feed => ({ status: "success", transactionHash: hash, logs: [{ address: registry,
  topics: encodeEventTopics({ abi: event, eventName: "SourceRegistered", args: { id: registrationId(creator, feed.registerParams.urlHash), creator } }),
  data: encodeAbiParameters([{ type: "string" }], [""]) }] }));
type Fixture = {
  writes: Array<{ account: string; chainId: number; address: string }>;
  reads: Array<{ chainId: number; address: string }>;
  requests: string[]; errors: string[]; chainQueries: number[];
  results: typeof feeds; receiptMode: string; walletMode: string; rpcMode: string; rpcMissing: boolean;
  releaseWallet(): void; releaseRpc(): void; changeIdentity(value: Record<string, unknown>): void;
};
let browser: Browser, bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{BulkImportForm}from'./components/keryx/bulk-import-form';import{FaucetPanel}from'./components/keryx/faucet-panel';
    window.account={address:'${creator}',chainId:5042,isConnected:true,signedIn:'${creator}'};
    window.listeners=new Set();window.changeIdentity=value=>{window.account={...window.account,...value};for(const listener of window.listeners)listener()};
    window.results=${JSON.stringify(feeds)};window.receipts=${JSON.stringify(receipts)};
    window.writes=[];window.reads=[];window.requests=[];window.errors=[];window.chainQueries=[];
    window.receiptMode='success';window.walletMode='success';window.rpcMode='success';window.rpcMissing=false;window.receiptIndex=0;
    window.fetch=async(url)=>{window.requests.push(url);if(url!=='/api/sources/bulk')throw Error('Unexpected endpoint');return Response.json({results:window.results})};
    window.getChainId=()=>window.rpcMode==='pending'?new Promise(resolve=>{window.releaseRpc=()=>resolve(5042)}):Promise.resolve(5042);
    window.waitReceipt=async({hash})=>{if(window.receiptMode==='lost')throw Error('Synthetic receipt timeout');
      const receipt={...window.receipts[window.receiptIndex++%2],transactionHash:hash};return window.receiptMode==='reverted'?{...receipt,status:'reverted'}:
        window.receiptMode==='wrong-event'?{...receipt,logs:[]}:receipt};
    window.write=async args=>{window.writes.push({account:args.account,chainId:args.chainId,address:args.address});
      if(window.walletMode==='pending')return new Promise(resolve=>{window.releaseWallet=()=>resolve('${hash}')});return '${hash}'};
    createRoot(document.getElementById('root')).render(<><FaucetPanel/><BulkImportForm/></>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  }, plugins: [{ name: "synthetic-wallet-and-auth", setup(builder) {
    builder.onResolve({ filter: /^(wagmi|sonner|@\/lib\/hooks\/use-siwe-auth)$/ }, args => ({ path: args.path, namespace: "creator-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "creator-fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents:
      args.path === "sonner" ? "export const toast={error:message=>window.errors.push(message),success:()=>{},message:()=>{}}" : args.path === "wagmi" ? `
        import{useSyncExternalStore}from'react';
        export function useAccount(){return useSyncExternalStore(cb=>{window.listeners.add(cb);return()=>window.listeners.delete(cb)},()=>window.account)}
        export const useWriteContract=()=>({writeContractAsync:window.write});
        export const usePublicClient=options=>{window.chainQueries.push(options.chainId);return window.rpcMissing?undefined:{getChainId:window.getChainId,waitForTransactionReceipt:window.waitReceipt}};
        export const useReadContract=options=>{window.reads.push({chainId:options.chainId,address:options.address});return{data:1250000n,isFetching:false,refetch:async()=>{}}};
        export const useConnectorClient=()=>{throw Error('Mainnet must not mount testnet faucet hooks')};
      ` : "import{useAccount}from'wagmi';export function useSiweAuth(){const account=useAccount();return{session:account.signedIn?{address:account.signedIn}:null}}" }));
  } }] });
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function pageFixture() {
  const page = await browser.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://keryx.cc"); await page.addScriptTag({ content: bundle });
  await page.getByRole("button", { name: /Read feeds/ }).waitFor();
  return page;
}
async function prepare(page: Page) {
  await page.locator("textarea").fill(feeds.map(feed => feed.rssUrl).join("\n"));
  await page.getByRole("button", { name: /Read feeds/ }).click();
  await page.getByRole("button", { name: /Register 2 on-chain/ }).waitFor();
}

it("mainnet creator funding reads only the selected balance and omits testnet faucet actions", async () => {
  const page = await pageFixture();
  try {
    expect(await page.locator("body").innerText()).toContain("Arc mainnet wallet funding");
    expect(await page.locator("body").innerText()).toContain("Wallet USDC: 1.25");
    expect(await page.locator("body").innerText()).not.toMatch(/testnet|faucet/i);
    expect(await page.evaluate(() => (window as unknown as Fixture).reads)).toEqual([
      { chainId: 5042, address: "0x3600000000000000000000000000000000000000" },
    ]);
    expect(await page.evaluate(() => (window as unknown as Fixture).requests)).toEqual([]);
  } finally { await page.close(); }
});

it.each(["registry", "owner", "offline"])("refuses an inexact mainnet %s preparation before any wallet request", async mismatch => {
  const page = await pageFixture();
  try {
    await page.evaluate(({ mismatch, other }) => {
      const state = window as unknown as Fixture;
      if (mismatch === "registry") state.results[0].registryAddress = other;
      if (mismatch === "owner") state.results[0].registerParams.payoutWallet = other;
      if (mismatch === "offline") state.results[0].mode = "offline";
    }, { mismatch, other });
    await page.locator("textarea").fill(feeds[0].rssUrl);
    await page.getByRole("button", { name: /Read feeds/ }).click();
    await page.waitForFunction(() => (window as unknown as Fixture).errors.length > 0);
    expect(await page.evaluate(() => (window as unknown as Fixture).writes)).toEqual([]);
    expect(await page.getByRole("button", { name: /Register .* on-chain/ }).count()).toBe(0);
  } finally { await page.close(); }
});

it.each(["wrong-chain", "missing-rpc"])("does not submit or report success with %s", async state => {
  const page = await pageFixture();
  try {
    await prepare(page);
    await page.evaluate(state => {
      const fixture = window as unknown as Fixture;
      fixture.rpcMissing = state === "missing-rpc";
      fixture.changeIdentity(state === "wrong-chain" ? { chainId: 1 } : {});
    }, state);
    await page.getByRole("button", { name: /Register 2 on-chain/ }).click();
    await page.waitForFunction(() => (window as unknown as Fixture).errors.length > 0);
    expect(await page.evaluate(() => (window as unknown as Fixture).writes)).toEqual([]);
    expect(await page.locator("body").innerText()).not.toContain("Registration confirmed");
  } finally { await page.close(); }
});

it.each(["reverted", "wrong-event", "success"])("labels %s receipts only according to exact registration evidence", async mode => {
  const page = await pageFixture();
  try {
    await prepare(page);
    await page.evaluate(mode => { (window as unknown as Fixture).receiptMode = mode; }, mode);
    await page.getByRole("button", { name: /Register 2 on-chain/ }).click();
    await page.waitForFunction(() => (window as unknown as Fixture).writes.length === 2);
    await page.waitForFunction(() => !document.body.textContent?.includes("Signing on-chain"));
    const text = await page.locator("body").innerText();
    expect(text.includes("Registration confirmed on-chain.")).toBe(mode === "success");
    if (mode === "reverted") expect(text).toContain("Transaction reverted");
    if (mode === "wrong-event") expect(text).toContain("without the expected registration event");
    expect(await page.evaluate(() => (window as unknown as Fixture).writes)).toEqual([
      { account: creator, chainId: 5042, address: registry }, { account: creator, chainId: 5042, address: registry },
    ]);
    expect(await page.evaluate(() => (window as unknown as Fixture).chainQueries.every(chain => chain === 5042))).toBe(true);
  } finally { await page.close(); }
});

it.each(["rpc", "wallet"])("stops obsolete creator work after a %s await", async phase => {
  const page = await pageFixture();
  try {
    await prepare(page);
    await page.evaluate(phase => { const state = window as unknown as Fixture; if (phase === "rpc") state.rpcMode = "pending"; else state.walletMode = "pending"; }, phase);
    await page.getByRole("button", { name: /Register 2 on-chain/ }).click();
    await page.waitForFunction(phase => typeof (window as unknown as Fixture)[phase === "rpc" ? "releaseRpc" : "releaseWallet"] === "function", phase);
    await page.evaluate(other => { (window as unknown as Fixture).changeIdentity({ address: other, signedIn: other }); }, other);
    // Let React commit the account change before releasing the old wallet/RPC callback.
    await page.waitForTimeout(25);
    await page.evaluate(phase => { const state = window as unknown as Fixture; if (phase === "rpc") state.releaseRpc(); else state.releaseWallet(); }, phase);
    await page.waitForFunction(() => !document.body.textContent?.includes("Signing on-chain"));
    expect(await page.evaluate(() => (window as unknown as Fixture).writes.length)).toBe(phase === "rpc" ? 0 : 1);
    if (phase === "wallet") {
      expect(await page.getByLabel(`Original registration transaction for ${feeds[0].rssUrl}`).inputValue()).toBe(hash);
      expect(await page.locator("body").innerText()).toContain("Confirmation unknown");
    }
  } finally { await page.close(); }
});

it("keeps a timed-out original and recovers its receipt without another signature", async () => {
  const page = await pageFixture();
  try {
    await prepare(page);
    await page.evaluate(() => { (window as unknown as Fixture).receiptMode = "lost"; });
    await page.getByRole("button", { name: /Register 2 on-chain/ }).click();
    await page.getByRole("button", { name: "Check original registration" }).waitFor();
    expect(await page.getByRole("button", { name: /Read feeds/ }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: /Register 1 on-chain/ }).isDisabled()).toBe(true);
    await page.evaluate(() => { (window as unknown as Fixture).receiptMode = "success"; });
    await page.getByRole("button", { name: "Check original registration" }).click();
    await page.getByText("Registration confirmed", { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as Fixture).writes.length)).toBe(1);
    expect(await page.getByRole("button", { name: /Register 1 on-chain/ }).isEnabled()).toBe(true);
  } finally { await page.close(); }
});

it.each(["reverted", "wrong-event"])("does not release an unknown original from an unrelated %s receipt", async mode => {
  const page = await pageFixture();
  try {
    await prepare(page);
    await page.evaluate(() => { (window as unknown as Fixture).receiptMode = "lost"; });
    await page.getByRole("button", { name: /Register 2 on-chain/ }).click();
    await page.getByRole("button", { name: "Check original registration" }).waitFor();
    await page.getByLabel(`Original registration transaction for ${feeds[0].rssUrl}`).fill(`0x${"aa".repeat(32)}`);
    await page.evaluate(mode => { (window as unknown as Fixture).receiptMode = mode; }, mode);
    await page.getByRole("button", { name: "Check original registration" }).click();
    await page.getByText(/does not confirm the expected registration or resolve/).waitFor();
    expect(await page.getByRole("button", { name: /Read feeds/ }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: /Register 1 on-chain/ }).isDisabled()).toBe(true);
    expect(await page.getByRole("link", { name: hash, exact: true }).getAttribute("href")).toBe(`https://explorer.arc.io/tx/${hash}`);
    expect(await page.evaluate(() => (window as unknown as Fixture).writes.length)).toBe(1);
    // The actual saved original can still resolve a failed transaction without another prompt.
    await page.getByLabel(`Original registration transaction for ${feeds[0].rssUrl}`).fill(hash);
    await page.getByRole("button", { name: "Check original registration" }).click();
    await page.getByText("Failed", { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: /Read feeds/ }).isEnabled()).toBe(true);
    expect(await page.evaluate(() => (window as unknown as Fixture).writes.length)).toBe(1);
  } finally { await page.close(); }
});
