/** Real Chromium IndexedDB with unfunded local signatures; HTTP is intercepted. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWithdrawalRequest, type WithdrawalRequestRecord } from "../lib/gateway/withdrawal-request";
import { withdrawTypedData, type WithdrawPolicy } from "../lib/gateway/withdraw-protocol";
import type { createWithdrawalBrowserDraft } from "../lib/gateway/withdrawal-browser-journal";

const account = privateKeyToAccount(generatePrivateKey());
const policy: WithdrawPolicy = { owner: account.address, recipient: account.address, domain: 26,
  gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  asset: "0x3600000000000000000000000000000000000000", maxValueMicros: "50000", maxFeeMicros: "2010000" };
const bundle = await build({ stdin: { contents: `import * as journal from './lib/gateway/withdrawal-browser-journal';
import {prepareWithdrawIntent} from './lib/gateway/withdraw-intent';
import * as flow from './lib/gateway/withdrawal-browser-flow';
import * as recovery from './lib/gateway/withdrawal-recovery-file';
import * as preparation from './lib/gateway/withdrawal-browser-prepare';
import {WithdrawalRecoveryPanel} from './components/keryx/withdrawal-recovery-panel';
import {WithdrawalReviewPanel} from './components/keryx/withdrawal-review-panel';
import {createElement, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {hashTypedData} from 'viem';
window.flow=flow;window.recovery=recovery;window.preparation=preparation;window.hashTypedData=hashTypedData;
window.mountRecovery=address=>{window.recoveryRoot??=createRoot(document.querySelector('main'));
window.recoveryRoot.render(createElement(StrictMode,null,createElement(WithdrawalRecoveryPanel,{address})));};
window.mountReview=(id,address,signature)=>{window.reviewSignCalls=0;window.recoveryRoot??=createRoot(document.querySelector('main'));
const wallet={account:{address},signTypedData:async typed=>{window.reviewSignCalls++;if(window.hashTypedData(typed)!==id)throw new Error('Changed reviewed terms');return signature;}};
window.recoveryRoot.render(createElement(StrictMode,null,createElement(WithdrawalReviewPanel,{id,address,wallet})));};
window.journal=journal;window.fresh=p=>journal.createWithdrawalBrowserDraft(prepareWithdrawIntent(p.owner,50000n),p);`,
  resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env": "{}" } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); let requests = 0, statusRequests = 0, submitRequests = 0;
  let expectedSubmission: WithdrawalRequestRecord | undefined;
  let preparedResponse: unknown, prepareRequests = 0;
  const statusResponses = new Map<string, { status: number; body: unknown }>();
  let changeOwnerDuringStatus: (() => Promise<void>) | undefined;
  await context.route("**/*", async route => {
    if (route.request().url() === "https://withdrawal-journal.test/api/me/withdrawals/prepare") {
      prepareRequests++; assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), { amountMicros: "50000" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(preparedResponse) });
    }
    if (route.request().url() === "https://withdrawal-journal.test/api/me/withdrawals/submit") {
      submitRequests++; assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), expectedSubmission?.request);
      const page = route.request().frame().page();
      assert.equal((await page.evaluate(`window.journal.readWithdrawalBrowserJournal(${JSON.stringify(expectedSubmission!.id)},
        ${JSON.stringify(expectedSubmission!.owner)})`)).state, "submission-possible");
      return route.abort("failed"); // Synthetic loss after the actual browser HTTP boundary.
    }
    if (route.request().url() === "https://withdrawal-journal.test/api/me/withdrawals/status") {
      statusRequests++; assert.equal(route.request().method(), "POST");
      const body = route.request().postDataJSON(); assert.deepEqual(Object.keys(body), ["id"]);
      if (changeOwnerDuringStatus) await changeOwnerDuringStatus();
      const response = statusResponses.get(body.id) ?? { status: 404, body: { error: "Withdrawal unavailable" } };
      return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
    }
    requests++; assert.equal(route.request().method(), "GET"); assert.equal(route.request().url(), "https://withdrawal-journal.test/");
    return route.fulfill({ contentType: "text/html", body: "<main>Withdrawal journal fixture</main>" });
  });
  const pages = [await context.newPage(), await context.newPage()];
  const mount = async (page: Page) => { await page.goto("https://withdrawal-journal.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
  await Promise.all(pages.map(mount)); const [first, second] = pages;
  const invoke = (page: Page, name: string, value: unknown, owner = account.address) =>
    page.evaluate(`window.journal[${JSON.stringify(name)}](${JSON.stringify(value)},${JSON.stringify(owner)})`);
  const fresh = () => first.evaluate<ReturnType<typeof createWithdrawalBrowserDraft>>(`window.fresh(${JSON.stringify(policy)})`);
  const sign = async (draft: Awaited<ReturnType<typeof fresh>>) => createWithdrawalRequest({ burnIntent: draft.burnIntent,
    signature: await account.signTypedData(withdrawTypedData(draft.burnIntent)) }, policy);
  const draft = await fresh();
  assert.equal((await invoke(first, "reserveWithdrawalBrowserJournal", draft)).state, "reserved");
  await assert.rejects(invoke(second, "reserveWithdrawalBrowserJournal", draft));
  assert.equal((await invoke(second, "readWithdrawalBrowserJournal", draft.id)).request, undefined);
  const original = await sign(draft);
  await assert.rejects(invoke(first, "saveWithdrawalBrowserSignature", { ...original, request: { ...original.request, signature: `0x${"00".repeat(65)}` } }));
  assert.equal((await invoke(first, "saveWithdrawalBrowserSignature", original)).state, "signed");
  const claims = await Promise.all(pages.map(page => invoke(page, "claimWithdrawalBrowserSubmission", original)));
  assert.equal(claims.filter(Boolean).length, 1);
  await mount(first);
  assert.equal((await invoke(first, "readWithdrawalBrowserJournal", draft.id)).state, "submission-possible");
  assert.equal(await invoke(first, "claimWithdrawalBrowserSubmission", original), false);
  await assert.rejects(invoke(first, "readWithdrawalBrowserJournal", draft.id, `0x${"00".repeat(20)}`));
  const imported = await sign(await fresh());
  assert.equal((await invoke(first, "importWithdrawalBrowserJournal", imported)).origin, "imported");
  assert.equal(await invoke(second, "claimWithdrawalBrowserSubmission", imported), false);
  await assert.rejects(invoke(first, "saveWithdrawalBrowserSignature", imported));
  const interruptedDraft = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", interruptedDraft);
  const interrupted = await sign(interruptedDraft); await invoke(first, "saveWithdrawalBrowserSignature", interrupted);
  await first.evaluate(`window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){
    const request=window.originalPut.apply(this,args);this.transaction.abort();return request;};`);
  await assert.rejects(invoke(first, "claimWithdrawalBrowserSubmission", interrupted));
  await first.evaluate("IDBObjectStore.prototype.put=window.originalPut");
  assert.equal((await invoke(second, "readWithdrawalBrowserJournal", interrupted.id)).state, "signed");
  assert.equal(await invoke(second, "claimWithdrawalBrowserSubmission", interrupted), true);
  const unsigned = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", unsigned);
  await first.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('keryx-creator-withdrawals-v1',1);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests');
      const get=store.get(${JSON.stringify(unsigned.id)});get.onsuccess=()=>{const row=get.result;row.draft.burnIntent.spec.value='1';store.put(row);};
      tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>{db.close();reject(new Error('fixture failure'));};};})`);
  await assert.rejects(invoke(second, "readWithdrawalBrowserJournal", unsigned.id));
  const partial = await first.evaluate(`window.journal.listWithdrawalBrowserJournals(${JSON.stringify(account.address)})`);
  assert.equal(partial.unavailableCount, 1);
  assert.ok(partial.requests.some((row: { id: string }) => row.id === original.id), "a corrupt original does not hide valid saved requests");
  // Owner-indexed listing must not expose another wallet's local signed payloads.
  const foreign = await first.evaluate(`window.journal.listWithdrawalBrowserJournals('0x${"00".repeat(20)}')`);
  assert.deepEqual(foreign.requests, []);
  // Missing storage is not automatic permission to replay an imported original.
  const recoveryText = await first.evaluate<string>(`window.recovery.exportWithdrawalRecoveryFile(${JSON.stringify(original.id)},
    ${JSON.stringify(account.address)},()=>${JSON.stringify(account.address)},new AbortController().signal)`);
  assert.deepEqual(JSON.parse(recoveryText).original, original);
  await assert.rejects(first.evaluate(`window.recovery.exportWithdrawalRecoveryFile(${JSON.stringify(original.id)},
    ${JSON.stringify(account.address)},()=> '0x${"00".repeat(20)}',new AbortController().signal)`));
  await first.evaluate(`new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('keryx-creator-withdrawals-v1');q.onsuccess=()=>resolve(true);q.onerror=()=>reject(new Error('fixture failure'));})`);
  await assert.rejects(invoke(first, "claimWithdrawalBrowserSubmission", original));
  await first.evaluate(`window.recovery.importWithdrawalRecoveryFile(${JSON.stringify(recoveryText)},${JSON.stringify(account.address)},
    ()=>${JSON.stringify(account.address)},new AbortController().signal)`);
  await assert.rejects(second.evaluate(`window.recovery.importWithdrawalRecoveryFile(${JSON.stringify(recoveryText)},${JSON.stringify(account.address)},
    ()=>${JSON.stringify(account.address)},new AbortController().signal)`));
  assert.equal(await invoke(first, "claimWithdrawalBrowserSubmission", original), false);
  const recovered: WithdrawalRequestRecord = (await invoke(second, "readWithdrawalBrowserJournal", original.id)).request;
  assert.deepEqual(recovered, original);
  for (let index = 0; index < 26; index++) await invoke(first, "reserveWithdrawalBrowserJournal", await fresh());
  const ids = await first.evaluate(`(async()=>{const ids=[];let cursor;do{const page=await window.journal.listWithdrawalBrowserJournals(
    ${JSON.stringify(account.address)},cursor);ids.push(...page.requests.map(row=>row.id));cursor=page.nextCursor;}while(cursor);return ids;})()`);
  assert.equal(ids.length, 27); assert.equal(new Set(ids).size, 27);
  const pageBoundaryId = ids[24];
  await first.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('keryx-creator-withdrawals-v1',1);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('requests','readwrite'),store=tx.objectStore('requests');
      const get=store.get(${JSON.stringify(pageBoundaryId)});get.onsuccess=()=>{const row=get.result;row.draft.burnIntent.spec.value='1';store.put(row);};
      tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>{db.close();reject(new Error('fixture failure'));};};})`);
  const boundaryPage = await first.evaluate(`window.journal.listWithdrawalBrowserJournals(${JSON.stringify(account.address)})`);
  assert.equal(boundaryPage.requests.length, 24); assert.equal(boundaryPage.unavailableCount, 1);
  assert.equal(boundaryPage.nextCursor, pageBoundaryId);
  const followingPage = await first.evaluate(`window.journal.listWithdrawalBrowserJournals(${JSON.stringify(account.address)},${JSON.stringify(boundaryPage.nextCursor)})`);
  assert.equal(followingPage.requests.length, 2); assert.equal(followingPage.nextCursor, null);
  const blocked = await fresh();
  await first.evaluate("window.idbDescriptor=Object.getOwnPropertyDescriptor(window,'indexedDB');Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});");
  await assert.rejects(invoke(first, "reserveWithdrawalBrowserJournal", blocked));
  await first.evaluate("Object.defineProperty(window,'indexedDB',window.idbDescriptor)");
  // Exercise the actual flow coordinator with real Node-generated EOA signatures.
  const flowDraft = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", flowDraft);
  const flowOriginal = await sign(flowDraft);
  const signFlow = (draft: typeof flowDraft, signed: WithdrawalRequestRecord, changeOwner: boolean) => first.evaluate(`(async()=>{
    const owner=${JSON.stringify(account.address)},id=${JSON.stringify(draft.id)};window.activeOwner=owner;window.walletCalls=0;
    const wallet={account:{address:owner},signTypedData:async typed=>{window.walletCalls++;
      if(window.hashTypedData(typed)!==id)throw new Error('Changed wallet payload');
      if((await window.journal.readWithdrawalBrowserJournal(id,owner)).state!=='reserved')throw new Error('Draft not durable before wallet prompt');
      if(${changeOwner})window.activeOwner='0x${"00".repeat(20)}';return ${JSON.stringify(signed.request.signature)};}};
    return window.flow.signWithdrawalBrowserDraft(id,owner,wallet,()=>window.activeOwner,new AbortController().signal);
  })()`);
  assert.equal((await signFlow(flowDraft, flowOriginal, false)).state, "signed");
  await assert.rejects(signFlow(flowDraft, flowOriginal, false));
  assert.equal(await first.evaluate("window.walletCalls"), 0, "a signed original never prompts the wallet again");
  const submitFlow = (page: Page) => page.evaluate(`(async()=>{
    const owner=${JSON.stringify(account.address)},id=${JSON.stringify(flowDraft.id)};window.activeOwner=owner;window.postCalls??=0;
    return window.flow.submitWithdrawalBrowserOnce(id,owner,()=>window.activeOwner,async original=>{
      window.postCalls++;window.transportOriginalId=original.id;
      window.transportClaimState=(await window.journal.readWithdrawalBrowserJournal(id,owner)).state;
      throw new Error('Synthetic lost transport response');
    },new AbortController().signal);
  })()`);
  const outcomes = await Promise.all(pages.map(submitFlow));
  assert.ok(outcomes.every(value => value.state === "recovery-required"));
  assert.equal((await first.evaluate("window.postCalls")) + (await second.evaluate("window.postCalls")), 1);
  for (const page of pages) if (await page.evaluate("window.postCalls")) {
    assert.equal(await page.evaluate("window.transportOriginalId"), flowDraft.id);
    assert.equal(await page.evaluate("window.transportClaimState"), "submission-possible");
  }
  await submitFlow(first);
  assert.equal((await first.evaluate("window.postCalls")) + (await second.evaluate("window.postCalls")), 1);
  const switched = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", switched);
  const switchedOriginal = await sign(switched);
  await assert.rejects(signFlow(switched, switchedOriginal, true));
  assert.equal((await invoke(second, "readWithdrawalBrowserJournal", switched.id)).state, "signed",
    "a valid returned signature is retained for its original owner after account switch");
  const wrongOwner = await first.evaluate(`window.flow.submitWithdrawalBrowserOnce(${JSON.stringify(switched.id)},${JSON.stringify(account.address)},
    ()=>window.activeOwner,async()=>{throw new Error('Transport must not run');},new AbortController().signal).then(()=>false,()=>true)`);
  assert.equal(wrongOwner, true);
  assert.equal((await invoke(second, "readWithdrawalBrowserJournal", switched.id)).state, "signed");
  // Account change after local admission consumes the marker but must never transmit.
  const stopped = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", stopped);
  const stoppedOriginal = await sign(stopped); await invoke(first, "saveWithdrawalBrowserSignature", stoppedOriginal);
  const stoppedResult = await first.evaluate(`(async()=>{let checks=0,calls=0;
    const owner=${JSON.stringify(account.address)},id=${JSON.stringify(stopped.id)};
    const failed=await window.flow.submitWithdrawalBrowserOnce(id,owner,()=>++checks<3?owner:'0x${"00".repeat(20)}',
      async()=>{calls++;},new AbortController().signal).then(()=>false,()=>true);
    return {failed,calls,state:(await window.journal.readWithdrawalBrowserJournal(id,owner)).state};})()`);
  assert.deepEqual(stoppedResult, { failed: true, calls: 0, state: "submission-possible" });
  assert.equal(await invoke(second, "claimWithdrawalBrowserSubmission", stoppedOriginal), false);
  statusResponses.set(flowOriginal.id, { status: 200, body: { wallet: flowOriginal.owner, requestId: flowOriginal.id,
    recipient: flowOriginal.policy.recipient, amountMicros: flowOriginal.request.burnIntent.spec.value,
    status: "awaiting-transfer-evidence", chainFinalityVerified: false, mintStatus: "not-checked" } });
  const recover = () => first.evaluate(`(async()=>{window.activeOwner=${JSON.stringify(account.address)};
    return window.flow.recoverWithdrawalBrowserStatus(${JSON.stringify(flowOriginal.id)},${JSON.stringify(account.address)},
      ()=>window.activeOwner,new AbortController().signal);})()`);
  assert.equal((await recover()).state, "observed-transfer");
  statusResponses.delete(flowOriginal.id);
  assert.equal((await recover()).state, "unavailable");
  assert.equal(await invoke(second, "claimWithdrawalBrowserSubmission", flowOriginal), false, "404 never renews a consumed claim");
  changeOwnerDuringStatus = () => first.evaluate(`window.activeOwner='0x${"00".repeat(20)}'`).then(() => undefined);
  await assert.rejects(recover());
  assert.equal(statusRequests, 3);
  const httpDraft = await fresh(); await invoke(first, "reserveWithdrawalBrowserJournal", httpDraft);
  expectedSubmission = await sign(httpDraft); await invoke(first, "saveWithdrawalBrowserSignature", expectedSubmission);
  const submitHttp = (page: Page) => page.evaluate(`window.flow.submitWithdrawalBrowserHttpOnce(
    ${JSON.stringify(httpDraft.id)},${JSON.stringify(account.address)},()=>${JSON.stringify(account.address)},new AbortController().signal)`);
  const httpOutcomes = await Promise.all(pages.map(submitHttp));
  assert.ok(httpOutcomes.every(value => value.state === "recovery-required"));
  assert.equal(submitRequests, 1);
  await submitHttp(first); await submitHttp(second);
  assert.equal(submitRequests, 1, "lost HTTP response cannot authorize another transmission");
  assert.equal(requests, 3);
  await first.evaluate(`window.mountRecovery(${JSON.stringify(account.address)})`);
  await first.getByRole("heading", { name: "Recover a withdrawal" }).waitFor();
  await first.getByRole("listitem").first().waitFor();
  const [download] = await Promise.all([first.waitForEvent("download"),
    first.locator("button:enabled").filter({ hasText: "Download private recovery file" }).first().click()]);
  assert.equal(download.suggestedFilename(), "keryx-withdrawal-recovery.json");
  const uiImported = await sign(await fresh());
  await first.getByLabel("Import withdrawal recovery file").setInputFiles({ name: "recovery.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "keryx-withdrawal-recovery-v1", network: "eip155:5042002",
      recoveryOnly: true, exportedAt: new Date().toISOString(), original: uiImported })) });
  await first.getByRole("status").filter({ hasText: "Recovery file imported." }).waitFor();
  assert.equal((await invoke(first, "readWithdrawalBrowserJournal", uiImported.id)).origin, "imported");
  assert.equal(await invoke(first, "claimWithdrawalBrowserSubmission", uiImported), false);
  await first.evaluate(`window.mountRecovery('0x${"00".repeat(20)}')`);
  await first.getByText("No withdrawal requests saved for this wallet in this browser. Import a recovery file if you have one.", { exact: true }).waitFor();
  assert.equal(await first.getByRole("button", { name: "Download private recovery file" }).count(), 0);
  assert.equal(submitRequests, 1, "recovery UI never submits a payment");
  const reviewDraft = await first.evaluate<ReturnType<typeof createWithdrawalBrowserDraft>>(`window.journal.createWithdrawalBrowserDraft(
    {...window.fresh(${JSON.stringify(policy)}).burnIntent,maxBlockHeight:'11000'},${JSON.stringify(policy)})`);
  preparedResponse = { wallet: reviewDraft.owner, draft: reviewDraft, preparedAt: new Date().toISOString() };
  const prepare = () => first.evaluate(`window.preparation.prepareWithdrawalBrowserDraft(${JSON.stringify(policy)},
    ()=>${JSON.stringify(account.address)},new AbortController().signal)`);
  const prepared = await prepare();
  assert.equal(prepared.state, "reserved"); assert.equal(prepared.request, undefined);
  assert.deepEqual((await invoke(second, "readWithdrawalBrowserJournal", reviewDraft.id)).draft, reviewDraft);
  assert.equal(submitRequests, 1, "unsigned preparation never submits a payment");
  await assert.rejects(prepare(), "duplicate preparation cannot replace a saved original");
  assert.equal(prepareRequests, 2);
  const reviewOriginal = await sign(reviewDraft); expectedSubmission = reviewOriginal;
  await first.evaluate(`window.mountReview(${JSON.stringify(reviewDraft.id)},${JSON.stringify(account.address)},${JSON.stringify(reviewOriginal.request.signature)})`);
  await first.getByRole("button", { name: "Sign reviewed withdrawal" }).click();
  await first.getByRole("button", { name: "Send signed withdrawal" }).waitFor();
  assert.equal(await first.evaluate("window.reviewSignCalls"), 1);
  assert.equal(submitRequests, 1, "signing alone never sends HTTP");
  await first.getByRole("button", { name: "Send signed withdrawal" }).click();
  await first.getByText("This request is recovery-only. Check its status in withdrawal recovery.", { exact: true }).waitFor();
  assert.equal(submitRequests, 2);
  assert.equal(await first.getByRole("button", { name: "Send signed withdrawal" }).count(), 0);
  assert.equal(await invoke(second, "claimWithdrawalBrowserSubmission", reviewOriginal), false);
  console.log("PASS: Chromium withdrawal journal, signing, cross-tab single HTTP submission, lost-response recovery, owner isolation, abort and recovery-only imports; all HTTP intercepted, no live payment.");
} finally { await browser.close(); }
