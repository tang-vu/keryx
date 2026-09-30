import { createHash,randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { keccak256,parseTransaction,serializeTransaction,type Hex } from "viem";
import { privateKeyToAccount,sign } from "viem/accounts";
import { canonicalJson } from "../canonical-json";
import { storageIdentityDigest,validateStorageIdentity,type StorageIdentity } from "../db/storage-identity";
import type { FundingReservationSnapshot,GatewayFundingLedger,GatewayFundingStep,GatewayFundingTerminalObserverStore } from "../db/gateway-funding-ledger-types";
import { validateFundingNamespace } from "../db/gateway-funding-ledger-validation";
import { gatewayFundingReplayDigest,validateGatewayFundingOperation,type GatewayFundingOperation } from "./gateway-funding-policy";
import { prepareGatewayFundingTransaction,validatePreparedGatewayFundingTransaction,validateSignedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { observeGatewayFundingReceipt,unsealVerifiedGatewayFundingReceipt,type GatewayFundingReceiptRequest } from "./gateway-funding-receipt-observer";
import { GATEWAY_FUNDING_RECEIPT_POLICY,GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";

const physicalFetch=globalThis.fetch.bind(globalThis);
const monotonicNow=performance.now.bind(performance);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const STEPS=["nativeTransfer","usdcTransfer","approval","deposit"] as const;
const DEADLINE_MS=30000,REQUEST_MS=5000,RESPONSE_BYTES=65536;
function refuse():never {throw new Error("Gateway funding execution refused; reconcile original attempt");}
function digest(value:unknown){return createHash("sha256").update(canonicalJson(value)).digest("hex");}
function record(value:unknown,allowed:readonly string[],required:readonly string[]=allowed):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length)refuse();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.keys(descriptors).some(key=>!allowed.includes(key)) || required.some(key=>!Object.hasOwn(descriptors,key))
    || Object.values(descriptors).some(d=>!d.enumerable || !("value" in d)))refuse();
  return Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,d.value]));
}
const BINDING_KEYS=["ledger","expectedIdentity","installedPolicyDigest","expectedBackendBindingDigest","finalityPolicyDigest","assertCurrentAuthority"];
function optionsShape(options:GatewayFundingExecutorBinding,keys:readonly string[]) {record(options,[...BINDING_KEYS,...keys]);}
export interface GatewayFundingExecutorBinding {
  readonly ledger:GatewayFundingLedger;
  readonly expectedIdentity:Readonly<StorageIdentity>;
  readonly installedPolicyDigest:string;
  readonly expectedBackendBindingDigest:string;
  readonly finalityPolicyDigest:string;
  /** Synchronous complete runtime/store binding. A Promise return refuses. */
  readonly assertCurrentAuthority:()=>void;
}
export interface GatewayFundingExecutorOptions extends GatewayFundingExecutorBinding {
  readonly funderPrivateKey:Hex;
  readonly spendPrivateKey:Hex;
}
export interface GatewayFundingReconcilerOptions extends GatewayFundingExecutorBinding {
  readonly terminalStore:GatewayFundingTerminalObserverStore;
}
export interface GatewayFundingExecutionResult {
  /** Execution/acknowledgement only. No Circle availability, allowance,
   * combined native/ERC20 solvency or four-step orchestration readiness. */
  readonly status:"broadcast-acknowledged"|"reconciliation-required"|"execution-success"|"execution-reverted"|"missing-reservation";
  readonly stage:string;
  readonly transactionHash?:string;
}
const result=(status:GatewayFundingExecutionResult["status"],stage:string,transactionHash?:string)=>Object.freeze({status,stage,...(transactionHash ? {transactionHash} : {})});
function target(operationId:string,step:GatewayFundingStep){if(!UUID.test(operationId) || !STEPS.includes(step))refuse();}
function binding(options:GatewayFundingExecutorBinding) {
  const identity=validateStorageIdentity(options.expectedIdentity),identityDigest=storageIdentityDigest(identity);
  const {ledger,assertCurrentAuthority,installedPolicyDigest,expectedBackendBindingDigest,finalityPolicyDigest}=options;
  if(identity.authorityMode!=="testnet-real" || !DIGEST.test(installedPolicyDigest) || !DIGEST.test(expectedBackendBindingDigest)
    || finalityPolicyDigest!==GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST || typeof assertCurrentAuthority!=="function")refuse();
  const check=()=>{if(assertCurrentAuthority()!==undefined || storageIdentityDigest(ledger.getStorageIdentity())!==identityDigest)refuse();};
  check();
  const admit=async(operationId:string,live:()=>void=check,readOnly=false)=>{
    live();const op=validateGatewayFundingOperation(await (readOnly ? ledger.inspectOperation(operationId) : ledger.admitOperation(operationId)));live();
    if(op.operationId!==operationId || storageIdentityDigest(op.policy.identity)!==identityDigest || digest(op.policy)!==installedPolicyDigest)refuse();
    const namespaces=(await Promise.all([ledger.inspectNamespace(op.policy.funder),ledger.inspectNamespace(op.policy.spend)]))
      .map(n=>validateFundingNamespace(n,identity,expectedBackendBindingDigest));live();
    for(const [i,n] of namespaces.entries())if(n.identityDigest!==identityDigest || n.chainId!=="5042002" || n.backendBindingDigest!==expectedBackendBindingDigest
      || n.finalityPolicyDigest!==finalityPolicyDigest || n.sender!==(i===0 ? op.policy.funder : op.policy.spend)
      || n.peer!==(i===0 ? op.policy.spend : op.policy.funder) || n.role!==(i===0 ? "funder" : "spend") || n.initialNonce!=="0")refuse();
    if(namespaces[0].historyDocumentDigest!==namespaces[1].historyDocumentDigest)refuse();
    if(namespaces[0].limits.nativeWei!==op.policy.lifetimeLimits.nativeWei || namespaces[0].limits.usdcMicros!==op.policy.lifetimeLimits.usdcMicros
      || namespaces[1].limits.depositMicros!==op.policy.lifetimeLimits.depositMicros
      || BigInt(namespaces[0].limits.gasWei)+BigInt(namespaces[1].limits.gasWei)>BigInt(op.policy.lifetimeLimits.gasWei))refuse();
    return {op,namespaces};
  };
  return {ledger,check,admit};
}
function lifetime(check:()=>void,deadlineMs=DEADLINE_MS) {
  const stop=new AbortController();let expired=false;
  const start=monotonicNow(),timer=setTimeout(()=>{expired=true;stop.abort();},deadlineMs);
  const elapsed=()=>{const duration=monotonicNow()-start;if(expired || stop.signal.aborted || !Number.isFinite(duration) || duration<0 || duration>=deadlineMs)refuse();};
  const live=()=>{elapsed();check();elapsed();}; // native work/guards may block timer delivery
  const bounded=async<T>(pending:Promise<T>):Promise<T>=>{
    let cancel!:()=>void;const denied=new Promise<never>((_,reject)=>{cancel=()=>reject(new Error("Funding acknowledgement unavailable"));});
    stop.signal.addEventListener("abort",cancel,{once:true});
    try {if(stop.signal.aborted)cancel();const value=await Promise.race([pending,denied]);live();return value;}
    finally {stop.signal.removeEventListener("abort",cancel);}
  };
  return {stop,live,bounded,close:()=>{clearTimeout(timer);stop.abort();}};
}
function saved(value:FundingReservationSnapshot|null,op:Readonly<GatewayFundingOperation>,step:GatewayFundingStep,nonce:string) {
  const r=record(value,["operation","transaction","state","cryptoClaimId","prepared","broadcastClaimId","terminal"],["operation","transaction","state"]);
  if(canonicalJson(validateGatewayFundingOperation(r.operation))!==canonicalJson(op))refuse();
  for(const key of ["cryptoClaimId","broadcastClaimId"])if(Object.hasOwn(r,key) && (typeof r[key]!=="string" || !UUID.test(r[key] as string)))refuse();
  if(r.prepared!==undefined) {
    const p=record(r.prepared,["format","transaction","rawTransaction","transactionHash"]);
    if(p.format!=="gateway-funding-signed-transaction-v1" || typeof p.rawTransaction!=="string" || p.rawTransaction.length>4098
      || !/^0x02(?:[0-9a-f]{2})+$/.test(p.rawTransaction) || typeof p.transactionHash!=="string" || !/^0x[0-9a-f]{64}$/.test(p.transactionHash))refuse();
    r.prepared=Object.freeze({...p,transaction:validatePreparedGatewayFundingTransaction(op,step,nonce,p.transaction)});
  }
  const transaction=validatePreparedGatewayFundingTransaction(op,step,nonce,r.transaction);
  return {...r,operation:op,transaction} as FundingReservationSnapshot;
}
/** One immutable RPC request. Captured native fetch is called synchronously after
 * final admission and exact own-body validation; no hook/delegate await follows.
 * Started native crypto/HTTP cannot be retroactively cancelled. */
async function rpc(endpoint:string,method:"eth_chainId"|"eth_sendRawTransaction",params:readonly string[],live:()=>void,signal:AbortSignal) {
  const body=JSON.stringify({jsonrpc:"2.0",id:1,method,params});
  if(body.length>8192 || method==="eth_chainId" && params.length!==0 || method==="eth_sendRawTransaction"
    && (params.length!==1 || !/^0x02(?:[0-9a-f]{2})+$/.test(params[0]) || params[0].length>4098))refuse();
  const requestStart=monotonicNow(),requestSignal=AbortSignal.any([signal,AbortSignal.timeout(REQUEST_MS)]);
  const requestLive=()=>{live();if(requestSignal.aborted || monotonicNow()-requestStart>=REQUEST_MS)refuse();};
  const init:RequestInit={method:"POST",redirect:"error",credentials:"omit",cache:"no-store",signal:requestSignal,
    headers:{"Content-Type":"application/json"},body};
  const originalBody=body;
  if(init.body!==originalBody || originalBody!==JSON.stringify({jsonrpc:"2.0",id:1,method,params}))refuse();
  requestLive();
  const pending=physicalFetch(endpoint,init); // actual physical boundary, no intermediary
  const response=await pending;requestLive();if(!response.ok || response.redirected || !response.body)refuse();
  const length=response.headers.get("content-length");if(length!==null && (!/^[0-9]{1,12}$/.test(length) || Number(length)>RESPONSE_BYTES))refuse();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let count=0;
  try {while(true){const next=await reader.read();requestLive();if(next.done)break;
    count+=next.value.length;if(count>RESPONSE_BYTES)refuse();chunks.push(next.value);}}
  finally {void reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(!value || value.jsonrpc!=="2.0" || value.id!==1 || Object.hasOwn(value,"error") || typeof value.result!=="string")refuse();requestLive();return value.result as string;
}
function executor(options:GatewayFundingExecutorOptions,endpoint:string,deadlineMs=DEADLINE_MS) {
  optionsShape(options,["funderPrivateKey","spendPrivateKey"]);
  for(const key of [options.funderPrivateKey,options.spendPrivateKey])if(typeof key!=="string" || !/^0x[0-9a-f]{64}$/.test(key))refuse();
  const b=binding(options),funderKey=options.funderPrivateKey,spendKey=options.spendPrivateKey;
  // Key derivation is factory-private. No account, arbitrary signature or wallet
  // action is exposed. Production keys require separate owner authorization.
  const funder=privateKeyToAccount(funderKey).address.toLowerCase(),spend=privateKeyToAccount(spendKey).address.toLowerCase();
  const attempts=new Map<string,Promise<Readonly<GatewayFundingExecutionResult>>>();
  function executeStep(operationId:string,step:GatewayFundingStep):Promise<Readonly<GatewayFundingExecutionResult>> {
    target(operationId,step);const key=`${operationId}:${step}`,prior=attempts.get(key);if(prior)return prior;
    const attempt=(async()=>{
      const life=lifetime(b.check,deadlineMs);let stage="admission",transactionHash:string|undefined;
      try {
        const {op,namespaces}=await life.bounded(b.admit(operationId,life.live));
        if(op.policy.funder!==funder || op.policy.spend!==spend)refuse();
        if(await life.bounded(b.ledger.inspectReservation(operationId,step)))return result("reconciliation-required","existing-original");
        const role=step==="nativeTransfer" || step==="usdcTransfer" ? 0 : 1,nonce=namespaces[role].nextNonce;
        if(nonce!==namespaces[role].nextCryptoNonce)refuse(); // no new gap beyond unresolved original
        const original=prepareGatewayFundingTransaction(op,step,nonce);
        stage="reservation";const reserved=saved(await life.bounded(b.ledger.reserveStep(operationId,step,nonce)),op,step,nonce);
        if(reserved.state!=="reserved" || reserved.cryptoClaimId || reserved.prepared || reserved.broadcastClaimId)refuse();
        stage="chain-before-claim";
        if(await life.bounded(rpc(endpoint,"eth_chainId",[],life.live,life.stop.signal))!=="0x4cef52")refuse();
        stage="crypto-claim";const cryptoClaimId=randomUUID();
        const claimed=await life.bounded(b.ledger.claimCrypto(operationId,step,cryptoClaimId));
        if(claimed.fresh!==true || claimed.claimId!==cryptoClaimId)refuse();
        const claimOriginal=saved(claimed.reservation,op,step,nonce);
        const readback=saved(await life.bounded(b.ledger.inspectReservation(operationId,step)),op,step,nonce);
        if(claimOriginal.state!=="crypto-claimed" || readback.state!=="crypto-claimed" || claimOriginal.cryptoClaimId!==cryptoClaimId
          || readback.cryptoClaimId!==cryptoClaimId || readback.prepared || readback.broadcastClaimId)refuse();
        stage="chain-before-crypto";
        if(await life.bounded(rpc(endpoint,"eth_chainId",[],life.live,life.stop.signal))!=="0x4cef52")refuse();
        const unsigned=parseTransaction(original.serializedUnsigned),hash=keccak256(original.serializedUnsigned);
        stage="crypto";life.live();
        // Installed viem sign invokes synchronous secp256k1 before returning its
        // Promise. No custom serializer, signer callback or await before crypto.
        const signature=await sign({hash,privateKey:role===0 ? funderKey : spendKey});
        const rawTransaction=serializeTransaction(unsigned,signature),localHash=keccak256(rawTransaction);
        const prepared=await life.bounded(validateSignedGatewayFundingTransaction(op,step,nonce,{rawTransaction,transactionHash:localHash},life.live));
        transactionHash=prepared.transactionHash;stage="persist-prepared";
        const persisted=saved(await life.bounded(b.ledger.savePrepared(operationId,step,cryptoClaimId,
          {rawTransaction:prepared.rawTransaction,transactionHash:prepared.transactionHash})),op,step,nonce);
        const exact=saved(await life.bounded(b.ledger.inspectReservation(operationId,step)),op,step,nonce);
        if(persisted.state!=="prepared" || exact.state!=="prepared" || persisted.cryptoClaimId!==cryptoClaimId || exact.cryptoClaimId!==cryptoClaimId
          || canonicalJson(persisted.prepared)!==canonicalJson(prepared) || canonicalJson(exact.prepared)!==canonicalJson(prepared))refuse();
        stage="broadcast-claim";const broadcastClaimId=randomUUID();
        const broadcast=await life.bounded(b.ledger.claimBroadcast(operationId,step,broadcastClaimId));
        if(broadcast.fresh!==true || broadcast.claimId!==broadcastClaimId)refuse();
        const broadcastOriginal=saved(broadcast.reservation,op,step,nonce),broadcastReadback=saved(await life.bounded(b.ledger.inspectReservation(operationId,step)),op,step,nonce);
        if(!["broadcast-claimed","pending"].includes(broadcastOriginal.state) || !["broadcast-claimed","pending"].includes(broadcastReadback.state)
          || broadcastOriginal.broadcastClaimId!==broadcastClaimId || broadcastReadback.broadcastClaimId!==broadcastClaimId
          || broadcastReadback.cryptoClaimId!==cryptoClaimId || canonicalJson(broadcastReadback.prepared)!==canonicalJson(prepared))refuse();
        stage="chain-before-send";
        if(await life.bounded(rpc(endpoint,"eth_chainId",[],life.live,life.stop.signal))!=="0x4cef52")refuse();
        await life.bounded(validateSignedGatewayFundingTransaction(op,step,nonce,{rawTransaction,transactionHash:localHash},life.live));
        stage="physical-send";const acknowledged=await life.bounded(rpc(endpoint,"eth_sendRawTransaction",[prepared.rawTransaction],life.live,life.stop.signal));
        if(acknowledged!==prepared.transactionHash)refuse();return result("broadcast-acknowledged",stage,transactionHash);
      }catch{return result("reconciliation-required",stage,transactionHash);}finally{life.close();}
    })();attempts.set(key,attempt);return attempt;
  }
  return Object.freeze({executeStep});
}
export function createGatewayFundingExecutor(options:GatewayFundingExecutorOptions) {
  try{return executor(options,GATEWAY_FUNDING_RECEIPT_POLICY.primary);}catch{return refuse();}
}
/** Explicit synthetic host composition: native local HTTP capture, never a
 * production endpoint override or arbitrary signer/fetch delegate. */
export function createGatewayFundingExecutorForTrustedSyntheticComposition(options:GatewayFundingExecutorOptions,endpoint:string,limits?:Readonly<{totalDeadlineMs:number}>) {
  try{const url=new URL(endpoint);if(url.protocol!=="http:" || url.hostname!=="127.0.0.1" || url.username || url.password || url.pathname!=="/" || url.search || url.hash)refuse();
    if(limits){record(limits,["totalDeadlineMs"]);if(!Number.isSafeInteger(limits.totalDeadlineMs) || limits.totalDeadlineMs<=0 || limits.totalDeadlineMs>DEADLINE_MS)refuse();}
    return executor(options,url.href,limits?.totalDeadlineMs ?? DEADLINE_MS);}catch{return refuse();}
}
function reconciler(options:GatewayFundingReconcilerOptions,observe:typeof observeGatewayFundingReceipt) {
  optionsShape(options,["terminalStore"]);
  const b=binding(options),store=options.terminalStore;
  return Object.freeze({reconcileStep:async(operationId:string,step:GatewayFundingStep):Promise<Readonly<GatewayFundingExecutionResult>>=>{
    target(operationId,step);const life=lifetime(b.check);let stage="keyless-admission",transactionHash:string|undefined;
    try {
      life.live();if(!await life.bounded(b.ledger.inspectOperation(operationId)))return result("missing-reservation",stage);
      const record=await life.bounded(b.ledger.inspectReservation(operationId,step));
      if(!record)return result("missing-reservation",stage);
      const {op}=await life.bounded(b.admit(operationId,life.live,true));
      const original=saved(record,op,step,record.transaction.nonce);transactionHash=original.prepared?.transactionHash;
      if(!original.prepared || !original.cryptoClaimId || !original.broadcastClaimId)return result("reconciliation-required","original-not-broadcast",transactionHash);
      if(original.terminal) {
        const terminal=original.terminal;
        if(terminal.format!=="gateway-funding-terminal-evidence-v1" || storageIdentityDigest(terminal.identity)!==storageIdentityDigest(op.policy.identity)
          || terminal.identityDigest!==storageIdentityDigest(op.policy.identity) || terminal.operationDigest!==gatewayFundingReplayDigest(op)
          || terminal.operationId!==operationId || terminal.step!==step || terminal.transactionHash!==transactionHash
          || terminal.cryptoClaimId!==original.cryptoClaimId || terminal.broadcastClaimId!==original.broadcastClaimId
          || terminal.finalityPolicyDigest!==options.finalityPolicyDigest || canonicalJson(terminal.prepared)!==canonicalJson(original.prepared)
          || terminal.sender!==original.transaction.sender || terminal.nonce!==original.transaction.nonce || terminal.chainId!=="5042002"
          || !["success","reverted"].includes(terminal.receiptStatus)
          || original.state!==(terminal.receiptStatus==="success" ? "finalized-success" : "finalized-reverted"))refuse();
        // Descriptive backend-validated stored evidence only: no new issuer token,
        // replacement observation, admission, signing or broadcast is created.
        const answer=result(terminal.receiptStatus==="success" ? "execution-success" : "execution-reverted","stored-original-terminal",transactionHash);
        life.live();return answer;
      }
      const request:GatewayFundingReceiptRequest={operation:op,prepared:original.prepared,cryptoClaimId:original.cryptoClaimId,
        broadcastClaimId:original.broadcastClaimId,finalityPolicyDigest:options.finalityPolicyDigest};
      stage="keyless-observation";const token=await life.bounded(observe(request,life.live));if(!token)return result("reconciliation-required",stage,transactionHash);
      const evidence=unsealVerifiedGatewayFundingReceipt(token,request,life.live);
      stage="protected-terminal";await life.bounded(store.appendVerifiedTerminalObservation(operationId,step,token));
      const final=await life.bounded(b.ledger.inspectReservation(operationId,step));
      if(!final?.terminal || canonicalJson(final.terminal)!==canonicalJson(evidence))refuse();
      return result(evidence.receiptStatus==="success" ? "execution-success" : "execution-reverted",stage,transactionHash);
    }catch{return result("reconciliation-required",stage,transactionHash);}finally{life.close();}
  }});
}
/** Recovery constructs no account and requires no private keys. */
export function createKeylessGatewayFundingReconciler(options:GatewayFundingReconcilerOptions) {return reconciler(options,observeGatewayFundingReceipt);}
/** Trusted synthetic observer composition only, outside production policy. */
export function createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition(options:GatewayFundingReconcilerOptions,observe:typeof observeGatewayFundingReceipt) {
  return reconciler(options,observe);
}
