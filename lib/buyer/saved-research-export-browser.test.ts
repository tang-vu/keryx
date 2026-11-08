import { build } from "esbuild";
import { chromium, type Browser, type Download, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorizationWithNonce, type BuyerIntentEnvelope, type BuyerRequirement } from "./protocol";
import { buyerJobId } from "./policy";
import { encodeBuyerRecovery } from "./recovery";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../../test-support/research-browser-auth-fixture";

type Journals = typeof import("./browser-journal");
interface Harness {
  journals: Journals;
  failRead: string;
  holdRead: string;
  heldStarted: boolean;
  heldPumped: boolean;
  heldSettled: boolean;
  releaseHeld: (abort: boolean) => Promise<void>;
  failRemoval: boolean;
  failDownload: boolean;
  unhandled: string[];
}
let browser: Browser, bundle: string;
const requirement: BuyerRequirement = {
  scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "50000",
  payTo: `0x${"b".repeat(40)}`, maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
};
function intent(n: number, question: string): BuyerIntentEnvelope {
  const authorization = authorizationWithNonce(`0x${"1".repeat(40)}`, requirement, `0x${n.toString(16).padStart(64, "0")}`);
  return { schema: "keryx-buyer-intent-v1", request: { question, budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }, requirement, authorization, queryId: buyerJobId(authorization) };
}
const first = intent(1, "First recovery export"), second = intent(2, "Second recovery export");

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchWorkspace,useResearchWorkspace}from'./components/keryx/research-workspace';
    import{ResearchSavedJobs}from'./components/keryx/research-saved-jobs';
    import * as journals from './lib/buyer/browser-journal';
    window.journals=journals;window.failRead='';window.holdRead='';window.heldStarted=false;window.heldPumped=false;window.heldSettled=false;window.unhandled=[];
    window.addEventListener('unhandledrejection',event=>window.unhandled.push(String(event.reason)));
    // Keep genuine readonly transactions alive. Concurrent readonly exports can
    // finish in either order; all validation, serialization and storage stay real.
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){
      const request=get.call(this,key),tx=this.transaction;
      if(tx.mode==='readonly'&&window.holdRead===key){
        window.holdRead='';window.heldStarted=true;let held=true;const store=this;
        const terminal=new Promise(done=>{const finish=()=>{window.heldSettled=true;done();};tx.addEventListener('complete',finish);tx.addEventListener('abort',finish);});
        window.releaseHeld=async abort=>{held=false;if(abort)tx.abort();await terminal;};
        const pump=()=>{const read=get.call(store,key);read.onsuccess=()=>{window.heldPumped=true;if(held)pump();};};
        request.addEventListener('success',pump);
      }else if(tx.mode==='readonly'&&window.failRead===key){
        window.failRead='';request.addEventListener('success',()=>tx.abort());
      }
      return request;
    };
    const remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete=function(key){const request=remove.call(this,key);if(window.failRemoval){window.failRemoval=false;this.transaction.abort();}return request;};
    const objectURL=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(window.failDownload){window.failDownload=false;throw new DOMException('Controlled download initiation failure','NotSupportedError');}return objectURL(blob);};
    function OtherSelection(){const {selection,select}=useResearchWorkspace();return <>
      <output data-selected={selection?.id??''} data-view={selection?.revision??''}/>
      <button onClick={()=>select(${JSON.stringify(second.queryId)})}>Open another saved task externally</button>
    </>}
    createRoot(document.getElementById('root')).render(<ResearchWorkspace><OtherSelection/><ResearchSavedJobs/></ResearchWorkspace>);
  ` }, bundle: true, minify: true, write: false, platform: "browser", format: "iife", jsx: "automatic", metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [signedOutResearchAuthFixture()],
  });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-workspace.tsx", "components/keryx/research-saved-jobs.tsx", "components/keryx/research-job-details.tsx", "lib/buyer/browser-storage.ts", "lib/buyer/browser-journal.ts", "lib/buyer/browser-client.ts", "lib/buyer/download.ts"]);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function setup() {
  const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
  const calls: { url: string; method: string }[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.href === "https://keryx.cc/research" && request.isNavigationRequest())
      return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
    calls.push({ url: url.href, method: request.method() });
    return route.fulfill({ status: 404, json: {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(4000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://keryx.cc/research"); await page.addScriptTag({ content: bundle });
  const originals = await page.evaluate(async ({ first, second }) => {
    const { journals } = window as unknown as Harness;
    await journals.createBrowserJournal(first); await journals.createBrowserJournal(second);
    return [JSON.stringify(await journals.readBrowserJournal(first.queryId)), JSON.stringify(await journals.readBrowserJournal(second.queryId))];
  }, { first, second });
  const saved = page.getByRole("region", { name: "Saved research jobs", exact: true });
  const row = (value: BuyerIntentEnvelope) => saved.getByRole("button", { name: new RegExp(`^${value.request.question}`) });
  const exportButton = saved.getByRole("button", { name: "Export recovery file", exact: true });
  const exportError = saved.getByRole("alert").filter({ hasText: "Recovery export failed. Keep this tab and try again." });
  const removalError = saved.getByRole("alert").filter({ hasText: "Local removal failed." });
  await saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click(); await row(first).click();
  await saved.getByText("No order was found.", { exact: false }).waitFor();
  return { context, page, calls, errors, originals, saved, row, exportButton, exportError, removalError };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(done => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}
async function verify(h: Fixture) {
  await settle(h.page);
  expect(await h.page.evaluate(async ({ first, second }) => {
    const { journals } = window as unknown as Harness;
    return [JSON.stringify(await journals.readBrowserJournal(first.queryId)), JSON.stringify(await journals.readBrowserJournal(second.queryId))];
  }, { first, second })).toEqual(h.originals);
  expect(h.calls.length).toBeGreaterThan(0);
  expect(h.calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/"))).toBe(true);
  expect(h.errors).toEqual([]); expect(await h.page.evaluate(() => (window as unknown as Harness).unhandled)).toEqual([]);
}
async function contents(download: Download) {
  expect(download.suggestedFilename()).toBe("keryx-recovery.json");
  const stream = await download.createReadStream(); expect(stream).not.toBeNull(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(await download.failure()).toBeNull(); return Buffer.concat(chunks).toString("utf8");
}
async function download(h: Fixture, value = first) {
  const pending = h.page.waitForEvent("download"); await h.exportButton.click();
  expect(await contents(await pending)).toBe(encodeBuyerRecovery(value));
}
async function failExport(h: Fixture, value = first) {
  await h.page.evaluate(id => { (window as unknown as Harness).failRead = id; }, value.queryId);
  await h.exportButton.click(); await h.exportError.waitFor();
}
async function holdExport(h: Fixture) {
  await h.page.evaluate(id => { (window as unknown as Harness).holdRead = id; }, first.queryId);
  await h.exportButton.click();
  await h.page.waitForFunction(() => (window as unknown as Harness).heldStarted && (window as unknown as Harness).heldPumped);
  expect(await h.page.evaluate(() => (window as unknown as Harness).heldSettled)).toBe(false);
}
async function failRemoval(h: Fixture) {
  await h.page.evaluate(() => { (window as unknown as Harness).failRemoval = true; });
  await h.saved.getByRole("button", { name: "Remove local record", exact: true }).click();
  await h.saved.getByRole("button", { name: "Confirm local removal", exact: true }).click(); await h.removalError.waitFor();
}

it("downloads the exact original recovery without changing either journal", async () => {
  const h = await setup(); try { await download(h); expect(await h.saved.getByRole("alert").count()).toBe(0); await verify(h); } finally { await h.context.close(); }
});
it("clears a failed export when a new export succeeds", async () => {
  const h = await setup(); try { await failExport(h); await download(h); await settle(h.page); expect(await h.exportError.count()).toBe(0); await verify(h); } finally { await h.context.close(); }
});
it("handles download initiation failure and allows a successful retry", async () => {
  const h = await setup(); try {
    await h.page.evaluate(() => { (window as unknown as Harness).failDownload = true; }); await h.exportButton.click(); await h.exportError.waitFor();
    await download(h); await settle(h.page); expect(await h.exportError.count()).toBe(0); await verify(h);
  } finally { await h.context.close(); }
});
it("ignores an older readonly export failure after a newer export succeeds", async () => {
  const h = await setup(); try {
    await holdExport(h); await download(h); await h.page.evaluate(() => (window as unknown as Harness).releaseHeld(true)); await settle(h.page);
    expect(await h.exportError.count()).toBe(0); await verify(h);
  } finally { await h.context.close(); }
});
it.each(["different", "reopened", "closed-reopened", "external"] as const)("retains the new export error after an old %s view fails", async choice => {
  const h = await setup(); try {
    await holdExport(h); const value = choice === "different" || choice === "external" ? second : first;
    if (choice === "closed-reopened") await h.saved.getByRole("button", { name: "Close job", exact: true }).click();
    if (choice === "external") await h.page.getByRole("button", { name: "Open another saved task externally", exact: true }).click();
    else await h.row(value).click();
    await h.saved.getByText("No order was found.", { exact: false }).waitFor(); await failExport(h, value);
    await h.page.evaluate(() => (window as unknown as Harness).releaseHeld(true)); await settle(h.page);
    expect(await h.exportError.isVisible()).toBe(true); expect(await h.row(value).getAttribute("aria-pressed")).toBe("true"); await verify(h);
  } finally { await h.context.close(); }
});
it("preserves a failed removal while an unrelated recovery export succeeds", async () => {
  const h = await setup(); try { await failRemoval(h); await download(h); expect(await h.removalError.isVisible()).toBe(true); await verify(h); } finally { await h.context.close(); }
});
it("keeps both failed local operations visible without replacing the export failure", async () => {
  const h = await setup(); try { await failExport(h); await failRemoval(h); expect(await h.exportError.isVisible()).toBe(true); await verify(h); } finally { await h.context.close(); }
});
it("keeps a valid export failure through an unrelated list refresh", async () => {
  const h = await setup(); try {
    await holdExport(h); await h.saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click();
    await h.page.evaluate(() => (window as unknown as Harness).releaseHeld(true)); await h.exportError.waitFor(); await verify(h);
  } finally { await h.context.close(); }
});
it("finishes the requested original download after selection changes", async () => {
  const h = await setup(); try {
    await holdExport(h); await h.row(second).click(); await h.saved.getByText("No order was found.", { exact: false }).waitFor();
    const pending = h.page.waitForEvent("download"); await h.page.evaluate(() => (window as unknown as Harness).releaseHeld(false));
    expect(await contents(await pending)).toBe(encodeBuyerRecovery(first)); expect(await h.row(second).getAttribute("aria-pressed")).toBe("true");
    expect(await h.saved.getByRole("alert").count()).toBe(0); await verify(h);
  } finally { await h.context.close(); }
});
