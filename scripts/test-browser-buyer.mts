/** Hermetic Chromium checks: intercepted HTTPS only, synthetic never-funded identities. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBuyerRecovery, exportBuyerRecovery } from "../lib/buyer/recovery-file";
import { build } from "esbuild";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { authorizationWithNonce, buyerTypedData, type BuyerIntentEnvelope, type BuyerRequirement } from "../lib/buyer/protocol";
import { buyerJobId } from "../lib/buyer/policy";

declare global {
  interface Window {
    BrowserBuyerTest: typeof import("../lib/buyer/browser-journal") & typeof import("../lib/buyer/browser-client") & typeof import("../lib/buyer/funding-journal");
    signSyntheticBuyer: (value: Parameters<typeof buyerTypedData>[0]) => Promise<`0x${string}`>;
  }
}

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const requirement: BuyerRequirement = { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000",
  amount: "50000", payTo: `0x${"b".repeat(40)}`, maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
function intent(n: number): BuyerIntentEnvelope {
  const authorization = authorizationWithNonce(account.address, requirement, `0x${n.toString(16).padStart(64, "0")}`);
  return { schema: "keryx-buyer-intent-v1", request: { question: "Browser journal recovery", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }, requirement, authorization, queryId: buyerJobId(authorization) };
}

const bundle = await build({ stdin: { contents: 'export * from "./lib/buyer/browser-journal"; export * from "./lib/buyer/browser-client"; export * from "./lib/buyer/funding-journal";', resolveDir: process.cwd() },
  bundle: true, platform: "browser", format: "iife", globalName: "BrowserBuyerTest", write: false, metafile: true });
assert(!Object.keys(bundle.metafile.inputs).some(path => /^lib\/(config|db\/)/.test(path) || /^lib\/buyer\/(journal|client|policy)\.ts$/.test(path)), "Server dependency crossed the browser boundary");
const browser = await chromium.launch({ headless: true });
const portableDirectory = await mkdtemp(join(tmpdir(), "keryx-browser-portable-"));
try {
  const context = await browser.newContext();
  // tsx preserves function names with this helper; Playwright serializes callbacks alone.
  await context.addInitScript('globalThis.__name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });');
  // Every HTTP request is fulfilled locally. Nothing can contact Keryx, Circle or an RPC.
  await context.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Synthetic buyer check</p>" }));
  const errors: string[] = [];
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.on("pageerror", error => errors.push(error.message));
    await page.exposeFunction("signSyntheticBuyer", (a: Parameters<typeof buyerTypedData>[0]) => account.signTypedData(buyerTypedData(a)));
    await page.goto("https://buyer.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
  }
  const [a, b] = pages;
  const original = intent(1);
  await a.evaluate(value => window.BrowserBuyerTest.createBrowserJournal(value), original);
  const claims = await Promise.all(pages.map(page => page.evaluate(value => window.BrowserBuyerTest.claimBrowserSubmission(value), original)));
  assert.equal(claims.filter(Boolean).length, 1, "Exactly one tab may cross the boundary");
  await a.reload(); await a.addScriptTag({ content: bundle.outputFiles[0].text });
  assert.equal(await a.evaluate(value => window.BrowserBuyerTest.claimBrowserSubmission(value), original), false);
  const copy = await a.evaluate(id => window.BrowserBuyerTest.exportBrowserJournal(id), original.queryId);
  assert.deepEqual(JSON.parse(copy), { schema: "keryx-buyer-recovery-v1", intent: original });
  const acknowledgement = { httpStatus: 202, evidence: { success: true as const, payer: account.address, network: requirement.network, transaction: "synthetic-seller-ack" } };
  await a.evaluate(async ({ original, acknowledgement }) => {
    await window.BrowserBuyerTest.saveBrowserAcknowledgement(original, acknowledgement);
  }, { original, acknowledgement });
  const portable = await a.evaluate(id => window.BrowserBuyerTest.exportBrowserJournal(id), original.queryId);
  const input = join(portableDirectory, "browser.json");
  const output = join(portableDirectory, "node.json");
  const state = join(portableDirectory, "state");
  await writeFile(input, portable);
  await importBuyerRecovery(input, state);
  await exportBuyerRecovery(state, output);
  const nodeCopy = await readFile(output, "utf8");
  assert.deepEqual(JSON.parse(nodeCopy), JSON.parse(portable));
  await a.evaluate(id => window.BrowserBuyerTest.deleteBrowserJournal(id), original.queryId);
  const restored = await b.evaluate(text => window.BrowserBuyerTest.importBrowserJournal(text), nodeCopy);
  assert.deepEqual(restored.acknowledgement, acknowledgement);
  assert.equal(restored.origin, "imported");
  assert.equal(await a.evaluate(value => window.BrowserBuyerTest.claimBrowserSubmission(value), original), false);
  const imported = intent(2);
  await a.evaluate(value => window.BrowserBuyerTest.importBrowserJournal(JSON.stringify(value)), imported);
  assert.equal(await b.evaluate(value => window.BrowserBuyerTest.claimBrowserSubmission(value), imported), false);
  assert.equal(await b.evaluate(async value => { try { await window.BrowserBuyerTest.createBrowserJournal(value); return false; } catch { return true; } }, original), true);

  const aborted = await a.evaluate(async value => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = add.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    let refused = false;
    try { await window.BrowserBuyerTest.createBrowserJournal(value); } catch { refused = true; }
    finally { IDBObjectStore.prototype.add = add; }
    let absent = false;
    try { await window.BrowserBuyerTest.readBrowserJournal(value.queryId); } catch { absent = true; }
    return { refused, absent };
  }, intent(3));
  assert.deepEqual(aborted, { refused: true, absent: true }, "Request success is not transaction durability");

  const prepared = intent(4);
  await a.evaluate(value => window.BrowserBuyerTest.createBrowserJournal(value), prepared);
  const boundary = await a.evaluate(async value => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args); request.addEventListener("success", () => this.transaction.abort()); return request;
    };
    let refused = false;
    try { await window.BrowserBuyerTest.claimBrowserSubmission(value); } catch { refused = true; }
    finally { IDBObjectStore.prototype.put = put; }
    return { refused, state: (await window.BrowserBuyerTest.readBrowserJournal(value.queryId)).submission };
  }, prepared);
  assert.deepEqual(boundary, { refused: true, state: "prepared" });
  assert.equal(await a.evaluate(async value => { try { await window.BrowserBuyerTest.importBrowserJournal(JSON.stringify({ ...value, signature: "must not persist" })); return false; } catch { return true; } }, intent(5)), true);
  await a.evaluate(id => window.BrowserBuyerTest.deleteBrowserJournal(id), imported.queryId);
  assert.equal(await a.evaluate(async id => { try { await window.BrowserBuyerTest.readBrowserJournal(id); return false; } catch { return true; } }, imported.queryId), true);

  const purchase = await a.evaluate(async template => {
    const api = window.BrowserBuyerTest;
    const header = btoa(JSON.stringify({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [template.requirement] }));
    let paidPosts = 0;
    let preparedId = "";
    let gateBeforePost = false;
    const result = await api.buyBrowserResearch({ request: template.request, payee: template.requirement.payTo, payer: template.authorization.from,
      acceptedTotalMicros: "50000", readWallet: async () => ({ address: template.authorization.from, chainId: 5042002, gatewayBalanceMicros: "50000" }),
      onPrepared: value => { preparedId = value.queryId; },
      sign: async value => {
        if ((await api.readBrowserJournal(preparedId)).submission !== "prepared") throw new Error("Signature before durable journal");
        return window.signSyntheticBuyer(value);
      },
    }, { http: async (_url, init) => {
      if (!new Headers(init?.headers).has("payment-signature")) return new Response("{}", { status: 402, headers: { "payment-required": header } });
      paidPosts++;
      gateBeforePost = (await api.readBrowserJournal(preparedId)).submission === "submission_possible";
      return new Response("delivery failed", { status: 500, headers: { "payment-response": btoa(JSON.stringify({ success: true,
        payer: template.authorization.from, network: "eip155:5042002", transaction: "synthetic-evidence", signature: "must-not-save", extra: "must-not-save" })) } });
    } });
    const row = await api.readBrowserJournal(result.queryId);
    let overwriteRefused = false;
    try { await api.saveBrowserAcknowledgement(row.intent, { httpStatus: 500, evidence: null }); } catch { overwriteRefused = true; }
    return { queryId: result.queryId, paidPosts, gateBeforePost, status: result.status, overwriteRefused,
      persisted: result.acknowledgementPersisted, containsSecret: JSON.stringify(row).includes("must-not-save") };
  }, intent(6));
  assert.deepEqual({ ...purchase, queryId: "private" }, { queryId: "private", paidPosts: 1, gateBeforePost: true,
    status: "submission_uncertain", overwriteRefused: true, persisted: true, containsSecret: false });
  await b.reload(); await b.addScriptTag({ content: bundle.outputFiles[0].text });
  const resumed = await b.evaluate(async id => {
    let gets = 0;
    const result = await window.BrowserBuyerTest.resumeBrowserResearch(id, { http: async (_url, init) => {
      if (init?.method !== "GET" || new Headers(init.headers).has("payment-signature")) throw new Error("Recovery attempted payment");
      gets++; return new Response("{}", { status: 404 });
    } });
    return { gets, status: result.status, payment: result.payment.state };
  }, purchase.queryId);
  assert.deepEqual(resumed, { gets: 1, status: "not_found_uncertain", payment: "seller_reported_settled" });
  assert.equal((await a.evaluate(() => window.BrowserBuyerTest.listBrowserJournals())).length, 3);
  const created = await Promise.allSettled(pages.map(page => page.evaluate(payer => window.BrowserBuyerTest.createFundingRecord(payer, "50000"), account.address)));
  assert.equal(created.filter(result => result.status === "fulfilled").length, 1, "Only one active funding operation per payer across tabs");
  const funding = created.find(result => result.status === "fulfilled");
  if (funding?.status !== "fulfilled") throw new Error("Missing funding record");
  const fundingClaims = await Promise.all(pages.map(page => page.evaluate(id => window.BrowserBuyerTest.claimFundingStep(id, "approval", 7, "100"), funding.value.id)));
  assert.equal(fundingClaims.filter(Boolean).length, 1);
  const fundingChecks = await a.evaluate(async id => {
    const api = window.BrowserBuyerTest;
    const cancelledWhileUncertain = await api.cancelFundingRecord(id);
    const approval = `0x${"1".repeat(64)}`, deposit = `0x${"2".repeat(64)}`;
    await api.saveFundingHash(id, "approval", approval);
    await api.confirmFundingStep(id, "approval", approval, "confirmed");
    const depositClaimed = await api.claimFundingStep(id, "deposit", 8, "102");
    await api.saveFundingHash(id, "deposit", deposit);
    await api.confirmFundingStep(id, "deposit", deposit, "confirmed");
    const first = await api.readFundingRecord(id);
    const next = await api.createFundingRecord(first.payer, "50000");
    const cancelledReady = await api.cancelFundingRecord(next.id);
    return { cancelledWhileUncertain, depositClaimed, unlocked: !first.activePayer, cancelledReady, history: (await api.listFundingRecords(first.payer)).length };
  }, funding.value.id);
  assert.deepEqual(fundingChecks, { cancelledWhileUncertain: false, depositClaimed: true, unlocked: true, cancelledReady: true, history: 2 });
  assert.deepEqual(errors, []);
  console.log("PASS: Chromium cross-tab journals, commit/abort, private recovery, one-shot purchase and funding gates, uncertain cancellation refusal and retained funding history. All HTTP intercepted; no settlement.");
} finally { await browser.close(); await rm(portableDirectory, { recursive: true, force: true }); }
