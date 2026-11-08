import { build } from "esbuild";
import { chromium, type Browser, type Download, type Page } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorizationSchema, buyerTypedData } from "./protocol";
import { buyerJobId } from "./policy";
import { circleSdkBrowserPlugin } from "../../scripts/circle-sdk-browser-plugin.mjs";
import { researchFundingMessages as copy } from "../../locales/en/research-funding";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../../test-support/research-browser-auth-fixture";

type Fault = "url" | "create" | "append" | "click";
interface Harness {
  journals: typeof import("./browser-journal");
  fault: Fault | "";
  created: { url: string; blob: Blob }[];
  revoked: string[];
  unhandled: string[];
}
const account = privateKeyToAccount(`0x${"1".repeat(64)}`), payee = `0x${"b".repeat(40)}`;
const question = "Synthetic public checkout recovery", otherQuestion = "Another synthetic checkout recovery";
const requirement = { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "50000", payTo: payee,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
let browser: Browser, bundle: string;

beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{createWalletClient,custom}from'viem';
    import{ResearchRequest}from'./components/keryx/research-request';
    import{ResearchWorkspace}from'./components/keryx/research-workspace';
    import{ResearchSavedJobs}from'./components/keryx/research-saved-jobs';
    import * as journals from './lib/buyer/browser-journal';
    window.journals=journals;window.fault='';window.created=[];window.revoked=[];window.unhandled=[];
    window.addEventListener('unhandledrejection',event=>window.unhandled.push(String(event.reason)));
    let activeDownload=false;
    function fail(name){if(window.fault!==name)return false;window.fault='';activeDownload=false;return true;}
    const objectURL=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(fail('url'))throw new DOMException('Controlled URL failure','NotSupportedError');const url=objectURL(blob);activeDownload=true;window.created.push({url,blob});return url;};
    URL.revokeObjectURL=url=>{window.revoked.push(url);return revoke(url);};
    const create=document.createElement.bind(document);
    document.createElement=(name,options)=>{if(activeDownload&&name==='a'&&fail('create'))throw new DOMException('Controlled anchor failure','NotSupportedError');return create(name,options);};
    const append=document.body.appendChild.bind(document.body);
    document.body.appendChild=node=>{if(activeDownload&&node instanceof HTMLAnchorElement&&fail('append'))throw new DOMException('Controlled append failure','HierarchyRequestError');return append(node);};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(activeDownload&&fail('click'))throw new DOMException('Controlled click failure','SecurityError');try{return click.call(this);}finally{activeDownload=false;}};
    window.testBuyerWallet=createWalletClient({account:'${account.address}',transport:custom({request:request=>window.syntheticWalletRequest(request)},{retryCount:0})});
    window.testFundingChain={getChainId:async()=>5042002,readContract:async()=>200000n,getBalance:async()=>1000000000000000000n};
    createRoot(document.getElementById('root')).render(<ResearchWorkspace>
      <ResearchRequest mode="quick" budget={0.03} version="1.0.0" total={0.05} payee="${payee}"/><ResearchSavedJobs/>
    </ResearchWorkspace>);
  ` }, bundle: true, minify: true, platform: "browser", format: "iife", jsx: "automatic", write: false, metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [signedOutResearchAuthFixture(), circleSdkBrowserPlugin(), { name: "synthetic-checkout-wallet", setup(api) {
      api.onResolve({ filter: /^(wagmi|next\/image)$/ }, args => ({ path: args.path, namespace: "checkout-wallet-fixture" }));
      api.onLoad({ filter: /.*/, namespace: "checkout-wallet-fixture" }, args => ({ loader: "js", resolveDir: process.cwd(), contents: args.path === "next/image" ? "export default function Image(){return null;}" : `
        export const useAccount=()=>({address:'${account.address}',chainId:5042002});
        export const useWalletClient=()=>({data:window.testBuyerWallet});
        export const usePublicClient=()=>window.testFundingChain;
        export const useSwitchChain=()=>({switchChainAsync:async()=>{},isPending:false});
        export const useConnect=()=>({connect:()=>{},connectors:[],isPending:false});
      ` }));
    } }],
  });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-request.tsx", "components/keryx/research-checkout.tsx", "components/keryx/research-funding.tsx",
    "components/keryx/research-saved-jobs.tsx", "components/keryx/research-workspace.tsx", "lib/buyer/browser-storage.ts", "lib/buyer/browser-journal.ts", "lib/buyer/browser-client.ts", "lib/buyer/connected-wallet.ts", "lib/buyer/download.ts"]);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 40_000);
afterAll(async () => { await browser?.close(); });

async function setup(mode: "sign" | "reject" | "hold" = "sign") {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  const counts = { quotes: 0, signatureRequests: 0, signatures: 0, paid: 0 }, errors: string[] = [], unexpected: string[] = [];
  const calls: { method: string; url: string; payment: boolean }[] = [];
  let release: (() => void) | undefined;
  await context.exposeFunction("syntheticWalletRequest", async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_accounts") return [account.address];
    if (method === "eth_chainId") return "0x4cef52";
    if (method === "eth_signTypedData_v4") {
      counts.signatureRequests++;
      if (mode === "hold") await new Promise<void>(done => { release = done; });
      if (mode !== "sign") throw new Error("Synthetic rejected wallet prompt");
      const data = JSON.parse(String(params?.[1]));
      expect(Number(data.domain.chainId)).toBe(5042002);expect(data.domain.verifyingContract.toLowerCase()).toBe(requirement.extra.verifyingContract.toLowerCase());
      const authorization = authorizationSchema.parse({ ...data.message, value: BigInt(data.message.value).toString(), validAfter: BigInt(data.message.validAfter).toString(), validBefore: BigInt(data.message.validBefore).toString() });
      expect(authorization.value).toBe("50000");expect(authorization.to.toLowerCase()).toBe(payee);counts.signatures++;
      return account.signTypedData(buyerTypedData(authorization));
    }
    unexpected.push(`wallet:${method}`);throw new Error("Unexpected synthetic wallet operation");
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === "https://keryx.cc/research" && request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main>' });
    calls.push({ method: request.method(), url: url.href, payment: !!request.headers()["payment-signature"] });
    if (url.origin === "https://keryx.cc" && url.pathname === "/api/session/credit") return route.fulfill({ json: { status: "known", address: account.address, network: "eip155:5042002", available: "50000" } });
    if (url.origin === "https://keryx.cc" && url.pathname.startsWith("/api/auth/")) return route.fulfill({ status: 401, json: {} });
    if (url.origin === "https://keryx.cc" && url.pathname === "/api/agent/ask") {
      if (request.method() === "GET") return route.fulfill({ status: 404, json: {} });
      const body = JSON.parse(request.postData()!);expect([question, otherQuestion]).toContain(body.question);
      if (request.headers()["payment-signature"]) {
        counts.paid++;
        const payment = JSON.parse(Buffer.from(request.headers()["payment-signature"], "base64").toString());
        expect(payment.authorization.value).toBe("50000");expect(payment.authorization.to.toLowerCase()).toBe(payee);expect(buyerJobId(payment.authorization)).toMatch(/^a2a_[a-f0-9]{64}$/);
        // Controlled Testnet acknowledgement, not evidence of actual settlement.
        return route.fulfill({ status: 500, headers: { "payment-response": encode({ success: true, payer: account.address, network: "eip155:5042002", transaction: "synthetic-payment" }) }, body: "Synthetic delivery interruption" });
      }
      counts.quotes++;return route.fulfill({ status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [requirement] }) }, json: {} });
    }
    unexpected.push(`http:${request.method()}:${url.href}`);return route.fulfill({ status: 404, json: {} });
  });
  const page = await context.newPage();page.setDefaultTimeout(4000);page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://keryx.cc/research");await page.addScriptTag({ content: bundle });
  const recoveryButton = page.getByRole("button", { name: copy["researchCheckout.downloadRecovery"], exact: true });
  const downloadError = page.getByRole("alert").filter({ hasText: "Download unavailable. Try again." });
  const buy = page.getByRole("button", { name: "Buy research — 0.050000 USDC", exact: true });
  return { context, page, counts, calls, errors, unexpected, recoveryButton, downloadError, buy, release: () => release?.() };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function review(h: Fixture, value = question) {
  const input = h.page.getByLabel("Research question", { exact: true });
  if (await input.inputValue() !== value) { await input.fill(value);await h.page.getByRole("button", { name: "Review current quote & availability", exact: true }).click(); }
  await h.page.getByRole("button", { name: "Review 0.05 USDC purchase", exact: true }).click();
  expect(await h.buy.isDisabled()).toBe(true);
  await h.page.getByRole("checkbox", { name: copy["researchCheckout.consent"], exact: true }).check();
}
async function originals(h: Fixture) {
  return h.page.evaluate(async () => JSON.stringify(await (window as unknown as Harness).journals.listBrowserJournals()));
}
async function downloaded(download: Download) {
  expect(download.suggestedFilename()).toBe("keryx-recovery.json");expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();expect(stream).not.toBeNull();const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString("utf8");
}
async function download(h: Fixture, click: () => Promise<unknown>) {
  const pending = h.page.waitForEvent("download");await click();return downloaded(await pending);
}
async function fault(h: Fixture, value: Fault) { await h.page.evaluate(value => { (window as unknown as Harness).fault = value; }, value); }
async function feedback(h: Fixture) {
  await h.downloadError.waitFor();
  expect(await h.recoveryButton.evaluate(button => {
    const id = button.getAttribute("aria-describedby"), alert = id ? button.ownerDocument.getElementById(id) : null;
    return !!alert && alert === button.nextElementSibling && alert.getAttribute("role") === "alert" && alert.textContent === "Download unavailable. Try again.";
  })).toBe(true);
}
async function verify(h: Fixture, original: string, before: Fixture["counts"]) {
  expect(await originals(h)).toBe(original);expect(h.counts).toEqual(before);
  expect(h.page.url()).toBe("https://keryx.cc/research");expect(h.errors).toEqual([]);expect(h.unexpected).toEqual([]);
  expect(h.calls.every(call => new URL(call.url).origin === "https://keryx.cc")).toBe(true);
  expect(h.calls.filter(call => call.payment)).toHaveLength(h.counts.paid);
  expect(h.calls.filter(call => call.method === "POST" && !call.payment)).toHaveLength(h.counts.quotes);
  expect(await h.page.evaluate(() => (window as unknown as Harness).unhandled)).toEqual([]);
  await h.page.waitForFunction(() => { const h = window as unknown as Harness;return h.created.length === h.revoked.length; });
  const resources = await h.page.evaluate(() => { const h = window as unknown as Harness;return { types: h.created.map(row => row.blob.type), urls: h.created.map(row => row.url), revoked: h.revoked, anchors: document.querySelectorAll("a[download]").length }; });
  expect(resources.types.every(type => type === "application/json")).toBe(true);expect(resources.revoked).toEqual(resources.urls);expect(resources.anchors).toBe(0);
}
async function close(h: Fixture) { h.release();await h.context.close(); }

it.each(["url", "create", "append", "click"] as const)("reports automatic %s failure and retries the original locally before any signature", async value => {
  const h = await setup();try {
    await review(h);await fault(h, value);await h.buy.click();await h.page.getByText(copy["researchCheckout.stopped"], { exact: true }).waitFor();
    expect(h.counts).toEqual({ quotes: 2, signatureRequests: 0, signatures: 0, paid: 0 });
    await feedback(h);const original = await originals(h), rows = JSON.parse(original);expect(rows).toHaveLength(1);expect(rows[0].submission).toBe("prepared");
    const before = { ...h.counts }, text = await download(h, () => h.recoveryButton.click());
    expect(text).toBe(JSON.stringify(rows[0].intent, null, 2) + "\n");expect(await h.downloadError.count()).toBe(0);
    expect(await h.page.getByText(copy["researchCheckout.stopped"], { exact: true }).count()).toBe(1);await verify(h, original, before);
  } finally { await close(h); }
});
it.each(["url", "create", "append", "click"] as const)("contains manual %s failure without erasing the uncertain purchase acknowledgement", async value => {
  const h = await setup();try {
    await review(h);const text = await download(h, () => h.buy.click());await h.page.getByText(copy["researchCheckout.uncertain"], { exact: true }).waitFor();
    const original = await originals(h), rows = JSON.parse(original), before = { ...h.counts };
    expect(rows[0].submission).toBe("submission_possible");expect(rows[0].acknowledgement.evidence).not.toBeNull();expect(before).toEqual({ quotes: 2, signatureRequests: 1, signatures: 1, paid: 1 });
    await fault(h, value);await h.recoveryButton.click();await feedback(h);
    expect(await h.page.getByText(copy["researchCheckout.uncertain"], { exact: true }).count()).toBe(1);
    expect(await download(h, () => h.recoveryButton.click())).toBe(text);expect(await h.downloadError.count()).toBe(0);await verify(h, original, before);
  } finally { await close(h); }
});
it("preserves exact original download bytes, generic filename and one synthetic signed submission", async () => {
  const h = await setup();try {
    await review(h);const text = await download(h, () => h.buy.click());await h.page.getByText(copy["researchCheckout.uncertain"], { exact: true }).waitFor();
    const original = await originals(h), rows = JSON.parse(original);expect(text).toBe(JSON.stringify(rows[0].intent, null, 2) + "\n");expect(text).not.toContain('"signature"');
    const before = { ...h.counts };expect(before).toEqual({ quotes: 2, signatureRequests: 1, signatures: 1, paid: 1 });
    expect(await download(h, () => h.recoveryButton.click())).toBe(text);expect(await h.downloadError.count()).toBe(0);await verify(h, original, before);
  } finally { await close(h); }
});
it("keeps local retry independent while the original wallet prompt is pending", async () => {
  const h = await setup("hold");try {
    await review(h);const text = await download(h, () => h.buy.click());await h.page.waitForFunction(() => document.body.textContent?.includes("Purchase in progress"));
    await expect.poll(() => h.counts.signatureRequests).toBe(1);const original = await originals(h), before = { ...h.counts };
    await fault(h, "url");await h.recoveryButton.click();await feedback(h);expect(await h.page.getByText(copy["researchCheckout.recoveryReady"], { exact: true }).count()).toBe(1);
    expect(await download(h, () => h.recoveryButton.click())).toBe(text);expect(await h.downloadError.count()).toBe(0);await verify(h, original, before);
    h.release();await h.page.getByText(copy["researchCheckout.walletCancelled"], { exact: true }).waitFor();await verify(h, original, before);
  } finally { await close(h); }
});
it("clears an old recovery error only for a newly reviewed purchase with fresh consent and original", async () => {
  const h = await setup("reject");try {
    await review(h);await fault(h, "url");await h.buy.click();await h.page.getByText(copy["researchCheckout.stopped"], { exact: true }).waitFor();await feedback(h);
    const old = JSON.parse(await originals(h))[0];await review(h);expect(await h.downloadError.count()).toBe(1);
    const text = await download(h, () => h.buy.click());await h.page.getByText(copy["researchCheckout.walletCancelled"], { exact: true }).waitFor();
    expect(await h.downloadError.count()).toBe(0);const original = await originals(h), rows = JSON.parse(original);expect(rows).toHaveLength(2);expect(rows.find((row: { queryId: string }) => row.queryId === old.queryId)).toEqual(old);
    expect(JSON.parse(text).queryId).not.toBe(old.queryId);expect(rows.some((row: { intent: unknown }) => JSON.stringify(row.intent, null, 2) + "\n" === text)).toBe(true);
    expect(h.counts).toEqual({ quotes: 3, signatureRequests: 1, signatures: 0, paid: 0 });await verify(h, original, { ...h.counts });
  } finally { await close(h); }
});
it("discards recovery feedback with the actual request checkout when its question changes", async () => {
  const h = await setup("reject");try {
    await review(h);await fault(h, "url");await h.buy.click();await h.page.getByText(copy["researchCheckout.stopped"], { exact: true }).waitFor();await feedback(h);
    const original = await originals(h), before = { ...h.counts };
    await h.page.getByLabel("Research question", { exact: true }).fill(otherQuestion);expect(await h.recoveryButton.count()).toBe(0);expect(await h.downloadError.count()).toBe(0);
    await h.page.getByRole("button", { name: "Review current quote & availability", exact: true }).click();expect(await h.downloadError.count()).toBe(0);expect(await h.recoveryButton.count()).toBe(0);
    await verify(h, original, { ...before, quotes: before.quotes + 1 });
  } finally { await close(h); }
});
