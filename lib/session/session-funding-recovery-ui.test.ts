import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
const owner = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;

beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{SessionFundingRecovery}from'./components/keryx/session-funding-recovery';
    import{GrantSpendDialog}from'./components/keryx/grant-spend-dialog';
    import{createFundingRecord,claimFundingStep,listFundingRecords}from'./lib/buyer/funding-journal';
    import{fundingTransaction}from'./lib/buyer/funding-policy';
    window.currentOwner='${owner}';window.financialActions=[];
    window.grant={status:'error',sessAddr:'${other}',sessionId:'${owner}',cap:0,spent:0,expiresAt:null,grantEpoch:null,error:'A retained funding transaction needs reconciliation before adding funds'};
    const action=()=>window.financialActions.push('unexpected');
    window.rpc={getChainId:async()=>5042,getBlockNumber:async()=>45n,
      getTransaction:async()=>{if(window.holdLookup)await new Promise(resolve=>window.releaseLookup=resolve);return window.transaction},
      getTransactionReceipt:async()=>window.receipt};
    window.seed=async()=>{const row=await createFundingRecord('${owner}','70000','${other}','0');
      await claimFundingStep(row.id,'approval',3,'40');const tx=fundingTransaction(row,'approval');
      window.transaction={hash:'${hash}',from:tx.from,to:tx.to,input:tx.data,value:0n,nonce:3,blockHash:'0x'+'b'.repeat(64),blockNumber:42n};
      window.receipt={transactionHash:'${hash}',blockHash:'0x'+'b'.repeat(64),blockNumber:42n,status:'success'};return row.id};
    window.rows=()=>listFundingRecords('${owner}');
    function App(){const[revision,render]=useState(0);window.update=(values={})=>{Object.assign(window,values);render(n=>n+1)};
      return <main><GrantSpendDialog grantState={window.grant} onActivate={action} onTopUp={action} onRevoke={action} onTryRecover={()=>{}}
        onExtend={async()=>{action();return false}} onRecoverViaSignature={action}/>
        <SessionFundingRecovery key={window.currentOwner} payer={window.currentOwner} revision={String(revision)}/></main>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", alias: { "@": process.cwd() },
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x4444444444444444444444444444444444444444"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [{ name: "synthetic-read-only-rpc", setup(builder) {
      builder.onResolve({ filter: /^wagmi$/ }, args => ({ path: args.path, namespace: "fake-rpc" }));
      builder.onLoad({ filter: /.*/, namespace: "fake-rpc" }, () => ({ contents: "export const usePublicClient=()=>window.rpc", loader: "js" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

async function mount() {
  const context = await browser.newContext({ viewport: { width: 320, height: 844 } });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>' });
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    errors.push(`Unexpected request ${url.pathname}`); return route.abort();
  });
  await page.goto("https://funding-recovery.test");
  await page.getByRole("button", { name: "Recover a saved budget", exact: true }).waitFor();
  await page.evaluate(async () => { const test = window as unknown as { seed(): Promise<string>; update(): void }; await test.seed(); test.update(); });
  await page.getByRole("region", { name: "Inspect existing transaction", exact: true }).waitFor();
  return { page, context, errors };
}
async function originalStatus(page: Page) {
  return page.evaluate(async () => (await (window as unknown as { rows(): Promise<Array<{ approval: { status: string } }>> }).rows())[0].approval.status);
}

it("shows the original 0.07 plan without treating retained custody as a funded budget or offering a new transaction", async () => {
  const { page, context, errors } = await mount();
  try {
    const recovery = page.getByRole("region", { name: "Inspect existing transaction" });
    expect(await recovery.innerText()).toContain("Planned deposit: 0.070000 USDC");
    expect(await recovery.innerText()).toContain("1. Approve: possible");
    expect(await recovery.innerText()).toContain("2. Deposit: ready");
    expect(await recovery.getByRole("button", { name: /approve|deposit/i }).count()).toBe(0);
    expect(await recovery.getByRole("button", { name: "Check original transaction" }).isEnabled()).toBe(false);
    expect(await page.getByText("Your funded budget is saved", { exact: false }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Continue with saved budget" }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { financialActions: string[] }).financialActions)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("keeps the hold on a mismatched receipt and only confirms the exact original through the existing verifier", async () => {
  const { page, context, errors } = await mount();
  try {
    await page.getByLabel("Transaction hash from your wallet").fill(hash);
    await page.evaluate(value => { (window as unknown as { transaction: { from: string } }).transaction.from = value; }, other);
    await page.getByRole("button", { name: "Check original transaction" }).click();
    await page.getByText("The transaction remains unconfirmed.", { exact: false }).waitFor();
    expect(await originalStatus(page)).toBe("possible");
    await page.evaluate(value => { (window as unknown as { transaction: { from: string } }).transaction.from = value; }, owner);
    await page.getByRole("button", { name: "Check original transaction" }).click();
    await expect.poll(() => originalStatus(page)).toBe("confirmed");
    expect(await page.getByText("2. Deposit: ready", { exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { financialActions: string[] }).financialActions)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("does not show the previous owner's original after an account change during inspection", async () => {
  const { page, context, errors } = await mount();
  try {
    await page.evaluate(() => { (window as unknown as { holdLookup: boolean }).holdLookup = true; });
    await page.getByLabel("Transaction hash from your wallet").fill(hash);
    await page.getByRole("button", { name: "Check original transaction" }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseLookup?: () => void }).releaseLookup)).toBe("function");
    await page.evaluate(value => { (window as unknown as { update(v: unknown): void }).update({ currentOwner: value }); }, other);
    await page.evaluate(() => { (window as unknown as { releaseLookup(): void }).releaseLookup(); });
    await expect.poll(() => originalStatus(page)).toBe("confirmed");
    expect(await page.getByRole("region", { name: "Inspect existing transaction" }).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
