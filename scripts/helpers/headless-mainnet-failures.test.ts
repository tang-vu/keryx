import fs from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { canonicalJson } from "../../lib/canonical-json";
import { readBrowserSessionPaymentAccounting } from "../../lib/session/browser-session-withdrawal-liabilities";
import { privateHeadlessTestDirectory } from "./headless-state-test-fixture";
import { headlessCashoutFixture, testHeadlessContext as context, testHeadlessWrapping as wrapping } from "./headless-cashout-test-fixture";
import { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";
import { reconcileHeadlessFailures } from "./headless-mainnet-failures.mjs";

const roots: string[] = [], closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true}); });
async function fixture() {
  const directory=privateHeadlessTestDirectory();roots.push(directory);
  const f=await headlessCashoutFixture(directory);closers.push(()=>{f.key.lock();f.state.close();});
  const nonce=`0x${"44".repeat(32)}`,epoch=f.p.grantEpoch,reqId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const requirements={scheme:"exact" as const,network:profile.networkId,asset:profile.usdcAddress.toLowerCase(),amount:"10",payTo:f.p.ownerAddr,maxTimeoutSeconds:691200,
    extra:{name:"GatewayWalletBatched" as const,version:"1" as const,verifyingContract:profile.gatewayWallet.toLowerCase()}};
  const original={sessionId:f.p.ownerAddr,sessAddr:f.p.sessAddr,reqId,grantEpoch:epoch,sourceId:"source",kind:"fetch" as const,expectedNonce:nonce,
    browserAuthorizationProtocol:"durable-v1" as const,requirements};
  const question={id:reqId,budgetMicroUsdc:"10"};
  await f.state.reserve(context.storageNamespace,epoch,nonce,BigInt(10),BigInt(10),question,original);
  await f.state.retainHeader(nonce,"synthetic-original-payment-header");
  const local={nonce,epoch,amount:"10",original,requirementsDigest:createHash("sha256").update(canonicalJson(requirements)).digest("hex")};
  const journal={nonce,sessionId:f.p.ownerAddr,signer:f.p.sessAddr,requestId:reqId,grantEpoch:epoch,phase:"failed",requirements,signedHeaderHash:"55".repeat(32),
    payment:{authorizationId:nonce,payer:f.p.sessAddr,payee:requirements.payTo,network:profile.networkId,sourceId:"source",kind:"fetch",amountUsdc:0.00001,
      settled:false,settlementStatus:"failed",txHash:"synthetic-circle-terminal-failure"}};
  const page=(payments:unknown[])=>({network:profile.networkId,sessAddr:f.p.sessAddr,retryAuthorized:false,payments,nextCursor:null});
  return {...f,directory,local,journal,page,question,original};
}

it("releases exact failed lifetime capacity once across reload/epochs while keeping nonce, header and question ceiling",async()=>{
  const f=await fixture(),nonce=`0x${"66".repeat(32)}`,nextEpoch="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const candidate={...f.original,grantEpoch:nextEpoch,expectedNonce:nonce};
  const nextQuestion={...f.question,id:nextEpoch};
  await expect(f.state.reserve(context.storageNamespace,nextEpoch,nonce,BigInt(10),BigInt(10),nextQuestion,candidate)).rejects.toThrow();
  const witness=(await readBrowserSessionPaymentAccounting([f.local],f.p.ownerAddr,f.p.sessAddr,f.p.grantEpoch,async()=>f.page([f.journal]))).failures[0];
  expect(witness).toBeDefined();
  expect(f.state.recordFailed(witness)).toBe(true);expect(f.state.recordFailed(witness)).toBe(false);
  expect(()=>f.state.recordFailed({...witness,transferId:"unrelated-transfer"})).toThrow();
  expect(()=>f.state.recordSettled(f.local.nonce,"a".repeat(64))).toThrow();
  f.key.lock();f.state.close();
  const reopened=await openHeadlessMainnetState(f.directory,context,wrapping,false);closers.push(()=>reopened.close());
  expect(reopened.originalNonces()).toHaveLength(1);expect(reopened.unresolvedNonces()).toHaveLength(0);
  await expect(reopened.reserve(context.storageNamespace,nextEpoch,nonce,BigInt(10),BigInt(10),f.question,candidate)).rejects.toThrow();
  await expect(reopened.reserve(context.storageNamespace,nextEpoch,f.local.nonce,BigInt(10),BigInt(10),nextQuestion,{...candidate,expectedNonce:f.local.nonce})).rejects.toThrow();
  await reopened.reserve(context.storageNamespace,nextEpoch,nonce,BigInt(10),BigInt(10),nextQuestion,candidate);
  const native=new DatabaseSync(reopened.file,{readOnly:true});
  expect(native.prepare("SELECT count(*) AS n FROM headers").get()!.n).toBe(1);
  expect(native.prepare("SELECT count(*) AS n FROM failed_terminal").get()!.n).toBe(1);
  expect(native.prepare("SELECT count(*) AS n FROM terminal").get()!.n).toBe(0);native.close();
});

it("retains pending, empty, mismatched and unavailable observations; reconciles an original older epoch only from exact failed evidence",async()=>{
  const f=await fixture(),paths:string[]=[];
  for(const rows of [[],[{...f.journal,phase:"submission_attempted"}],
    [{...f.journal,payment:{...f.journal.payment,amountUsdc:0.000009}}]]) {
    expect(await reconcileHeadlessFailures(f.state,f.p.ownerAddr,f.p.sessAddr,async()=>f.page(rows))).toBe(0);
    expect(f.state.unresolvedNonces()).toHaveLength(1);
  }
  await expect(reconcileHeadlessFailures(f.state,f.p.ownerAddr,f.p.sessAddr,async()=>{throw new Error("offline");})).rejects.toThrow("offline");
  expect(await reconcileHeadlessFailures(f.state,f.p.ownerAddr,f.p.sessAddr,async path=>{paths.push(path);return f.page([f.journal]);})).toBe(1);
  expect(paths[0]).toContain(`grantEpoch=${f.p.grantEpoch}`);
  expect(await reconcileHeadlessFailures(f.state,f.p.ownerAddr,f.p.sessAddr,async()=>{throw new Error("already recorded");})).toBe(0);
  expect(f.state.originalNonces()).toHaveLength(1);
});
