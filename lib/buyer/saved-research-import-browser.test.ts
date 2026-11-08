import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorizationWithNonce, type BuyerIntentEnvelope, type BuyerRequirement } from "./protocol";
import { buyerJobId } from "./policy";
import { encodeBuyerRecovery } from "./recovery";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../../test-support/research-browser-auth-fixture";

type Journals = typeof import("./browser-journal");
interface Harness {
  journals: Journals;
  gates: Record<string, boolean>;
  releaseFiles: Record<string, () => void>;
  startedFiles: string[];
  settledFiles: string[];
  added: string[];
  committed: string[];
  releaseStorage: () => Promise<void>;
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
const first = intent(1, "Original saved journal"), second = intent(2, "Another saved journal");
const incoming = intent(3, "Imported recovery journal"), newer = intent(4, "Newer imported recovery journal");

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchWorkspace,useResearchWorkspace}from'./components/keryx/research-workspace';
    import{ResearchSavedJobs}from'./components/keryx/research-saved-jobs';
    import * as journals from './lib/buyer/browser-journal';
    window.journals=journals;window.gates={};window.releaseFiles={};window.startedFiles=[];window.settledFiles=[];window.added=[];window.committed=[];
    const text=File.prototype.text;
    File.prototype.text=async function(){
      if(window.gates[this.name]){window.startedFiles.push(this.name);await new Promise(done=>{window.releaseFiles[this.name]=done;});}
      const value=await text.call(this);window.settledFiles.push(this.name);return value;
    };
    // Observe actual requests/commits without replacing validation or storage.
    const add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(value,...args){
      window.added.push(value.queryId);this.transaction.addEventListener('complete',()=>window.committed.push(value.queryId));
      return add.call(this,value,...args);
    };
    function OtherSelection(){const {selection,select}=useResearchWorkspace();return <>
      <output data-selected={selection?.id??''} data-view={selection?.revision??''}/>
      <button onClick={()=>select(${JSON.stringify(second.queryId)})}>Open from another workspace control</button>
    </>}
    createRoot(document.getElementById('root')).render(<ResearchWorkspace><OtherSelection/><ResearchSavedJobs/></ResearchWorkspace>);
  ` }, bundle: true, minify: true, write: false, platform: "browser", format: "iife", jsx: "automatic", metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [signedOutResearchAuthFixture()],
  });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-workspace.tsx", "components/keryx/research-saved-jobs.tsx", "components/keryx/research-job-details.tsx", "lib/buyer/browser-storage.ts", "lib/buyer/browser-journal.ts", "lib/buyer/browser-client.ts"]);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function setup() {
  const context = await browser.newContext({ serviceWorkers: "block" });
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
  await saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click(); await row(first).click();
  await saved.getByText("No order was found.", { exact: false }).waitFor();
  return { context, page, calls, errors, originals, saved, row };
}
async function chooseFile(page: Page, name: string, value: BuyerIntentEnvelope | null) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(value ? encodeBuyerRecovery(value) : "not json") });
}
async function releaseFile(page: Page, name: string) {
  await page.evaluate(name => (window as unknown as Harness).releaseFiles[name](), name);
  await page.waitForFunction(name => (window as unknown as Harness).settledFiles.includes(name), name);
}
async function unchangedOriginals(page: Page, originals: string[]) {
  const after = await page.evaluate(async ({ first, second, incoming }) => {
    const { journals } = window as unknown as Harness;
    return { originals: [JSON.stringify(await journals.readBrowserJournal(first.queryId)), JSON.stringify(await journals.readBrowserJournal(second.queryId))],
      imported: await journals.readBrowserJournal(incoming.queryId) };
  }, { first, second, incoming });
  expect(after.originals).toEqual(originals);
  expect(after.imported.intent).toEqual(incoming); expect(after.imported.origin).toBe("imported");
  expect(after.imported.submission).toBe("submission_possible");
  expect(await page.evaluate(id => (window as unknown as Harness).journals.claimBrowserSubmission(id), incoming)).toBe(false);
}
const choices = ["unchanged", "different", "reopened", "closed", "external"] as const;
for (const delay of ["file", "storage"] as const) it.each(choices)(
  `preserves a %s view when an import waits for ${delay}`, async choice => {
    const h = await setup(), { page, saved, row } = h;
    try {
      if (delay === "file") await page.evaluate(() => { (window as unknown as Harness).gates["first.json"] = true; });
      else await page.evaluate(id => new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("keryx-buyer-jobs-v1", 1);
        request.onerror = () => reject(new Error("Blocker open failed"));
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction("jobs", "readwrite"), store = tx.objectStore("jobs"); let held = true;
          const terminal = new Promise<void>((done, fail) => {
            tx.oncomplete = () => { db.close(); done(); }; tx.onabort = tx.onerror = () => { db.close(); fail(new Error("Blocker failed")); };
          });
          (window as unknown as Harness).releaseStorage = () => { held = false; return terminal; };
          const pump = () => { store.get(id).onsuccess = () => { if (held) pump(); }; }; pump(); resolve();
        };
      }), first.queryId);
      await chooseFile(page, "first.json", incoming);
      if (delay === "file") await page.waitForFunction(() => (window as unknown as Harness).startedFiles.includes("first.json"));
      else {
        await page.waitForFunction(id => (window as unknown as Harness).added.includes(id), incoming.queryId);
        expect(await page.evaluate(id => (window as unknown as Harness).committed.includes(id), incoming.queryId)).toBe(false);
      }
      if (choice === "different") await row(second).click();
      if (choice === "reopened") await row(first).click();
      if (choice === "closed") await saved.getByRole("button", { name: "Close job", exact: true }).click();
      if (choice === "external") await page.getByRole("button", { name: "Open from another workspace control" }).click();
      const view = await page.locator("output").getAttribute("data-view");
      if (choice !== "unchanged" && choice !== "closed") await saved.getByRole("button", { name: "Remove local record", exact: true }).click();
      if (delay === "file") await releaseFile(page, "first.json"); else await page.evaluate(() => (window as unknown as Harness).releaseStorage());
      await row(incoming).waitFor(); await unchangedOriginals(page, h.originals);
      expect(await page.locator("output").getAttribute("data-selected")).toBe(choice === "unchanged" ? incoming.queryId : choice === "closed" ? "" : choice === "reopened" ? first.queryId : second.queryId);
      if (choice !== "unchanged") {
        expect(await page.locator("output").getAttribute("data-view")).toBe(view);
        expect(h.calls.some(call => call.url.includes(incoming.queryId))).toBe(false);
      }
      if (choice !== "unchanged" && choice !== "closed") expect(await saved.getByRole("button", { name: "Confirm local removal", exact: true }).count()).toBe(1);
      expect(h.calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/"))).toBe(true); expect(h.errors).toEqual([]);
    } finally { await h.context.close(); }
  });

it("keeps an active import across an ordinary saved-list refresh", async () => {
  const h = await setup();
  try {
    await h.page.evaluate(() => { (window as unknown as Harness).gates["first.json"] = true; });
    await chooseFile(h.page, "first.json", incoming);
    await h.saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click();
    await releaseFile(h.page, "first.json"); await h.row(incoming).waitFor();
    expect(await h.page.locator("output").getAttribute("data-selected")).toBe(incoming.queryId);
    await unchangedOriginals(h.page, h.originals);
  } finally { await h.context.close(); }
});

it.each(["success", "newer-failure", "older-failure"] as const)("preserves the newer import intent after %s", async outcome => {
  const h = await setup();
  try {
    await h.page.evaluate(() => { (window as unknown as Harness).gates["first.json"] = true; });
    await chooseFile(h.page, "first.json", outcome === "older-failure" ? null : incoming);
    await chooseFile(h.page, "second.json", outcome === "newer-failure" ? null : newer);
    if (outcome === "newer-failure") await h.saved.getByRole("alert").filter({ hasText: "Recovery file could not be imported." }).waitFor();
    else await h.row(newer).waitFor();
    const view = await h.page.locator("output").getAttribute("data-view");
    await releaseFile(h.page, "first.json");
    if (outcome !== "older-failure") await h.row(incoming).waitFor();
    else await h.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await h.page.locator("output").getAttribute("data-selected")).toBe(outcome === "newer-failure" ? first.queryId : newer.queryId);
    expect(await h.page.locator("output").getAttribute("data-view")).toBe(view);
    expect(await h.saved.getByRole("alert").count()).toBe(outcome === "newer-failure" ? 1 : 0);
    if (outcome !== "older-failure") await unchangedOriginals(h.page, h.originals);
    expect(h.calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/"))).toBe(true); expect(h.errors).toEqual([]);
  } finally { await h.context.close(); }
});
