import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { authorizationWithNonce, type BuyerIntentEnvelope, type BuyerRequirement } from "./protocol";
import { buyerJobId } from "./policy";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../../test-support/research-browser-auth-fixture";

type Journals = typeof import("./browser-journal");
interface Harness {
  journals: Journals;
  deletionCalls: number;
  deletionCompleted: boolean;
  deletionAborted: boolean;
  abortDeletion: boolean;
  releaseRemoval: () => Promise<void>;
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

beforeAll(async () => {
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchWorkspace}from'./components/keryx/research-workspace';
    import{ResearchSavedJobs}from'./components/keryx/research-saved-jobs';
    import * as journals from './lib/buyer/browser-journal';
    window.journals=journals;window.deletionCalls=0;window.deletionCompleted=false;window.deletionAborted=false;
    // Observe the real delete request and transaction; do not replace storage or recovery.
    const remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete=function(...args){
      window.deletionCalls++;
      this.transaction.addEventListener('complete',()=>{window.deletionCompleted=true;});
      this.transaction.addEventListener('abort',()=>{window.deletionAborted=true;});
      const request=remove.apply(this,args);
      if(window.abortDeletion)this.transaction.abort();
      return request;
    };
    createRoot(document.getElementById('root')).render(<ResearchWorkspace><ResearchSavedJobs/></ResearchWorkspace>);
  ` }, bundle: true, minify: true, write: false, platform: "browser", format: "iife", jsx: "automatic", metafile: true,
    define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [signedOutResearchAuthFixture()],
  });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-workspace.tsx", "components/keryx/research-saved-jobs.tsx", "components/keryx/research-job-details.tsx", "lib/buyer/browser-storage.ts", "lib/buyer/browser-journal.ts", "lib/buyer/browser-client.ts"]);
  expect(Object.keys(result.metafile.inputs).some(path => /^lib\/(?:config|db\/)/.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

it.each(["unchanged", "different", "reopened", "closed", "closed-reopened", "failed"] as const)(
  "handles local removal with a %s view without changing the remaining original journal", async choice => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const calls: { url: string; method: string }[] = [], errors: string[] = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === "https://keryx.cc/research" && request.isNavigationRequest())
        return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
      calls.push({ url: url.href, method: request.method() });
      // GET recovery is deliberately uncertain. No RPC, wallet or payment transport runs.
      return route.fulfill({ status: 404, json: {} });
    });
    const page = await context.newPage(); page.setDefaultTimeout(4000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("https://keryx.cc/research"); await page.addScriptTag({ content: bundle });
      const first = intent(1, "Original locally removed journal"), second = intent(2, "Remaining original journal");
      const original = await page.evaluate(async ({ first, second }) => {
        const { journals } = window as unknown as Harness;
        await journals.createBrowserJournal(first); await journals.createBrowserJournal(second);
        return JSON.stringify(await journals.readBrowserJournal(second.queryId));
      }, { first, second });
      const saved = page.getByRole("region", { name: "Saved research jobs", exact: true });
      const row = (question: string) => saved.getByRole("button", { name: new RegExp(question) });
      await saved.getByRole("button", { name: "Refresh saved jobs", exact: true }).click();
      await row(first.request.question).click();
      await saved.getByText("No order was found.", { exact: false }).waitFor();

      // An actual earlier readwrite transaction queues the UI's delete. Keep it
      // alive with real reads, so user navigation happens before that delete commits.
      await page.evaluate(id => new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("keryx-buyer-jobs-v1", 1);
        request.onerror = () => reject(new Error("Could not open blocker database"));
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction("jobs", "readwrite"), store = tx.objectStore("jobs");
          let held = true;
          const completed = new Promise<void>((done, fail) => {
            tx.oncomplete = () => { db.close(); done(); };
            tx.onabort = tx.onerror = () => { db.close(); fail(new Error("Blocker failed")); };
          });
          (window as unknown as Harness).releaseRemoval = () => { held = false; return completed; };
          const pump = () => { const read = store.get(id); read.onsuccess = () => { if (held) pump(); }; };
          pump(); resolve();
        };
      }), first.queryId);
      if (choice === "failed") await page.evaluate(() => { (window as unknown as Harness).abortDeletion = true; });
      await saved.getByRole("button", { name: "Remove local record", exact: true }).click();
      await saved.getByRole("button", { name: "Confirm local removal", exact: true }).click();
      await page.waitForFunction(() => (window as unknown as Harness).deletionCalls === 1);
      expect(await page.evaluate(() => (window as unknown as Harness).deletionCompleted)).toBe(false);
      if (choice === "different") await row(second.request.question).click();
      if (choice === "reopened") await row(first.request.question).click();
      if (choice === "closed") await saved.getByRole("button", { name: "Close job", exact: true }).click();
      if (choice === "closed-reopened") {
        await saved.getByRole("button", { name: "Close job", exact: true }).click();
        await row(first.request.question).click();
      }
      if (choice === "different" || choice === "reopened" || choice === "closed-reopened")
        expect(await row(choice === "different" ? second.request.question : first.request.question).getAttribute("aria-pressed")).toBe("true");
      if (choice === "different" || choice === "reopened" || choice === "closed-reopened")
        await saved.getByRole("button", { name: "Remove local record", exact: true }).click();
      await page.evaluate(() => (window as unknown as Harness).releaseRemoval());
      await page.waitForFunction(failed => failed ? (window as unknown as Harness).deletionAborted : (window as unknown as Harness).deletionCompleted, choice === "failed");
      // This read queues behind the deletion and checks the actual persisted bytes.
      const after = await page.evaluate(async ({ first, second }) => {
        const { journals } = window as unknown as Harness;
        const rows = await journals.listBrowserJournals();
        return { ids: rows.map(row => row.queryId), original: JSON.stringify(await journals.readBrowserJournal(second.queryId)),
          deletedMissing: await journals.readBrowserJournal(first.queryId).then(() => false, () => true) };
      }, { first, second });
      expect(after.original).toBe(original);
      if (choice === "failed") {
        expect(new Set(after.ids)).toEqual(new Set([first.queryId, second.queryId])); expect(after.deletedMissing).toBe(false);
        await saved.getByRole("alert").filter({ hasText: "Local removal failed." }).waitFor();
        expect(await row(first.request.question).getAttribute("aria-pressed")).toBe("true");
        expect(await saved.getByRole("button", { name: "Confirm local removal", exact: true }).count()).toBe(1);
        expect(calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/"))).toBe(true);
        expect(errors).toEqual([]);
        return;
      }
      expect(after.ids).toEqual([second.queryId]); expect(after.deletedMissing).toBe(true);
      await row(first.request.question).waitFor({ state: "detached" });
      if (choice === "different") {
        await saved.getByText("No order was found.", { exact: false }).waitFor();
        expect(await row(second.request.question).getAttribute("aria-pressed")).toBe("true");
        expect(await saved.getByRole("button", { name: "Close job", exact: true }).count()).toBe(1);
        expect(await saved.getByRole("button", { name: "Confirm local removal", exact: true }).count()).toBe(1);
      } else if (choice === "reopened" || choice === "closed-reopened") {
        // Reopening A is a new view even though A's local record is now gone.
        await saved.getByRole("alert").filter({ hasText: "Could not load or verify this job and receipt." }).waitFor();
        expect(await saved.getByRole("button", { name: "Close job", exact: true }).count()).toBe(1);
        expect(await saved.getByRole("button", { name: "Confirm local removal", exact: true }).count()).toBe(1);
      } else {
        expect(await saved.getByRole("button", { name: "Close job", exact: true }).count()).toBe(0);
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(call => call.method === "GET" && call.url.startsWith("https://keryx.cc/api/"))).toBe(true);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
