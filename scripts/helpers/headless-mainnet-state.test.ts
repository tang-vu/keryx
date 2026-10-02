import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";
import { browserSessionCustodyContext } from "../../lib/session/browser-session-custody";
import { createBrowserSessionKey } from "../../lib/session/browser-session-key";
import { privateHeadlessTestDirectory } from "./headless-state-test-fixture";
import { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), wrapping = `0x${"22".repeat(32)}`;
const context = browserSessionCustodyContext(ARC_MAINNET_PROFILE,"https://keryx.cc",owner.address);
const epoch = "00000000-0000-4000-8000-000000000001", nextEpoch = "00000000-0000-4000-8000-000000000002";
const question={id:"00000000-0000-4000-8000-000000000005",budgetMicroUsdc:"10"};
const nonce = `0x${"33".repeat(32)}`, nextNonce = `0x${"44".repeat(32)}`;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
function privateDirectory() { const root=privateHeadlessTestDirectory();roots.push(root);return root; }

it("retains encrypted funded custody across a fresh open without another derivation",async()=>{
  const directory=privateDirectory();let state=await openHeadlessMainnetState(directory,context,wrapping);
  const key=createBrowserSessionKey(context.origin,owner.address,state);
  const signature=await owner.signMessage({message:key.context.derivationMessage});await key.derive(signature);
  const address=key.address, file=state.file;key.lock();state.close();
  const bytes=fs.readFileSync(file);expect(bytes.toString()).not.toContain(signature);
  expect(bytes.toString()).not.toContain("11".repeat(32));
  state=await openHeadlessMainnetState(directory,context,wrapping);
  const restored=createBrowserSessionKey(context.origin,owner.address,state);await restored.restore();
  expect(restored.address).toBe(address);restored.lock();state.close();
});
it("holds the same nonce and cumulative capacity across reload and grant epochs",async()=>{
  const directory=privateDirectory();let state=await openHeadlessMainnetState(directory,context,wrapping);
  await state.reserve(context.storageNamespace,epoch,nonce,BigInt(7),BigInt(10),question);
  await state.retainHeader(nonce,"synthetic-signed-header-not-a-real-payment");state.close();
  state=await openHeadlessMainnetState(directory,context,wrapping);
  await expect(state.reserve(context.storageNamespace,nextEpoch,nonce,BigInt(1),BigInt(10),question)).rejects.toThrow("owner recovery");
  await expect(state.reserve(context.storageNamespace,nextEpoch,nextNonce,BigInt(4),BigInt(10),question)).rejects.toThrow("owner recovery");
  await state.reserve(context.storageNamespace,nextEpoch,nextNonce,BigInt(3),BigInt(10),question);
  expect(state.originalNonces()).toHaveLength(2);const file=state.file;state.close();
  expect(fs.readFileSync(file).toString()).not.toContain("synthetic-signed-header");
});
it("refuses concurrent custody access and retains malformed existing state",async()=>{
  const directory=privateDirectory(), state=await openHeadlessMainnetState(directory,context,wrapping);
  await expect(openHeadlessMainnetState(directory,context,wrapping)).rejects.toThrow("owner recovery");
  const file=state.file;state.close();fs.writeFileSync(file,"broken-private-do-not-log");
  const original=fs.readFileSync(file);
  await expect(openHeadlessMainnetState(directory,context,wrapping)).rejects.toThrow("owner recovery");
  expect(fs.readFileSync(file)).toEqual(original);
});
it("wrong wrapping key cannot rotate the original signer",async()=>{
  const directory=privateDirectory();let state=await openHeadlessMainnetState(directory,context,wrapping);
  const key=createBrowserSessionKey(context.origin,owner.address,state);await key.derive(await owner.signMessage({message:key.context.derivationMessage}));
  const file=state.file;key.lock();state.close();const original=fs.readFileSync(file);
  state=await openHeadlessMainnetState(directory,context,`0x${"55".repeat(32)}`);
  const wrong=createBrowserSessionKey(context.origin,owner.address,state);await expect(wrong.restore()).rejects.toThrow();
  wrong.lock();state.close();expect(fs.readFileSync(file)).toEqual(original);
});
it("rejects an altered identity before touching retained custody",async()=>{
  const directory=privateDirectory(), state=await openHeadlessMainnetState(directory,context,wrapping), file=state.file;state.close();
  const db=new DatabaseSync(file);db.exec("DROP TRIGGER identity_no_update;UPDATE identity SET value='synthetic-conflicting-identity'");db.close();
  const original=fs.readFileSync(file);await expect(openHeadlessMainnetState(directory,context,wrapping)).rejects.toThrow("owner recovery");
  expect(fs.readFileSync(file)).toEqual(original);
});

it("atomically enforces an immutable per-question budget inside a larger lifetime grant",async()=>{
  const directory=privateDirectory(),state=await openHeadlessMainnetState(directory,context,wrapping);
  const scoped={...question,budgetMicroUsdc:"5"};
  await state.reserve(context.storageNamespace,epoch,nonce,BigInt(3),BigInt(100),scoped);
  await expect(state.reserve(context.storageNamespace,epoch,nextNonce,BigInt(3),BigInt(100),scoped)).rejects.toThrow("owner recovery");
  await expect(state.reserve(context.storageNamespace,epoch,nextNonce,BigInt(3),BigInt(100),{...scoped,budgetMicroUsdc:"20"})).rejects.toThrow("owner recovery");
  expect(state.originalNonces()).toHaveLength(1);state.close();
});

it("terminal observations never delete nonce or restore cumulative capacity",async()=>{
  const directory=privateDirectory(),state=await openHeadlessMainnetState(directory,context,wrapping);
  await state.reserve(context.storageNamespace,epoch,nonce,BigInt(10),BigInt(10),question);
  state.recordSettled(nonce,"a".repeat(64));expect(state.unresolvedNonces()).toEqual([]);expect(state.originalNonces()).toHaveLength(1);
  await expect(state.reserve(context.storageNamespace,nextEpoch,nextNonce,BigInt(1),BigInt(10),{...question,id:nextEpoch})).rejects.toThrow("owner recovery");
  expect(()=>state.recordSettled(nonce,"b".repeat(64))).toThrow("owner recovery");state.close();
});
