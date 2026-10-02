import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { parseTransaction } from "viem";
import { canonicalJson } from "../canonical-json";
import { storageIdentityDigest } from "../db/storage-identity";
import type { FundingTerminalEvidence,VerifiedFundingTerminalObservation } from "../db/gateway-funding-ledger-types";
import { gatewayFundingReplayDigest,validateGatewayFundingOperation } from "./gateway-funding-policy";
import { validatePreparedGatewayFundingTransaction,validateSignedGatewayFundingTransaction,
  type SignedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { GATEWAY_FUNDING_RECEIPT_POLICY as policy,GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST as policyDigest,
  GATEWAY_FUNDING_RECEIPT_RPC_METHODS,assertGatewayFundingReceiptPolicy } from "./gateway-funding-receipt-policy";

export interface GatewayFundingReceiptRequest {
  readonly operation: unknown;
  readonly prepared: Readonly<SignedGatewayFundingTransaction>;
  readonly cryptoClaimId: string;
  readonly broadcastClaimId: string;
  readonly finalityPolicyDigest: string;
}
const issued = new WeakMap<object,Readonly<FundingTerminalEvidence>>();
const capturedFetch = globalThis.fetch.bind(globalThis);
const monotonicNow = performance.now.bind(performance);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function refuse(): never { throw new Error("Funding receipt observation refused"); }
function guard(check:()=>void) { if(typeof check !== "function" || check() !== undefined) refuse(); }
function object(value:unknown,keys?:readonly string[]):Record<string,unknown> {
  if(!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length) refuse();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Object.values(descriptors).some(d=>!d.enumerable || !("value" in d))) refuse();
  if(keys && Object.keys(descriptors).sort().join(",") !== [...keys].sort().join(",")) refuse();
  return Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,d.value]));
}
function quantity(value:unknown):bigint {
  if(typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value)) refuse();
  return BigInt(value);
}
function hash(value:unknown):string { if(typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) refuse(); return value; }
function signatureInteger(value:unknown):bigint {
  if(typeof value!=="string" || !/^0x[0-9a-f]{1,64}$/.test(value))refuse();return BigInt(value);
}
function hexHeight(value:bigint) { return `0x${value.toString(16)}`; }
function digest(value:unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function input(value:GatewayFundingReceiptRequest) {
  const r=object(value,["operation","prepared","cryptoClaimId","broadcastClaimId","finalityPolicyDigest"]);
  assertGatewayFundingReceiptPolicy(r.finalityPolicyDigest);
  if(typeof r.cryptoClaimId !== "string" || !UUID.test(r.cryptoClaimId)
    || typeof r.broadcastClaimId !== "string" || !UUID.test(r.broadcastClaimId)) refuse();
  const operation=validateGatewayFundingOperation(r.operation);
  const p=object(r.prepared,["format","transaction","rawTransaction","transactionHash"]);
  if(p.format !== "gateway-funding-signed-transaction-v1") refuse();
  const t=object(p.transaction);
  const step=t.step as SignedGatewayFundingTransaction["transaction"]["step"];
  const transaction=validatePreparedGatewayFundingTransaction(operation,step,t.nonce as string,t);
  if(typeof p.rawTransaction !== "string" || p.rawTransaction.length>4098 || !/^0x02(?:[0-9a-f]{2})+$/.test(p.rawTransaction)) refuse();
  const prepared=Object.freeze({format:"gateway-funding-signed-transaction-v1" as const,transaction,
    rawTransaction:p.rawTransaction as `0x${string}`,transactionHash:hash(p.transactionHash) as `0x${string}`});
  return {operation,prepared,cryptoClaimId:r.cryptoClaimId,broadcastClaimId:r.broadcastClaimId};
}
interface Block { number:bigint;hash:string;timestamp:bigint;transactions:string[] }
function block(value:unknown):Block {
  const b=object(value);
  if(!Array.isArray(b.transactions) || b.transactions.length>policy.maximumBlockTransactions) refuse();
  return {number:quantity(b.number),hash:hash(b.hash),timestamp:quantity(b.timestamp),transactions:b.transactions.map(hash)};
}
function matchTransaction(value:unknown,p:Readonly<SignedGatewayFundingTransaction>) {
  const t=object(value),e=p.transaction,s=parseTransaction(p.rawTransaction);
  if(t.hash !== p.transactionHash || t.from !== e.sender || t.to !== e.to || t.input !== e.data
    || quantity(t.type)!==BigInt(2) || quantity(t.chainId)!==BigInt(e.chainId) || quantity(t.nonce)!==BigInt(e.nonce)
    || quantity(t.value)!==BigInt(e.valueWei) || quantity(t.gas)!==BigInt(e.gas)
    || quantity(t.maxFeePerGas)!==BigInt(e.maxFeePerGasWei) || quantity(t.maxPriorityFeePerGas)!==BigInt(e.maxPriorityFeePerGasWei)
    || !Array.isArray(t.accessList) || t.accessList.length!==0 || signatureInteger(t.r)!==BigInt(s.r!) || signatureInteger(t.s)!==BigInt(s.s!)
    || quantity(t.yParity ?? t.v)!==BigInt(s.yParity!)) refuse();
  return {blockNumber:quantity(t.blockNumber).toString(),blockHash:hash(t.blockHash),transactionIndex:quantity(t.transactionIndex).toString()};
}
function receipt(value:unknown,p:Readonly<SignedGatewayFundingTransaction>) {
  const r=object(value),t=p.transaction,status=quantity(r.status),gas=quantity(r.gasUsed),price=quantity(r.effectiveGasPrice);
  if(r.transactionHash!==p.transactionHash || r.from!==t.sender || r.to!==t.to || quantity(r.type)!==BigInt(2)
    || ![BigInt(0),BigInt(1)].includes(status) || gas===BigInt(0) || gas>BigInt(t.gas) || price>BigInt(t.maxFeePerGasWei)
    || quantity(r.transactionIndex)>=BigInt(policy.maximumBlockTransactions)) refuse();
  return {blockNumber:quantity(r.blockNumber).toString(),blockHash:hash(r.blockHash),transactionIndex:quantity(r.transactionIndex).toString(),
    receiptStatus:status===BigInt(1) ? "success" as const : "reverted" as const,gasUsed:gas.toString(),effectiveGasPriceWei:price.toString()};
}
function included(b:Block,r:ReturnType<typeof receipt>,transactionHash:string) {
  if(b.number!==BigInt(r.blockNumber) || b.hash!==r.blockHash || b.transactions[Number(r.transactionIndex)]!==transactionHash
    || b.transactions.filter(h=>h===transactionHash).length!==1) refuse();
}

/** Trusted host composition only, never request input or arbitrary RPC clients.
 * Production entrypoint below captures fetch and fixed origins. Synthetic tests
 * may provide controlled fetch/anchor time and lower-only deadlines; elapsed
 * time always uses captured native performance.now. Host-code compromise is outside
 * this managed-provider evidence boundary. */
export function createGatewayFundingReceiptObserverForTrustedComposition(fetchRead:typeof fetch,nowMs:()=>number=Date.now,
  limits?:Readonly<{totalDeadlineMs:number;requestDeadlineMs:number}>) {
  let totalDeadlineMs:number=policy.totalDeadlineMs,requestDeadlineMs:number=policy.requestDeadlineMs;
  if(limits) {
    const l=object(limits,["totalDeadlineMs","requestDeadlineMs"]);
    const bounded=(value:unknown,maximum:number)=>{if(typeof value!=="number" || !Number.isSafeInteger(value) || value<=0 || value>maximum)refuse();};
    bounded(l.totalDeadlineMs,policy.totalDeadlineMs);bounded(l.requestDeadlineMs,policy.requestDeadlineMs);
    totalDeadlineMs=l.totalDeadlineMs as number;requestDeadlineMs=l.requestDeadlineMs as number;
  }
  return async(request:GatewayFundingReceiptRequest,assertCurrentAuthority:()=>void):Promise<VerifiedFundingTerminalObservation|null>=>{
    const stop=new AbortController();let expired=false;
    const started=monotonicNow(),timer=setTimeout(()=>{expired=true;stop.abort();},totalDeadlineMs);
    const live=()=>{const elapsed=monotonicNow()-started;
      if(expired || stop.signal.aborted || !Number.isFinite(elapsed) || elapsed<0 || elapsed>=totalDeadlineMs) refuse();};
    const authority=()=>{live();guard(assertCurrentAuthority);live();};
    const fresh=(b:Block)=>{
      const now=nowMs();if(!Number.isSafeInteger(now) || now<0) refuse();
      const age=BigInt(now)-b.timestamp*BigInt(1000);
      if(age>BigInt(policy.maximumAnchorAgeMs) || age<BigInt(-policy.maximumFutureSkewMs)) refuse();
      return new Date(now).toISOString();
    };
    let id=0;
    const rpc=async(endpoint:string,method:string,params:unknown[]):Promise<unknown>=>{
      live();if(![policy.primary,policy.secondary].includes(endpoint as typeof policy.primary)
        || !GATEWAY_FUNDING_RECEIPT_RPC_METHODS.includes(method as typeof GATEWAY_FUNDING_RECEIPT_RPC_METHODS[number])) refuse();
      const requestStarted=monotonicNow(),signal=AbortSignal.any([stop.signal,AbortSignal.timeout(requestDeadlineMs)]),requestId=++id;
      const requestLive=()=>{live();const elapsed=monotonicNow()-requestStarted;
        if(signal.aborted || !Number.isFinite(elapsed) || elapsed<0 || elapsed>=requestDeadlineMs)refuse();};
      const pending=(async()=>{
        const init:RequestInit={method:"POST",redirect:"error",credentials:"omit",cache:"no-store",signal,
          headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:requestId,method,params})};
        requestLive();const response=await fetchRead(endpoint,init);
        requestLive();if(!response.ok || response.redirected || !response.body) refuse();
        const length=response.headers.get("content-length");
        if(length!==null && (!/^[0-9]{1,12}$/.test(length) || Number(length)>policy.maximumResponseBytes))refuse();
        const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
        try { while(true) { const next=await reader.read();requestLive();if(next.done)break;
          bytes+=next.value.byteLength;if(bytes>policy.maximumResponseBytes)refuse();chunks.push(next.value); }
        } finally { await reader.cancel().catch(()=>{}); }
        const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
        const result=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(joined)));
        if(result.jsonrpc!=="2.0" || result.id!==requestId || Object.hasOwn(result,"error") || !Object.hasOwn(result,"result"))refuse();
        requestLive();return result.result;
      })();
      // Abort-ignoring test/host transports must not extend the evidence deadline.
      let cancel!:()=>void;const cancelled=new Promise<never>((_,reject)=>{cancel=()=>reject(new Error("Funding receipt unavailable"));});
      signal.addEventListener("abort",cancel,{once:true});
      try { if(signal.aborted)cancel();return await Promise.race([pending,cancelled]); }
      finally { signal.removeEventListener("abort",cancel); }
    };
    const endpoints=[policy.primary,policy.secondary];
    try {
      authority();const copy=input(request),p=copy.prepared,t=p.transaction;
      await validateSignedGatewayFundingTransaction(copy.operation,t.step,t.nonce,
        {rawTransaction:p.rawTransaction,transactionHash:p.transactionHash},authority);live();
      const chains=await Promise.all(endpoints.map(e=>rpc(e,"eth_chainId",[])));if(chains.some(c=>quantity(c)!==BigInt(policy.chainId)))refuse();
      const samples=await Promise.all(endpoints.map(async e=>{
        const tx=matchTransaction(await rpc(e,"eth_getTransactionByHash",[p.transactionHash]),p);
        const r=receipt(await rpc(e,"eth_getTransactionReceipt",[p.transactionHash]),p);
        if(canonicalJson(tx)!==canonicalJson({blockNumber:r.blockNumber,blockHash:r.blockHash,transactionIndex:r.transactionIndex}))refuse();
        const b=block(await rpc(e,"eth_getBlockByNumber",[hexHeight(BigInt(r.blockNumber)),false]));included(b,r,p.transactionHash);
        const f=block(await rpc(e,"eth_getBlockByNumber",["finalized",false]));fresh(f);
        if(f.number<b.number || f.timestamp<b.timestamp)refuse();return {r,b,f};
      }));
      if(canonicalJson(samples[0].r)!==canonicalJson(samples[1].r) || samples[0].b.hash!==samples[1].b.hash
        || samples[0].b.timestamp!==samples[1].b.timestamp)refuse();
      const height=samples[0].f.number<samples[1].f.number ? samples[0].f.number : samples[1].f.number;
      const anchors=await Promise.all(endpoints.map(e=>rpc(e,"eth_getBlockByNumber",[hexHeight(height),false]).then(block)));
      for(const [i,a] of anchors.entries())if(a.number!==height || a.number<samples[0].b.number || a.timestamp<samples[0].b.timestamp
        || height===samples[i].f.number && (a.hash!==samples[i].f.hash || a.timestamp!==samples[i].f.timestamp)
        || height===samples[i].b.number && a.hash!==samples[i].b.hash)refuse();
      if(anchors[0].hash!==anchors[1].hash || anchors[0].timestamp!==anchors[1].timestamp)refuse();
      fresh(anchors[0]);
      await Promise.all(endpoints.map(async(e,i)=>{
        const tx=matchTransaction(await rpc(e,"eth_getTransactionByHash",[p.transactionHash]),p);
        const r=receipt(await rpc(e,"eth_getTransactionReceipt",[p.transactionHash]),p);
        if(canonicalJson(r)!==canonicalJson(samples[i].r) || tx.blockHash!==r.blockHash || tx.blockNumber!==r.blockNumber || tx.transactionIndex!==r.transactionIndex)refuse();
        const b=block(await rpc(e,"eth_getBlockByNumber",[hexHeight(BigInt(r.blockNumber)),false]));included(b,r,p.transactionHash);
        if(b.timestamp!==samples[i].b.timestamp)refuse();
        const a=block(await rpc(e,"eth_getBlockByNumber",[hexHeight(height),false]));
        if(a.number!==height || a.hash!==anchors[i].hash || a.timestamp!==anchors[i].timestamp)refuse();fresh(a);
        if(quantity(await rpc(e,"eth_chainId",[]))!==BigInt(policy.chainId))refuse();
      }));
      authority();
      const r=samples[0].r,identity=copy.operation.policy.identity;
      const evidence:Readonly<FundingTerminalEvidence>=Object.freeze({format:"gateway-funding-terminal-evidence-v1",identity,
        identityDigest:storageIdentityDigest(identity),operationDigest:gatewayFundingReplayDigest(copy.operation),operationId:copy.operation.operationId,
        step:t.step,transactionHash:p.transactionHash,cryptoClaimId:copy.cryptoClaimId,broadcastClaimId:copy.broadcastClaimId,prepared:p,
        sender:t.sender,nonce:t.nonce,chainId:"5042002",receiptStatus:r.receiptStatus,blockNumber:r.blockNumber,blockHash:r.blockHash,
        gasUsed:r.gasUsed,effectiveGasPriceWei:r.effectiveGasPriceWei,observedAt:fresh(anchors[0]),finalityPolicyDigest:policyDigest,
        finalizedBlockNumber:height.toString(),finalizedBlockHash:anchors[0].hash,
        providerEvidenceDigest:digest({policyDigest,providers:endpoints,receipt:r,inclusionHash:samples[0].b.hash,anchorHash:anchors[0].hash,anchorHeight:height.toString()})});
      const token=Object.freeze(Object.create(null)) as VerifiedFundingTerminalObservation;
      authority();live();issued.set(token,evidence);return token;
    } catch { return null; } finally {clearTimeout(timer);stop.abort();}
  };
}
export const observeGatewayFundingReceipt=createGatewayFundingReceiptObserverForTrustedComposition(capturedFetch);

/** Protected controller/backend boundary; a JSON object, cast or boolean cannot
 * produce terminal authority. Recheck current full binding at the caller too,
 * in the persistence transaction. Receipt success is execution, not credit. */
export function unsealVerifiedGatewayFundingReceipt(token:VerifiedFundingTerminalObservation,expected:GatewayFundingReceiptRequest,
  assertCurrentAuthority:()=>void):Readonly<FundingTerminalEvidence> {
  try {
    guard(assertCurrentAuthority);const evidence=issued.get(token);if(!evidence)refuse();const copy=input(expected);
    if(evidence.identityDigest!==storageIdentityDigest(copy.operation.policy.identity)
      || evidence.operationDigest!==gatewayFundingReplayDigest(copy.operation) || evidence.operationId!==copy.operation.operationId
      || evidence.cryptoClaimId!==copy.cryptoClaimId || evidence.broadcastClaimId!==copy.broadcastClaimId
      || evidence.finalityPolicyDigest!==expected.finalityPolicyDigest || canonicalJson(evidence.prepared)!==canonicalJson(copy.prepared))refuse();
    guard(assertCurrentAuthority);return Object.freeze({...evidence,identity:Object.freeze({...evidence.identity}),
      prepared:Object.freeze({...evidence.prepared,transaction:Object.freeze({...evidence.prepared.transaction})})});
  } catch {return refuse();}
}
