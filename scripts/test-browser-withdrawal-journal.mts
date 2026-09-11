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
window.journal=journal;window.fresh=p=>journal.createWithdrawalBrowserDraft(prepareWithdrawIntent(p.owner,50000n),p);`,
  resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env": "{}" } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); let requests = 0;
  await context.route("**/*", route => {
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
  // Owner-indexed listing must not expose another wallet's local signed payloads.
  const foreign = await first.evaluate(`window.journal.listWithdrawalBrowserJournals('0x${"00".repeat(20)}')`);
  assert.deepEqual(foreign.requests, []);
  // Missing storage is not automatic permission to replay an imported original.
  await first.evaluate(`new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('keryx-creator-withdrawals-v1');q.onsuccess=()=>resolve(true);q.onerror=()=>reject(new Error('fixture failure'));})`);
  await assert.rejects(invoke(first, "claimWithdrawalBrowserSubmission", original));
  await invoke(first, "importWithdrawalBrowserJournal", original);
  assert.equal(await invoke(first, "claimWithdrawalBrowserSubmission", original), false);
  const recovered: WithdrawalRequestRecord = (await invoke(second, "readWithdrawalBrowserJournal", original.id)).request;
  assert.deepEqual(recovered, original);
  for (let index = 0; index < 26; index++) await invoke(first, "reserveWithdrawalBrowserJournal", await fresh());
  const ids = await first.evaluate(`(async()=>{const ids=[];let cursor;do{const page=await window.journal.listWithdrawalBrowserJournals(
    ${JSON.stringify(account.address)},cursor);ids.push(...page.requests.map(row=>row.id));cursor=page.nextCursor;}while(cursor);return ids;})()`);
  assert.equal(ids.length, 27); assert.equal(new Set(ids).size, 27);
  const blocked = await fresh();
  await first.evaluate("window.idbDescriptor=Object.getOwnPropertyDescriptor(window,'indexedDB');Object.defineProperty(window,'indexedDB',{value:undefined,configurable:true});");
  await assert.rejects(invoke(first, "reserveWithdrawalBrowserJournal", blocked));
  await first.evaluate("Object.defineProperty(window,'indexedDB',window.idbDescriptor)");
  assert.equal(requests, 3);
  console.log("PASS: Chromium withdrawal draft/signature journal, cross-tab single claim, reload, owner isolation, abort, corruption and recovery-only import after storage loss; no payment HTTP.");
} finally { await browser.close(); }
