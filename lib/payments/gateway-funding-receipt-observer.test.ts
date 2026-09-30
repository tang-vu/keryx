import { afterEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { parseTransaction,keccak256 } from "viem";
import { generatePrivateKey,privateKeyToAccount } from "viem/accounts";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import type { VerifiedFundingTerminalObservation } from "../db/gateway-funding-ledger-types";
import { prepareGatewayFundingTransaction,validateSignedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { GATEWAY_FUNDING_RECEIPT_POLICY as policy,GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST as policyDigest } from "./gateway-funding-receipt-policy";
import { createGatewayFundingReceiptObserverForTrustedComposition as compose,unsealVerifiedGatewayFundingReceipt as unseal,
  type GatewayFundingReceiptRequest } from "./gateway-funding-receipt-observer";

const q=(value:string|number)=>`0x${BigInt(value).toString(16)}`;
const inclusionHash=`0x${"a".repeat(64)}`,anchorHash=`0x${"b".repeat(64)}`,otherHash=`0x${"c".repeat(64)}`;
const now=1800000000000;
async function fixture() {
  const funder=privateKeyToAccount(generatePrivateKey()),spend=privateKeyToAccount(generatePrivateKey());
  const operation={format:"gateway-funding-operation-v1",policy:{format:"gateway-funding-policy-v1",identity:syntheticStorageIdentity("testnet-real"),
    policyId:randomUUID(),funder:funder.address.toLowerCase(),spend:spend.address.toLowerCase(),
    lifetimeLimits:{nativeWei:"500",usdcMicros:"1000",depositMicros:"1000",gasWei:"10000000"},maxTransactionGas:"120000",maxFeePerGasWei:"20"},
    operationId:randomUUID(),ownerAuthorizationId:randomUUID(),ownerAuthorizationDigest:"b".repeat(64),minimumAvailableMicros:"100",initialAvailableMicros:"0",
    nativeTransferWei:"50",usdcTransferMicros:"100",approvalMicros:"100",depositMicros:"100",
    gasLimits:{nativeTransfer:"21000",usdcTransfer:"60000",approval:"60000",deposit:"120000"},maxFeePerGasWei:"10",maxPriorityFeePerGasWei:"1"};
  const t=prepareGatewayFundingTransaction(operation,"deposit","7"),rawTransaction=await spend.signTransaction(parseTransaction(t.serializedUnsigned));
  const prepared=await validateSignedGatewayFundingTransaction(operation,"deposit","7",{rawTransaction,transactionHash:keccak256(rawTransaction)},()=>{});
  const signature=parseTransaction(rawTransaction);
  const request:GatewayFundingReceiptRequest={operation,prepared,cryptoClaimId:randomUUID(),broadcastClaimId:randomUUID(),finalityPolicyDigest:policyDigest};
  const transaction={hash:prepared.transactionHash,from:t.sender,to:t.to,input:t.data,type:"0x2",chainId:q(t.chainId),nonce:q(t.nonce),value:q(t.valueWei),
    gas:q(t.gas),maxFeePerGas:q(t.maxFeePerGasWei),maxPriorityFeePerGas:q(t.maxPriorityFeePerGasWei),accessList:[],r:signature.r,s:signature.s,
    yParity:q(signature.yParity!),blockNumber:"0xa",blockHash:inclusionHash,transactionIndex:"0x0"};
  const receipt={transactionHash:prepared.transactionHash,from:t.sender,to:t.to,type:"0x2",status:"0x1",gasUsed:"0x100",effectiveGasPrice:"0x2",
    blockNumber:"0xa",blockHash:inclusionHash,transactionIndex:"0x0"};
  const inclusion={number:"0xa",hash:inclusionHash,timestamp:q(now/1000-2),transactions:[prepared.transactionHash]};
  const anchor={number:"0xb",hash:anchorHash,timestamp:q(now/1000-1),transactions:[]};
  return {request,transaction,receipt,inclusion,anchor};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
type Hook=(value:unknown,method:string,params:unknown[],endpoint:string,count:number)=>unknown;
function provider(f:Fixture,hook?:Hook) {
  const counts=new Map<string,number>(),calls:{endpoint:string;method:string;options:RequestInit}[]=[];
  const fetchRead=vi.fn(async(endpoint:RequestInfo|URL,options?:RequestInit)=>{
    const url=String(endpoint),body=JSON.parse(options!.body as string),key=`${url}:${body.method}:${JSON.stringify(body.params)}`;
    const count=(counts.get(key)??0)+1;counts.set(key,count);calls.push({endpoint:url,method:body.method,options:options!});
    let result:unknown;
    switch(body.method) {
      case "eth_chainId":result=q(5042002);break;
      case "eth_getTransactionByHash":result=f.transaction;break;
      case "eth_getTransactionReceipt":result=f.receipt;break;
      case "eth_getBlockByNumber":result=body.params[0]==="0xa" ? f.inclusion : f.anchor;break;
      default:throw new Error("unexpected write");
    }
    result=hook ? hook(structuredClone(result),body.method,body.params,url,count) : result;
    return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result}),{headers:{"Content-Type":"application/json"}});
  }) as unknown as typeof fetch;
  return {fetchRead,calls};
}
afterEach(()=>vi.useRealTimers());
describe("corroborated managed-testnet funding receipt evidence",()=>{
  it.each(["0x1","0x0"])("issues opaque execution evidence for receipt status %s with actual signed original",async status=>{
    const f=await fixture();f.receipt.status=status;const p=provider(f),check=vi.fn(),token=await compose(p.fetchRead,()=>now)(f.request,check);
    expect(token).not.toBeNull();expect(JSON.stringify(token)).toBe("{}");
    const result=unseal(token!,f.request,check);
    expect(result.receiptStatus).toBe(status==="0x1" ? "success" : "reverted");expect(result.nonce).toBe("7");
    expect(result.gasUsed).toBe("256");expect(result.finalizedBlockNumber).toBe("11");expect(result.prepared).toEqual(f.request.prepared);
    expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.prepared.transaction)).toBe(true);
    expect(p.calls).toHaveLength(22);for(const call of p.calls){expect(call.options.redirect).toBe("error");expect(call.options.credentials).toBe("omit");
      expect([policy.primary,policy.secondary]).toContain(call.endpoint);expect(call.method).not.toMatch(/send|sign|write/);}
  });
  it("uses exact common lower finalized height when provider tips differ",async()=>{
    const f=await fixture(),p=provider(f,(value,method,params,endpoint)=>{
      if(method==="eth_getBlockByNumber" && params[0]==="finalized" && endpoint===policy.secondary)
        return {...value as object,number:"0xc",hash:otherHash};return value;
    });
    const token=await compose(p.fetchRead,()=>now)(f.request,()=>{});expect(unseal(token!,f.request,()=>{}).finalizedBlockHash).toBe(anchorHash);
  });
  it("accepts numerically identical unpadded RPC signature integers while local signed bytes stay canonical",async()=>{
    let f=await fixture();for(let attempt=0;attempt<128 && !f.transaction.s!.startsWith("0x0");attempt++)f=await fixture();
    expect(f.transaction.s!.startsWith("0x0")).toBe(true);
    f.transaction.r=`0x${f.transaction.r!.slice(2).replace(/^0+/,"")}` as typeof f.transaction.r;
    f.transaction.s=`0x${f.transaction.s!.slice(2).replace(/^0+/,"")}` as typeof f.transaction.s;
    const p=provider(f),token=await compose(p.fetchRead,()=>now)(f.request,()=>{});expect(token).not.toBeNull();
    expect(unseal(token!,f.request,()=>{}).prepared).toEqual(f.request.prepared);
  });
  it("rechecks authority after freshness/evidence construction immediately before issuance",async()=>{
    const f=await fixture(),p=provider(f);let enabled=true,reads=0;
    const clock=()=>{if(++reads===6)enabled=false;return now;};
    expect(await compose(p.fetchRead,clock)(f.request,()=>{if(!enabled)throw new Error();})).toBeNull();
    expect(reads).toBe(6);
  });
  it.each(["hash","from","to","input","nonce","value","gas","type","maxFeePerGas","maxPriorityFeePerGas","chainId","r","s","yParity","blockHash","blockNumber","transactionIndex","accessList"])("refuses mismatched canonical transaction %s",async key=>{
    const f=await fixture(),p=provider(f,(value,method)=>method==="eth_getTransactionByHash" ? {...value as object,[key]:key==="accessList" ? [{address:f.transaction.to,storageKeys:[]}] : key==="input" ? "0x" : key==="from" || key==="to" ? `0x${"dd".repeat(20)}` : key==="hash" || key==="r" || key==="s" || key==="blockHash" ? otherHash : "0x3"} : value);
    expect(await compose(p.fetchRead,()=>now)(f.request,()=>{})).toBeNull();
  });
  it.each(["missing","failed-status","gas-overflow","price-overflow","duplicate","stale","future","chain","anchor-disagreement","receipt-change","inclusion-reorg","anchor-reorg","finalized-reorg"])("keeps %s evidence unknown",async fault=>{
    const f=await fixture(),p=provider(f,(value,method,params,endpoint,count)=>{
      if(method==="eth_chainId" && fault==="chain" && count===2)return "0x1";
      if(method==="eth_getTransactionReceipt") {
        if(fault==="missing")return null;
        if(fault==="failed-status")return {...value as object,status:"0x2"};
        if(fault==="gas-overflow")return {...value as object,gasUsed:"0xffffff"};
        if(fault==="price-overflow")return {...value as object,effectiveGasPrice:"0xff"};
        if(fault==="receipt-change" && count===2)return {...value as object,status:"0x0"};
      }
      if(method==="eth_getBlockByNumber") {
        if(fault==="duplicate" && params[0]==="0xa")return {...value as object,transactions:[f.request.prepared.transactionHash,f.request.prepared.transactionHash]};
        if(fault==="stale" || fault==="future")return {...value as object,timestamp:q(now/1000+(fault==="stale" ? -61 : 6))};
        if(fault==="anchor-disagreement" && params[0]==="0xb" && endpoint===policy.secondary)return {...value as object,hash:otherHash};
        if(fault==="inclusion-reorg" && params[0]==="0xa" && count===2)return {...value as object,hash:otherHash};
        if(fault==="anchor-reorg" && params[0]==="0xb" && count===2)return {...value as object,hash:otherHash};
        if(fault==="finalized-reorg" && params[0]==="finalized")return {...value as object,hash:otherHash};
      }
      return value;
    });expect(await compose(p.fetchRead,()=>now)(f.request,()=>{})).toBeNull();
  });
  it("refuses fabricated tokens, foreign claims/identity/policy/original, accessor inputs and stale authority",async()=>{
    const f=await fixture(),p=provider(f),token=await compose(p.fetchRead,()=>now)(f.request,()=>{});
    for(const fake of [{},JSON.parse(JSON.stringify(token)),true,null])expect(()=>unseal(fake as VerifiedFundingTerminalObservation,f.request,()=>{})).toThrow("refused");
    for(const changed of [{...f.request,cryptoClaimId:randomUUID()},{...f.request,broadcastClaimId:randomUUID()},
      {...f.request,finalityPolicyDigest:"f".repeat(64)}, {...f.request,operation:{...f.request.operation as object,operationId:randomUUID()}}])
      expect(()=>unseal(token!,changed,()=>{})).toThrow("refused");
    const changed=structuredClone(f.request);(changed.operation as {policy:{identity:{storageId:string}}}).policy.identity.storageId=randomUUID();
    expect(()=>unseal(token!,changed,()=>{})).toThrow("refused");
    expect(()=>unseal(token!,f.request,async()=>{})).toThrow("refused");expect(()=>unseal(token!,f.request,()=>{throw new Error("drift");})).toThrow("refused");
    let invoked=false;const accessor={...f.request};Object.defineProperty(accessor,"prepared",{enumerable:true,get(){invoked=true;return f.request.prepared;}});
    expect(await compose(p.fetchRead,()=>now)(accessor,()=>{})).toBeNull();expect(invoked).toBe(false);
    let enabled=true;const drift=provider(f,(value,method,params,endpoint,count)=>{if(method==="eth_chainId" && count===2)enabled=false;return value;});
    expect(await compose(drift.fetchRead,()=>now)(f.request,()=>{if(!enabled)throw new Error();})).toBeNull();
  });
  it("refuses redirects, oversized declared/streamed bodies, malformed UTF8/envelopes and transport failure",async()=>{
    const f=await fixture();for(const response of [new Response("{}",{status:302,headers:{location:"https://example.invalid"}}),
      new Response("{}",{headers:{"content-length":String(policy.maximumResponseBytes+1)}}),new Response(" ".repeat(policy.maximumResponseBytes+1)),
      new Response(new Uint8Array([255])),new Response(JSON.stringify({jsonrpc:"2.0",id:999,result:null})),new Response("not-json")]) {
      expect(await compose((async()=>response.clone()) as typeof fetch,()=>now)(f.request,()=>{})).toBeNull();
    }
    expect(await compose((async()=>{throw new Error("private provider details");}) as typeof fetch,()=>now)(f.request,()=>{})).toBeNull();
  });
  it("bounds an abort-ignoring fetch request at the native per-request deadline",async()=>{
    const f=await fixture(),started=performance.now();
    const result=await compose((()=>new Promise(()=>{})) as typeof fetch,()=>now)(f.request,()=>{});
    expect(result).toBeNull();expect(performance.now()-started).toBeLessThan(policy.requestDeadlineMs+2000);
  },10000);
  it("enforces the separate total deadline while request abort is ignored",async()=>{
    const f=await fixture();vi.useFakeTimers();let entered!:()=>void;
    const reached=new Promise<void>(resolve=>{entered=resolve;});
    const pending=compose((()=>{entered();return new Promise(()=>{});}) as typeof fetch,()=>now)(f.request,()=>{});
    await reached;await vi.advanceTimersByTimeAsync(policy.totalDeadlineMs+1);expect(await pending).toBeNull();
  });
  it("refuses elapsed total deadline at final issuance guard while timers cannot run",async()=>{
    const f=await fixture(),p=provider(f);let clocks=0,finalGuard=false,timerDelivered=false;
    const timer=setTimeout(()=>{timerDelivered=true;},1000);
    try {
      const token=await compose(p.fetchRead,()=>{clocks++;return now;},{totalDeadlineMs:1000,requestDeadlineMs:1000})(f.request,()=>{
        // Sixth freshness read occurs inside final evidence construction, after
        // both providers and the complete stability pass have been sampled.
        if(clocks===6){finalGuard=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1100);expect(timerDelivered).toBe(false);}
      });
      expect(finalGuard).toBe(true);expect(p.calls).toHaveLength(22);expect(clocks).toBe(6);expect(token).toBeNull();
      expect(()=>unseal(token!,f.request,()=>{})).toThrow("refused");
    }finally{clearTimeout(timer);}
  },5000);
  it.each(["transport","body"])("refuses elapsed request deadline during synchronous %s work with timer undelivered",async phase=>{
    const f=await fixture(),p=provider(f);let reached=false,timerDelivered=false;
    const timer=setTimeout(()=>{timerDelivered=true;},100);
    const blockingFetch:typeof fetch=async(input,init)=>{
      const response=await p.fetchRead(input,init);
      const block=()=>{if(!reached){reached=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);expect(timerDelivered).toBe(false);}};
      if(phase==="transport")block();
      else return new Response(new ReadableStream({pull(controller){block();controller.enqueue(new TextEncoder().encode(JSON.stringify({jsonrpc:"2.0",id:JSON.parse(init!.body as string).id,result:q(5042002)})));controller.close();}},{highWaterMark:0}));
      return response;
    };
    try {
      const token=await compose(blockingFetch,()=>now,{totalDeadlineMs:2000,requestDeadlineMs:100})(f.request,()=>{});
      expect(reached).toBe(true);expect(token).toBeNull();expect(()=>unseal(token!,f.request,()=>{})).toThrow("refused");
      expect(p.calls.every(c=>c.method==="eth_chainId")).toBe(true);
    }finally{clearTimeout(timer);}
  },5000);
  it("allows only lower positive safe synthetic deadlines",()=>{
    for(const limits of [{totalDeadlineMs:0,requestDeadlineMs:1},{totalDeadlineMs:30001,requestDeadlineMs:1},
      {totalDeadlineMs:1,requestDeadlineMs:5001},{totalDeadlineMs:1.5,requestDeadlineMs:1},{totalDeadlineMs:1,requestDeadlineMs:NaN}])
      expect(()=>compose(fetch,()=>now,limits)).toThrow("refused");
  });
  it("copies the immutable request before network awaits and never adopts caller replacement",async()=>{
    const f=await fixture(),original=structuredClone(f.request),p=provider(f,(value)=>{
      (f.request.operation as {operationId:string}).operationId=randomUUID();return value;
    });
    const token=await compose(p.fetchRead,()=>now)(f.request,()=>{});
    expect(unseal(token!,original,()=>{}).operationId).toBe((original.operation as {operationId:string}).operationId);
    expect(()=>unseal(token!,f.request,()=>{})).toThrow("refused");
  });
});
