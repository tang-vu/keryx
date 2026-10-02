import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach,expect,it,vi } from "vitest";
import { recoverTypedDataAddress,type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";
import { privateHeadlessTestDirectory } from "./headless-state-test-fixture";
import { headlessCashoutFixture,headlessCashoutCompletion,testHeadlessContext as context,testHeadlessWrapping as wrapping } from "./headless-cashout-test-fixture";
import { createBrowserSessionKey } from "../../lib/session/browser-session-key";
import { runHeadlessCashout } from "./headless-mainnet-cashout.mjs";

const roots:string[]=[],closers:Array<()=>void>=[];
afterEach(()=>{for(const close of closers.splice(0))close();for(const root of roots.splice(0)){if(!path.resolve(root).startsWith(path.join(os.tmpdir(),"keryx-headless-state-")))throw new Error("Unexpected fixture cleanup path");fs.rmSync(root,{recursive:true,force:true});}vi.restoreAllMocks();});
function directory(){const root=privateHeadlessTestDirectory();roots.push(root);return root;}
async function fixture(dir:string){const f=await headlessCashoutFixture(dir);closers.push(()=>{f.key.lock();f.state.close();});return f;}
function payment(p:Awaited<ReturnType<typeof headlessCashoutFixture>>["p"]){const nonce=`0x${"88".repeat(32)}`,question={id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",budgetMicroUsdc:"10000"};
  return{nonce,question,original:{sessionId:p.ownerAddr,sessAddr:p.sessAddr,grantEpoch:p.grantEpoch,reqId:question.id,sourceId:"original",kind:"fetch" as const,expectedNonce:nonce,browserAuthorizationProtocol:"durable-v1" as const,
    requirements:{scheme:"exact" as const,network:profile.networkId,asset:profile.usdcAddress.toLowerCase(),payTo:p.ownerAddr,amount:"1000",maxTimeoutSeconds:604900,
      extra:{name:"GatewayWalletBatched" as const,version:"1" as const,verifyingContract:profile.gatewayWallet.toLowerCase()}}}};}

it("explicit v2 upgrade keeps first cipher, original headers/caps/nonces and fences the actual former writer before custody crypto",async()=>{
  const dir=directory(),f=await fixture(dir),pay=payment(f.p),file=f.state.file;
  await f.state.reserve(context.storageNamespace,f.p.grantEpoch,pay.nonce,BigInt(1000),BigInt(1000000),pay.question,pay.original);
  await f.state.retainHeader(pay.nonce,"synthetic-original-signed-payment");f.key.lock();f.state.close();
  const db=new DatabaseSync(file);
  db.exec("DROP TRIGGER exposure_withdrawal_fence;DROP TABLE withdrawals;DROP TABLE upgrade_history;DROP TRIGGER identity_no_update;");
  db.prepare("UPDATE identity SET value=? WHERE singleton=1").run(JSON.stringify({custody:context,format:"keryx-headless-session-state-v2"}));
  // Match the old writer's canonical identity exactly.
  const {canonicalJson}=await import("../../lib/canonical-json");
  db.prepare("UPDATE identity SET value=? WHERE singleton=1").run(canonicalJson({format:"keryx-headless-session-state-v2",custody:context}));
  db.exec("CREATE TRIGGER identity_no_update BEFORE UPDATE ON identity BEGIN SELECT RAISE(ABORT,'immutable'); END;");
  const tables=["custody","questions","exposure","headers","terminal"],before=tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all());db.close();
  const unchanged=fs.readFileSync(file);
  await expect(openHeadlessMainnetState(dir,context,wrapping,false)).rejects.toThrow("owner recovery");expect(fs.readFileSync(file)).toEqual(unchanged);
  const artifacts=path.resolve(".artifacts"),legacy=path.join(artifacts,"legacy-headless-v2.mts");fs.mkdirSync(artifacts,{recursive:true});
  // Exact archived v2 source from f420250; reproducible even in a shallow checkout.
  const old=fs.readFileSync(new URL("../fixtures/headless-mainnet-state-v2.mts.txt",import.meta.url),"utf8").replaceAll("\r\n","\n");
  expect(createHash("sha256").update(old).digest("hex")).toBe("ae55fac949df22e555e78a72ffa0dc1bf571e2142cc5a687c25393ef3ab0160d");
  fs.writeFileSync(legacy,old.replaceAll("../../lib/","../lib/"));
  const script=`import {openHeadlessMainnetState} from ${JSON.stringify(pathToFileURL(legacy).href)};import{ARC_MAINNET_PROFILE}from './lib/arc-network-profile.ts';import{browserSessionCustodyContext}from './lib/session/browser-session-custody.ts';try{const state=await openHeadlessMainnetState(process.env.STATE, browserSessionCustodyContext(ARC_MAINNET_PROFILE,'https://keryx.cc',process.env.OWNER),process.env.WRAP,false);state.close();console.log('old-writer-opened')}catch{console.log('old-writer-refused')}`;
  const invokeOld=()=>execFileSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{encoding:"utf8",windowsHide:true,timeout:15000,
    env:{...process.env,KERYX_NETWORK:"arc",NEXT_PUBLIC_KERYX_NETWORK:"arc",STATE:dir,OWNER:context.owner,WRAP:wrapping}});
  try{
    expect(invokeOld()).toContain("old-writer-opened");
    const upgraded=await openHeadlessMainnetState(dir,context,wrapping,false,true);
    closers.push(()=>upgraded.close());
    const key=createBrowserSessionKey(context.origin,context.owner,upgraded);await key.restore();expect(key.address?.toLowerCase()).toBe(f.p.sessAddr);
    const inspect=new DatabaseSync(file,{readOnly:true});expect(tables.map(t=>inspect.prepare(`SELECT * FROM ${t}`).all())).toEqual(before);inspect.close();key.lock();upgraded.close();
    const originalV3=fs.readFileSync(file);
    expect(invokeOld()).toContain("old-writer-refused");
    expect(fs.readFileSync(file)).toEqual(originalV3);
  }finally{fs.unlinkSync(legacy);}
},30000);

it("payment admission and never-exposed cancellation share the native barrier; originals remain immutable",async()=>{
  const f=await fixture(directory()),pay=payment(f.p),ns=context.storageNamespace,s=f.state.withdrawals.storage;
  const snapshot=await s.readExposure(ns);
  await f.state.reserve(ns,f.p.grantEpoch,pay.nonce,BigInt(1000),BigInt(1000000),pay.question,pay.original);
  await expect(s.reserveWithdrawal(ns,f.p,snapshot.version)).rejects.toThrow();
  await s.reserveWithdrawal(ns,f.p,(await s.readExposure(ns)).version);
  await expect(f.state.reserve(ns,f.p.grantEpoch,`0x${"99".repeat(32)}`,BigInt(1000),BigInt(1000000),pay.question,{...pay.original,expectedNonce:`0x${"99".repeat(32)}`})).rejects.toThrow();
  await s.cancelUnexposed(ns,f.p);expect(f.state.withdrawals.activeWithdrawal()).toBeNull();
  await expect(s.reserveWithdrawal(ns,f.p,(await s.readExposure(ns)).version)).rejects.toThrow();
  expect(f.state.originalNonces()).toHaveLength(1);expect(f.state.withdrawals.references()[0].cancelled).toBe(true);f.key.lock();f.state.close();
});

it("expired/revoked recovery retains a lost burn submission, original unsigned Mint nonce/fees and manual hash before exact completion",async()=>{
  const dir=directory(),f=await fixture(dir),ns=context.storageNamespace;
  let phase="prepared",submits=0,crypto=0,completion:unknown=null,mintReads=0;
  const countedKey={context:f.key.context,get address(){return f.key.address;},async signWithdrawalPreparation(value:unknown){crypto++;return f.key.signWithdrawalPreparation(value);}};
  const json=async(url:string,method?:string,body?:unknown):Promise<unknown>=>{
    if(url.includes("/credit?"))return{status:"known",network:profile.networkId,address:f.p.sessAddr,available:"1000000"};
    if(url.includes("/withdraw/payments?"))return{network:profile.networkId,sessAddr:f.p.sessAddr,retryAuthorized:false,payments:[],nextCursor:null};
    if(url==="/api/session/withdraw/authorize"){phase="exposed";}
    if(url==="/api/session/withdraw/submit"){submits++;const signature=(body as {signature:Hex}).signature;
      expect((await recoverTypedDataAddress({...withdrawTypedData(f.p.burnIntent),signature})).toLowerCase()).toBe(f.p.sessAddr);throw new Error("lost-original-submit-response");}
    if(url==="/api/session/withdraw/complete"){expect(f.state.withdrawals.references()[0].mintHash).toBe((body as {transactionHash:string}).transactionHash);phase="completed";}
    return{preparation:f.p,signingPhase:phase,cancellation:null,progress:{status:phase==="completed"?"mint-finalized-observed":"prepared",retryAuthorized:false,chainFinalityVerified:phase==="completed"},attestation:null,mint:null,completion};
  };
  await f.state.withdrawals.storage.reserveWithdrawal(ns,f.p,(await f.state.withdrawals.storage.readExposure(ns)).version);
  await expect(f.key.signGrantConsentProof(f.p.authorization.consent,f.p.authorization.ownerSignature as Hex)).rejects.toThrow();
  const ports={chain:async()=>{},completion:async()=>{return {} as never;},prepareMint:async()=>{mintReads++;return(handOff!.mint);}};
  let handOff:Awaited<ReturnType<typeof headlessCashoutCompletion>>|undefined;
  await runHeadlessCashout(["withdraw-sign",f.p.requestId,"500000","1000"],countedKey,f.state,json,ports);
  expect(crypto).toBe(1);const signature=(await f.state.withdrawals.storage.readWithdrawal(ns,f.p.requestId))!.signature!;
  expect(fs.readFileSync(f.state.file).toString()).not.toContain(signature);
  await expect(runHeadlessCashout(["withdraw-submit",f.p.requestId],f.key,f.state,json,ports)).rejects.toThrow("lost-original");
  await expect(runHeadlessCashout(["withdraw-cancel",f.p.requestId],f.key,f.state,json,ports)).rejects.toThrow();
  handOff=await headlessCashoutCompletion(f.p,signature as Hex);completion=handOff.completion;
  const first=await runHeadlessCashout(["withdraw-mint",f.p.requestId],f.key,f.state,json,ports);f.key.lock();f.state.close();
  const reopened=await openHeadlessMainnetState(dir,context,wrapping,false),restored=createBrowserSessionKey(context.origin,context.owner,reopened);await restored.restore();
  closers.push(()=>{restored.lock();reopened.close();});
  await expect(runHeadlessCashout(["withdraw-submit",f.p.requestId],restored,reopened,json,ports)).rejects.toThrow();
  const again=await runHeadlessCashout(["withdraw-mint",f.p.requestId],restored,reopened,json,ports);
  expect((again as {transaction:unknown}).transaction).toEqual((first as {transaction:unknown}).transaction);expect(mintReads).toBe(1);expect(submits).toBe(1);
  // The completion callback checks the newly reopened original hash before the server can finalize.
  const completionJson=async(url:string,method?:string,body?:unknown)=>{if(url==="/api/session/withdraw/complete"){
    expect(reopened.withdrawals.references()[0].mintHash).toBe((body as {transactionHash:string}).transactionHash);phase="completed";
    return{ok:true};}return json(url,method,body);};
  await runHeadlessCashout(["withdraw-complete",f.p.requestId,handOff.hash],restored,reopened,completionJson,ports);
  expect(reopened.withdrawals.activeWithdrawal()).toBeNull();expect(reopened.withdrawals.references()[0]).toMatchObject({completed:true,mintHash:handOff.hash});
  const inspect=new DatabaseSync(reopened.file);expect(()=>inspect.prepare("UPDATE withdrawals SET value=json_set(value,'$.mint.value','1')").run()).toThrow("immutable");inspect.close();
  restored.lock();reopened.close();
},30000);
