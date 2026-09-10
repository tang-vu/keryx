/** Chromium IndexedDB + EOA signatures. All HTTP is intercepted; no funded wallet is used. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { buyerTypedData } from "../lib/buyer/protocol";
import { preparePrivateResearchIntent } from "../lib/a2a/private-research-intent";
import { validatePrivateBuyerIntent } from "../lib/buyer/private-journal";
import type { PrivateBrowserDraft } from "../lib/buyer/private-browser-draft";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const merchants = { privatePayee: `0x${"2".repeat(40)}`, publicResearchPayee: `0x${"3".repeat(40)}` };
const fixture = { payer: account.address, merchants,
  request: { question: "Synthetic private storage question", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0",
    responseMode: "async", access: "payer-private-v1", model: "deepseek-flash", reasoning: {
      modelId: "deepseek-flash", provider: "deepseek", wireModel: "deepseek-v4-flash",
      endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic", redirects: "prohibited" } },
  requirement: { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000",
    amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } },
};
const bundle = await build({ stdin: { contents: `
import * as journal from './lib/buyer/private-browser-journal';
import {createPrivateAuthorization,PRIVATE_RESEARCH_RESOURCE} from './lib/buyer/private-request-commitment';
import {privateBrowserDraftId} from './lib/buyer/private-browser-draft';
window.journal=journal;
window.fresh=async f=>{const a=await createPrivateAuthorization(f.request,f.requirement,f.payer,f.merchants,1788912000000);
return {...a,requirement:f.requirement,resource:PRIVATE_RESEARCH_RESOURCE,id:await privateBrowserDraftId(f.requirement,a.authorization)};};
`, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife" });
const browser = await chromium.launch({ headless: true });
let requests = 0;
try {
  const context = await browser.newContext();
  await context.route("**/*", route => {
    requests++;
    assert.equal(route.request().method(), "GET");
    assert.equal(route.request().url(), "https://private-journal.test/");
    return route.fulfill({ contentType: "text/html", body: "<main>Private journal fixture</main>" });
  });
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  const mount = async (page: Page) => { await page.goto("https://private-journal.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text }); };
  await Promise.all(pages.map(mount));
  const [first, second] = pages;
  const invoke = (page: Page, name: string, value: unknown, payer = account.address, policy = merchants) =>
    page.evaluate(`window.journal[${JSON.stringify(name)}](${JSON.stringify(value)},${JSON.stringify(payer)},${JSON.stringify(policy)})`);
  const fresh = () => first.evaluate<PrivateBrowserDraft>(`window.fresh(${JSON.stringify(fixture)})`);
  async function sign(draft: PrivateBrowserDraft) {
    const signature = await account.signTypedData(buyerTypedData(draft.authorization));
    const submission = { request: draft.request, salt: draft.salt, payment: { authorization: draft.authorization, signature } };
    const server = await preparePrivateResearchIntent(submission, draft.requirement, merchants);
    assert.equal(server.id, draft.id, "browser and server identities must agree");
    const originalPreimage = ["keryx-private-order-v1", draft.requirement.network, draft.authorization.from.toLowerCase(),
      draft.authorization.to.toLowerCase(), draft.authorization.nonce].join("|");
    assert.equal(server.id, `prv_${createHash("sha256").update(originalPreimage).digest("hex")}`,
      "Web Crypto must retain the original Node SHA-256 identity");
    return validatePrivateBuyerIntent({ schema: "keryx-private-buyer-intent-v1", resource: draft.resource,
      id: server.id, requirement: server.requirement, submission: server.submission }, account.address, merchants);
  }

  const draft = await fresh();
  const reserved = await invoke(first, "reservePrivateBrowserJournal", draft);
  assert.equal(reserved.state, "reserved"); assert.equal(reserved.intent, undefined);
  const local = await first.evaluate(`window.journal.listPrivateBrowserJournals(${JSON.stringify(account.address)},${JSON.stringify(merchants)})`);
  assert.equal(local.jobs.length, 1); assert.equal(local.jobs[0].state, "reserved");
  const foreign = await first.evaluate(`window.journal.listPrivateBrowserJournals(${JSON.stringify(merchants.publicResearchPayee)},${JSON.stringify(merchants)})`);
  assert.equal(foreign.jobs.length, 0);
  await assert.rejects(invoke(second, "reservePrivateBrowserJournal", draft));
  await assert.rejects(invoke(first, "exportPrivateBrowserJournal", draft.id));
  const intent = await sign(draft);
  await assert.rejects(invoke(first, "savePrivateBrowserSignature", { ...intent,
    submission: { ...intent.submission, payment: { ...intent.submission.payment, signature: `0x${"0".repeat(130)}` } } }));
  assert.equal((await invoke(first, "readPrivateBrowserJournal", intent.id)).state, "reserved");
  const signed = await invoke(first, "savePrivateBrowserSignature", intent);
  assert.equal(signed.state, "signed");
  await assert.rejects(invoke(second, "savePrivateBrowserSignature", intent));
  const claims = await Promise.all(pages.map(page => invoke(page, "claimPrivateBrowserSubmission", intent)));
  assert.equal(claims.filter(Boolean).length, 1, "only one tab can cross the submission boundary");
  await mount(first);
  assert.equal((await invoke(first, "readPrivateBrowserJournal", intent.id)).state, "submission_possible");
  assert.equal(await invoke(first, "claimPrivateBrowserSubmission", intent), false);
  assert.deepEqual(JSON.parse(await invoke(first, "exportPrivateBrowserJournal", intent.id)), intent);
  await assert.rejects(invoke(first, "readPrivateBrowserJournal", intent.id, merchants.publicResearchPayee));
  await assert.rejects(invoke(first, "readPrivateBrowserJournal", intent.id, account.address,
    { ...merchants, privatePayee: `0x${"4".repeat(40)}` }));
  await assert.rejects(invoke(first, "claimPrivateBrowserSubmission", { ...intent,
    submission: { ...intent.submission, request: { ...intent.submission.request, question: "Changed synthetic question" } } }));

  const imported = await sign(await fresh());
  assert.equal((await invoke(first, "importPrivateBrowserJournal", imported)).origin, "imported");
  assert.equal(await invoke(second, "claimPrivateBrowserSubmission", imported), false);
  await assert.rejects(invoke(first, "savePrivateBrowserSignature", imported));
  await assert.rejects(invoke(first, "reservePrivateBrowserJournal", { ...draft, id: imported.id }));

  const interrupted = await fresh();
  await invoke(first, "reservePrivateBrowserJournal", interrupted);
  const interruptedIntent = await sign(interrupted);
  await invoke(first, "savePrivateBrowserSignature", interruptedIntent);
  // Abort the actual IDB transaction after the write request: success must not grant a claim.
  await first.evaluate(`window.originalPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){
    const request=window.originalPut.apply(this,args); this.transaction.abort(); return request; };`);
  await assert.rejects(invoke(first, "claimPrivateBrowserSubmission", interruptedIntent));
  await first.evaluate("IDBObjectStore.prototype.put=window.originalPut;");
  assert.equal((await invoke(second, "readPrivateBrowserJournal", interruptedIntent.id)).state, "signed");
  assert.equal(await invoke(second, "claimPrivateBrowserSubmission", interruptedIntent), true);

  // Recovery can enumerate every local reservation without sending private IDs in URLs.
  for (let index = 0; index < 24; index++) await invoke(first, "reservePrivateBrowserJournal", await fresh());
  const listing = await first.evaluate(`(async()=>{const ids=[];let cursor=null;do{
    const page=await window.journal.listPrivateBrowserJournals(${JSON.stringify(account.address)},${JSON.stringify(merchants)},cursor);
    ids.push(...page.jobs.map(job=>job.id));cursor=page.nextCursor;
  }while(cursor);return ids;})()`);
  assert.equal(listing.length, 27); assert.equal(new Set(listing).size, 27);
  const blocked = await fresh();
  await first.evaluate("window.indexedDBDescriptor=Object.getOwnPropertyDescriptor(window,'indexedDB');Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});");
  await assert.rejects(invoke(first, "reservePrivateBrowserJournal", blocked));
  await first.evaluate("Object.defineProperty(window,'indexedDB',window.indexedDBDescriptor);");
  await assert.rejects(invoke(second, "readPrivateBrowserJournal", blocked.id));

  await assert.rejects(invoke(first, "deletePrivateBrowserJournal", imported.id, merchants.publicResearchPayee));
  await first.evaluate(`window.originalPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){
    const request=window.originalPut.apply(this,args); this.transaction.abort(); return request; };`);
  await assert.rejects(invoke(first, "deletePrivateBrowserJournal", imported.id));
  await first.evaluate("IDBObjectStore.prototype.put=window.originalPut;");
  assert.equal((await invoke(second, "readPrivateBrowserJournal", imported.id)).origin, "imported");
  for (const state of ["reserved", "signed", "submission_possible"]) {
    const removable = await fresh(), signedIntent = await sign(removable);
    await invoke(first, "reservePrivateBrowserJournal", removable);
    if (state !== "reserved") await invoke(first, "savePrivateBrowserSignature", signedIntent);
    if (state === "submission_possible") await invoke(first, "claimPrivateBrowserSubmission", signedIntent);
    await invoke(second, "deletePrivateBrowserJournal", removable.id);
    const marker = await first.evaluate(`new Promise(resolve=>{const open=indexedDB.open('keryx-private-buyer-jobs-v1',1);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('jobs','readonly'),read=tx.objectStore('jobs').get(${JSON.stringify(removable.id)});
        tx.oncomplete=()=>{db.close();resolve(read.result);};};})`);
    assert.deepEqual(marker, { schema: "keryx-private-browser-deleted-v1", id: removable.id, payer: account.address.toLowerCase() });
    await assert.rejects(invoke(first, "readPrivateBrowserJournal", removable.id));
    await assert.rejects(invoke(first, "exportPrivateBrowserJournal", removable.id));
    await assert.rejects(invoke(first, "reservePrivateBrowserJournal", removable));
    await assert.rejects(invoke(first, "savePrivateBrowserSignature", signedIntent));
    await assert.rejects(invoke(first, "claimPrivateBrowserSubmission", signedIntent));
    const restored = await invoke(first, "importPrivateBrowserJournal", signedIntent);
    assert.equal(restored.origin, "imported"); assert.equal(restored.state, "submission_possible");
    assert.equal(await invoke(second, "claimPrivateBrowserSubmission", signedIntent), false);
    await invoke(second, "deletePrivateBrowserJournal", removable.id);
  }
  const afterDeletion = await first.evaluate(`(async()=>{const ids=[];let cursor=null;do{
    const page=await window.journal.listPrivateBrowserJournals(${JSON.stringify(account.address)},${JSON.stringify(merchants)},cursor);
    ids.push(...page.jobs.map(job=>job.id));cursor=page.nextCursor;
  }while(cursor);return ids;})()`);
  assert.deepEqual(afterDeletion, listing, "deleted markers must not hide later recovery pages");
  const contested = await fresh(), contestedIntent = await sign(contested);
  await invoke(first, "reservePrivateBrowserJournal", contested);
  await invoke(first, "savePrivateBrowserSignature", contestedIntent);
  const race = await Promise.allSettled([invoke(first, "claimPrivateBrowserSubmission", contestedIntent),
    invoke(second, "deletePrivateBrowserJournal", contested.id)]);
  if (race[1].status === "rejected") await invoke(second, "deletePrivateBrowserJournal", contested.id);
  await assert.rejects(invoke(first, "claimPrivateBrowserSubmission", contestedIntent));
  await assert.rejects(invoke(first, "reservePrivateBrowserJournal", contested));

  // Corruption is rejected rather than normalized into a new valid purchase.
  await first.evaluate(`new Promise((resolve,reject)=>{const open=indexedDB.open('keryx-private-buyer-jobs-v1',1);
    open.onsuccess=()=>{const db=open.result,tx=db.transaction('jobs','readwrite'),store=tx.objectStore('jobs');
      const read=store.get(${JSON.stringify(intent.id)}); read.onsuccess=()=>{const row=read.result;row.draft.request.question='Corrupted';store.put(row);};
      tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>{db.close();reject(new Error('fixture failure'));};};})`);
  await assert.rejects(invoke(second, "readPrivateBrowserJournal", intent.id));
  assert.equal(requests, 3);
  console.log("PASS: private Chromium journal, Node/EOA identity agreement, cross-tab one-attempt claim, reload, recovery-only import, owner/merchant binding, transaction abort and corruption rejection. No payment HTTP requests.");
} finally { await browser.close(); }
