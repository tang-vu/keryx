import { build } from "esbuild";
import { chromium, type Browser, type Download, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorizationWithNonce, type BuyerIntentEnvelope, type BuyerRequirement } from "./protocol";
import { buyerJobId } from "./policy";
import { encodeBuyerRecovery } from "./recovery";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { researchReceiptDigest, sha256 } from "../research-receipt-integrity";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../../test-support/research-browser-auth-fixture";

type Fault = "url" | "create" | "append" | "click";
interface Harness {
  journals: typeof import("./browser-journal");
  downloadJson: typeof import("./download").downloadBuyerJson;
  fault: Fault | "";
  failRead: string;
  created: { url: string; type: string }[];
  revoked: string[];
  unhandled: string[];
}
let browser: Browser, bundle: string;
const requirement: BuyerRequirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "50000",
  payTo: `0x${"b".repeat(40)}`, maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};
function fixture(n: number, question: string) {
  const authorization = authorizationWithNonce(`0x${"1".repeat(40)}`, requirement, `0x${n.toString(16).padStart(64, "0")}`);
  const intent: BuyerIntentEnvelope = { schema: "keryx-buyer-intent-v1", request: { question, budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }, requirement, authorization, queryId: buyerJobId(authorization) };
  const answer = `Synthetic offline fixture answer for ${question}.`;
  const job = { queryId: intent.queryId, status: "completed", answer, researchPackage: a2aResearchPackageForVersion("quick", "1.0.0"),
    pricing: { serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03, totalPriceUsdc: 0.05, settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
  // Controlled Testnet wire fixture, never evidence of a real settlement.
  const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { id: intent.queryId, question, answer, answerSha256: sha256(answer), budgetUsdc: 0.03, researchMode: "quick" },
    settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01, pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
  const receipt = { payload, integrity: { algorithm: "sha256", scope: "payload", canonicalization: "keryx-json-v1", digest: researchReceiptDigest(payload) } };
  return { intent, job, receipt, answer };
}
const first = fixture(41, "First private receipt download"), second = fixture(42, "Second private receipt download");

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchWorkspace,useResearchWorkspace}from'./components/keryx/research-workspace';
    import{ResearchSavedJobs}from'./components/keryx/research-saved-jobs';
    import * as journals from './lib/buyer/browser-journal';import{downloadBuyerJson}from'./lib/buyer/download';
    window.journals=journals;window.downloadJson=downloadBuyerJson;window.fault='';window.failRead='';window.created=[];window.revoked=[];window.unhandled=[];
    window.addEventListener('unhandledrejection',event=>window.unhandled.push(String(event.reason)));
    let activeDownload=false;
    function fail(name){if(window.fault!==name)return false;window.fault='';activeDownload=false;return true;}
    const objectURL=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(fail('url'))throw new DOMException('Controlled URL failure','NotSupportedError');const url=objectURL(blob);activeDownload=true;window.created.push({url,type:blob.type});return url;};
    URL.revokeObjectURL=url=>{window.revoked.push(url);return revoke(url);};
    const create=document.createElement.bind(document);
    document.createElement=(name,options)=>{if(activeDownload&&name==='a'&&fail('create'))throw new DOMException('Controlled anchor failure','NotSupportedError');return create(name,options);};
    const append=document.body.appendChild.bind(document.body);
    document.body.appendChild=node=>{if(activeDownload&&node instanceof HTMLAnchorElement&&fail('append'))throw new DOMException('Controlled append failure','HierarchyRequestError');return append(node);};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(activeDownload&&fail('click'))throw new DOMException('Controlled click failure','SecurityError');try{return click.call(this);}finally{activeDownload=false;}};
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){const request=get.call(this,key),tx=this.transaction;if(tx.mode==='readonly'&&window.failRead===key){window.failRead='';request.addEventListener('success',()=>tx.abort());}return request;};
    function ExternalSelection(){const {selection,select}=useResearchWorkspace();return <>
      <output data-selected={selection?.id??''} data-view={selection?.revision??''}/>
      <button onClick={()=>select(${JSON.stringify(second.intent.queryId)})}>Open another receipt externally</button>
    </>}
    createRoot(document.getElementById('root')).render(<ResearchWorkspace><ExternalSelection/><ResearchSavedJobs/></ResearchWorkspace>);
  ` }, bundle: true, minify: true, write: false, platform: "browser", format: "iife", jsx: "automatic", metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [signedOutResearchAuthFixture()],
  });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-workspace.tsx", "components/keryx/research-saved-jobs.tsx", "components/keryx/research-job-details.tsx", "lib/buyer/browser-storage.ts", "lib/buyer/browser-journal.ts", "lib/buyer/browser-client.ts", "lib/buyer/browser-result.ts", "lib/buyer/download.ts"]);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function setup() {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  const calls: { url: string; method: string; payment: boolean }[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === "https://keryx.cc/research" && request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    calls.push({ url: url.href, method: request.method(), payment: !!request.headers()["payment-signature"] });
    const value = [first, second].find(value => url.searchParams.get("queryId") === value.intent.queryId || url.pathname === `/api/dispatch/${value.intent.queryId}/receipt`);
    if (value && url.pathname === "/api/agent/ask") return route.fulfill({ json: value.job });
    if (value && url.pathname.endsWith("/receipt")) return route.fulfill({ json: value.receipt, headers: { "x-keryx-receipt-digest": value.receipt.integrity.digest } });
    return route.fulfill({ status: url.pathname === "/api/auth/sessions" ? 401 : 404, json: {} });
  });
  const page = await context.newPage();page.setDefaultTimeout(4000);page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://keryx.cc/research");await page.addScriptTag({ content: bundle });
  const originals = await page.evaluate(async ({ first, second }) => {
    const { journals } = window as unknown as Harness;
    await journals.createBrowserJournal(first);await journals.createBrowserJournal(second);
    return [JSON.stringify(await journals.readBrowserJournal(first.queryId)), JSON.stringify(await journals.readBrowserJournal(second.queryId))];
  }, { first: first.intent, second: second.intent });
  const saved = page.getByRole("region", { name: "Saved research jobs", exact: true });
  const row = (value = first) => saved.getByRole("button", { name: new RegExp(`^${value.intent.request.question}`) });
  const receiptButton = saved.getByRole("button", { name: "Download verified receipt", exact: true });
  const receiptError = saved.getByRole("alert").filter({ hasText: "Download unavailable. Try again." });
  const exportButton = saved.getByRole("button", { name: "Export recovery file", exact: true });
  const exportError = saved.getByRole("alert").filter({ hasText: "Recovery export failed. Keep this tab and try again." });
  await saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click();await row().click();await receiptButton.waitFor();
  await saved.getByText(first.answer, { exact: true }).waitFor();
  return { context, page, calls, errors, originals, saved, row, receiptButton, receiptError, exportButton, exportError };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function settle(page: Page) { await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))); }
async function verify(h: Fixture) {
  await settle(h.page);
  expect(await h.page.evaluate(async ({ first, second }) => {
    const { journals } = window as unknown as Harness;
    return [JSON.stringify(await journals.readBrowserJournal(first.queryId)), JSON.stringify(await journals.readBrowserJournal(second.queryId))];
  }, { first: first.intent, second: second.intent })).toEqual(h.originals);
  expect(h.calls.some(call => call.url.endsWith(`/api/dispatch/${first.intent.queryId}/receipt`))).toBe(true);
  expect(h.calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/") && !call.payment)).toBe(true);
  expect(h.page.url()).toBe("https://keryx.cc/research");expect(h.errors).toEqual([]);
  expect(await h.page.evaluate(() => (window as unknown as Harness).unhandled)).toEqual([]);
}
async function contents(download: Download, kind: "recovery" | "receipt") {
  expect(download.suggestedFilename()).toBe(`keryx-${kind}.json`);
  const stream = await download.createReadStream();expect(stream).not.toBeNull();const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(await download.failure()).toBeNull();return Buffer.concat(chunks).toString("utf8");
}
async function receipt(h: Fixture, value = first) {
  const pending = h.page.waitForEvent("download");await h.receiptButton.click();
  const text = await contents(await pending, "receipt");expect(text).toBe(JSON.stringify(value.receipt, null, 2) + "\n");
  const parsed = JSON.parse(text);expect(researchReceiptDigest(parsed.payload)).toBe(parsed.integrity.digest);
}
async function recovery(h: Fixture, value = first) {
  const pending = h.page.waitForEvent("download");await h.exportButton.click();expect(await contents(await pending, "recovery")).toBe(encodeBuyerRecovery(value.intent));
}
async function failReceipt(h: Fixture, fault: Fault = "url") {
  await h.page.evaluate(value => { (window as unknown as Harness).fault = value; }, fault);await h.receiptButton.click();await h.receiptError.waitFor();
  expect(await h.receiptButton.evaluate(button => {
    const target = button.getAttribute("aria-describedby"), error = target ? button.ownerDocument.getElementById(target) : null;
    return !!error && error.getAttribute("role") === "alert" && error === button.nextElementSibling && error.textContent === "Download unavailable. Try again.";
  })).toBe(true);
}
async function failExport(h: Fixture) {
  await h.page.evaluate(id => { (window as unknown as Harness).failRead = id; }, first.intent.queryId);await h.exportButton.click();await h.exportError.waitFor();
}

it("downloads the original verified receipt with GET-only recovery and unchanged journals", async () => {
  const h = await setup();try { await receipt(h);await verify(h); } finally { await h.context.close(); }
});
it.each(["url", "create", "append", "click"] as const)("reports a native receipt %s failure and clears only its error on retry", async fault => {
  const h = await setup();try { await failReceipt(h, fault);await receipt(h);await settle(h.page);expect(await h.receiptError.count()).toBe(0);await verify(h); } finally { await h.context.close(); }
});
it("retains the recovery-export failure after a receipt retry succeeds", async () => {
  const h = await setup();try { await failReceipt(h);await failExport(h);await receipt(h);await settle(h.page);expect(await h.receiptError.count()).toBe(0);expect(await h.exportError.count()).toBe(1);await recovery(h);await verify(h); } finally { await h.context.close(); }
});
it("retains the receipt failure after an independent recovery export succeeds", async () => {
  const h = await setup();try { await failReceipt(h);await recovery(h);expect(await h.receiptError.count()).toBe(1);await receipt(h);await verify(h); } finally { await h.context.close(); }
});
it.each(["different", "reopened", "closed-reopened", "external"] as const)("keeps receipt feedback within its %s selection context", async choice => {
  const h = await setup();try {
    await failReceipt(h);const next = choice === "different" || choice === "external" ? second : first;
    if (choice === "closed-reopened") await h.saved.getByRole("button", { name: "Close job", exact: true }).click();
    if (choice === "external") await h.page.getByRole("button", { name: "Open another receipt externally", exact: true }).click();else await h.row(next).click();
    await h.receiptButton.waitFor();expect(await h.receiptError.count()).toBe(0);await receipt(h, next);await verify(h);
  } finally { await h.context.close(); }
});
it("recovers the same verified job by GET after a failed receipt download", async () => {
  const h = await setup();try { await failReceipt(h);await h.saved.getByRole("button", { name: "Refresh this job", exact: true }).click();await h.receiptButton.waitFor();await receipt(h);await verify(h); } finally { await h.context.close(); }
});
const failures = (["recovery", "receipt"] as const).flatMap(kind =>
  (["url", "create", "append", "click"] as const).map(fault => ({ kind, fault })));
it.each(failures)("releases the native $kind Blob URL after a $fault initiation failure", async ({ kind, fault }) => {
    const h = await setup();try {
      const result = await h.page.evaluate(({ fault, kind, text }) => {
        const state = window as unknown as Harness;state.fault = fault;
        try { state.downloadJson(text, kind);return "unexpected success"; } catch (error) { return error instanceof DOMException ? error.name : "other failure"; }
      }, { fault, kind, text: kind === "receipt" ? JSON.stringify(first.receipt, null, 2) + "\n" : encodeBuyerRecovery(first.intent) });
      expect(result).not.toBe("unexpected success");
      const allocated = fault === "url" ? 0 : 1;
      await h.page.waitForFunction(expected => (window as unknown as Harness).revoked.length === expected, allocated);
      const state = await h.page.evaluate(() => { const value = window as unknown as Harness;return { created: value.created, revoked: value.revoked, anchors: document.querySelectorAll('a[download]').length }; });
      expect(state.created).toHaveLength(allocated);expect(state.revoked).toEqual(state.created.map(row => row.url));expect(state.anchors).toBe(0);
      expect(state.created.every(row => row.type === "application/json")).toBe(true);await verify(h);
    } finally { await h.context.close(); }
});
it.each(["recovery", "receipt"] as const)("preserves native %s download bytes, filename and cleanup", async kind => {
  const h = await setup();try {
    const text = kind === "receipt" ? JSON.stringify(first.receipt, null, 2) + "\n" : encodeBuyerRecovery(first.intent);
    const pending = h.page.waitForEvent("download");await h.page.evaluate(({ text, kind }) => (window as unknown as Harness).downloadJson(text, kind), { text, kind });
    expect(await contents(await pending, kind)).toBe(text);
    await h.page.waitForFunction(() => (window as unknown as Harness).revoked.length === 1);
    expect(await h.page.evaluate(() => { const value = window as unknown as Harness;return { type: value.created[0].type, same: value.created[0].url === value.revoked[0], anchors: document.querySelectorAll('a[download]').length }; })).toEqual({ type: "application/json", same: true, anchors: 0 });
    await verify(h);
  } finally { await h.context.close(); }
});
