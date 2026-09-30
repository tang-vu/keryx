import { afterEach,describe,expect,it,vi } from "vitest";
import { createServer,type Server } from "node:http";
import { randomUUID,createHash } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn,type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath,pathToFileURL } from "node:url";
import { generatePrivateKey,privateKeyToAccount } from "viem/accounts";
import { parseTransaction } from "viem";
import { canonicalJson } from "../canonical-json";
import { provisionSyntheticStorage } from "../db/storage-identity-fixture";
import { inspectGatewayFundingSqliteOwnerTarget,installGatewayFundingSqliteOwnerPolicy,installGatewayFundingSqliteOwnerAuthorization,
  openGatewayFundingSqliteLedger,openGatewayFundingSqliteTerminalObserver } from "../db/gateway-funding-sqlite";
import type { GatewayFundingLedger,GatewayFundingStep } from "../db/gateway-funding-ledger-types";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";
import { createGatewayFundingExecutorForTrustedSyntheticComposition as executor,
  createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition as reconciler,type GatewayFundingExecutorOptions } from "./gateway-funding-executor";
import { validateSignedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "./gateway-funding-receipt-observer";

// Spy preserves installed viem sign's synchronous noble implementation. The
// frozen noble export itself is non-writable; no replacement signer is injected
// into executor production code or its private factory.
const signing=vi.hoisted(()=>({calls:0}));
vi.mock("viem/accounts",async importOriginal=>{
  const actual=await importOriginal<typeof import("viem/accounts")>();
  return {...actual,sign:(...args:Parameters<typeof actual.sign>)=>{signing.calls++;return actual.sign(...args);}};
});

const servers:Server[]=[],directories:string[]=[],closers:(()=>void)[]=[];
const children:ChildProcessWithoutNullStreams[]=[];
afterEach(async()=>{await Promise.all(children.splice(0).map(child=>child.exitCode!==null || child.signalCode!==null ? Promise.resolve() : new Promise<void>(resolve=>{
    child.once("close",()=>resolve());child.kill("SIGKILL");})));
  for(const close of closers.splice(0))close();await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>{s.closeAllConnections();s.close(()=>resolve());})));
  for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});signing.calls=0;});
async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"funding-executor-"));directories.push(dir);
  const file=join(dir,"application.sqlite"),identity=await provisionSyntheticStorage(file,"testnet-real");
  const funderPrivateKey=generatePrivateKey(),spendPrivateKey=generatePrivateKey();
  const policy={format:"gateway-funding-policy-v1" as const,identity,policyId:randomUUID(),funder:privateKeyToAccount(funderPrivateKey).address.toLowerCase(),
    spend:privateKeyToAccount(spendPrivateKey).address.toLowerCase(),lifetimeLimits:{nativeWei:"100",usdcMicros:"200",depositMicros:"200",gasWei:"10000000"},maxTransactionGas:"120000",maxFeePerGasWei:"20"};
  const reviewed=await inspectGatewayFundingSqliteOwnerTarget(file,identity);
  await installGatewayFundingSqliteOwnerPolicy(file,identity,{format:"gateway-funding-owner-installation-v1",policy,funderGasBudgetWei:"4000000",spendGasBudgetWei:"6000000",
    ...reviewed,finalityPolicyDigest:GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    history:{format:"gateway-funding-empty-isolated-history-v1",documentDigest:"d".repeat(64),funderInitialNonce:"0",spendInitialNonce:"0"}});
  const operation={format:"gateway-funding-operation-v1" as const,policy,operationId:randomUUID(),ownerAuthorizationId:randomUUID(),ownerAuthorizationDigest:"b".repeat(64),
    minimumAvailableMicros:"100",initialAvailableMicros:"0",nativeTransferWei:"50",usdcTransferMicros:"100",approvalMicros:"100",depositMicros:"100",
    gasLimits:{nativeTransfer:"21000",usdcTransfer:"60000",approval:"60000",deposit:"120000"},maxFeePerGasWei:"10",maxPriorityFeePerGasWei:"1"};
  await installGatewayFundingSqliteOwnerAuthorization(file,identity,operation);
  const ledger=openGatewayFundingSqliteLedger(file,identity),terminalStore=openGatewayFundingSqliteTerminalObserver(file,identity);closers.push(()=>ledger.close(),()=>terminalStore.close());
  const options:GatewayFundingExecutorOptions={ledger,expectedIdentity:identity,expectedBackendBindingDigest:reviewed.reviewedTargetDigest,
    installedPolicyDigest:createHash("sha256").update(canonicalJson(policy)).digest("hex"),finalityPolicyDigest:GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    assertCurrentAuthority:()=>{},funderPrivateKey,spendPrivateKey};
  return {file,identity,operation,ledger,terminalStore,options};
}
async function rpcServer(hook?:(method:string,params:string[])=>Promise<unknown>) {
  const calls:{method:string;params:string[]}[]=[];
  const server=createServer(async(req,res)=>{
    let text="";for await(const chunk of req)text+=chunk;const body=JSON.parse(text);calls.push(body);
    try {const result=hook ? await hook(body.method,body.params) : body.method==="eth_chainId" ? "0x4cef52" : "unexpected";
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:body.id,result}));}
    catch{res.destroy();}
  });servers.push(server);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address==="string")throw new Error("Synthetic listener failed");
  return {endpoint:`http://127.0.0.1:${address.port}/`,calls};
}
function child(input:object) {
  const require=createRequire(import.meta.url),process=spawn(globalThis.process.execPath,["--import",pathToFileURL(require.resolve("tsx")).href,
    fileURLToPath(new URL("./gateway-funding-executor-child.mts",import.meta.url))],{windowsHide:true,stdio:"pipe",
    env:globalThis.process.platform==="win32" ? {NODE_ENV:"test",SystemRoot:globalThis.process.env.SystemRoot ?? "C:\\Windows"} : {NODE_ENV:"test"}});
  children.push(process);let output="",committed!:()=>void,completed!:(value:unknown)=>void,refused!:(error:Error)=>void;
  const commit=new Promise<void>(resolve=>{committed=resolve;}),result=new Promise<unknown>((resolve,reject)=>{completed=resolve;refused=reject;});void result.catch(()=>{});
  const timer=setTimeout(()=>{process.kill("SIGKILL");refused(new Error("Synthetic child deadline"));},15000);
  process.stdout.on("data",bytes=>{if(Buffer.byteLength(output)+bytes.length>4096){process.kill("SIGKILL");return;}output+=bytes.toString();
    if(output.includes("COMMITTED\n"))committed();const line=output.match(/RESULT (.*)\n/);if(line)completed(JSON.parse(line[1]));});
  process.stderr.resume();process.once("error",()=>refused(new Error("Synthetic child unavailable")));
  const closed=new Promise<void>(resolve=>process.once("close",()=>{clearTimeout(timer);if(!output.includes("RESULT "))refused(new Error("Synthetic child stopped"));resolve();}));
  process.stdin.end(JSON.stringify(input));return {process,commit,result,closed};
}
describe("controlled funding execution against actual synthetic SQLite",()=>{
  it.each(["nativeTransfer","usdcTransfer","approval","deposit"] as GatewayFundingStep[])("signs and physically sends exactly original %s only after durable claims",async step=>{
    const f=await fixture(),rpc=await rpcServer(async(method,params)=>{
      if(method==="eth_chainId")return "0x4cef52";
      const saved=await f.ledger.inspectReservation(f.operation.operationId,step);
      expect(saved?.cryptoClaimId).toBeTruthy();expect(saved?.broadcastClaimId).toBeTruthy();expect(params).toEqual([saved!.prepared!.rawTransaction]);
      return saved!.prepared!.transactionHash;
    });
    const handle=executor(f.options,rpc.endpoint),first=handle.executeStep(f.operation.operationId,step);
    expect(handle.executeStep(f.operation.operationId,step)).toBe(first);
    const result=await first;expect(result.status,result.stage).toBe("broadcast-acknowledged");
    expect(Object.keys(handle)).toEqual(["executeStep"]);expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
    const original=await f.ledger.inspectReservation(f.operation.operationId,step);
    const prepared=original!.prepared!;
    expect((await validateSignedGatewayFundingTransaction(f.operation,step,"0",{rawTransaction:prepared.rawTransaction,transactionHash:prepared.transactionHash},()=>{})).transactionHash).toBe(result.transactionHash);
    const restart=executor(f.options,rpc.endpoint);expect((await restart.executeStep(f.operation.operationId,step)).stage).toBe("existing-original");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
  },20000);
  it.each(["crypto-claim","persist-prepared","broadcast-claim"])("retains committed %s after lost acknowledgement and never signs/sends on restart",async fault=>{
    const f=await fixture(),rpc=await rpcServer(),method=fault==="crypto-claim" ? "claimCrypto" : fault==="persist-prepared" ? "savePrepared" : "claimBroadcast";
    const wrapped={...f.ledger,[method]:async(...args:unknown[])=>{
      await (f.ledger[method] as (...values:unknown[])=>Promise<unknown>)(...args);throw new Error("synthetic lost ACK");
    }} as GatewayFundingLedger;
    const failed=await executor({...f.options,ledger:wrapped},rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer");
    expect(failed.status).toBe("reconciliation-required");expect(failed.stage).toBe(fault);
    const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(original?.cryptoClaimId).toBeTruthy();
    if(fault!=="crypto-claim")expect(original?.prepared).toBeTruthy();if(fault==="broadcast-claim")expect(original?.broadcastClaimId).toBeTruthy();
    const before=canonicalJson(original);expect((await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).stage).toBe("existing-original");
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
    const {funderPrivateKey:_f,spendPrivateKey:_s,...binding}=f.options;
    const keyless=reconciler({...binding,terminalStore:f.terminalStore},async()=>null);
    expect((await keyless.reconcileStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it("retains original signed bytes after physical send with lost response and permits only keyless reconciliation",async()=>{
    const f=await fixture(),rpc=await rpcServer(async method=>{if(method==="eth_chainId")return "0x4cef52";throw new Error("lost ACK after request capture");});
    const handle=executor(f.options,rpc.endpoint),promise=handle.executeStep(f.operation.operationId,"nativeTransfer"),answer=await promise;
    expect(answer.status).toBe("reconciliation-required");expect(answer.stage).toBe("physical-send");
    expect(handle.executeStep(f.operation.operationId,"nativeTransfer")).toBe(promise);
    const before=canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"));
    await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
  },20000);
  it("refuses wrong chain, same-mode foreign identity/policy/backend/sender and Promise guard before exposure",async()=>{
    const f=await fixture(),rpc=await rpcServer(async()=>"0x1");
    expect((await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    const reserved=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(reserved?.state).toBe("reserved");
    expect(reserved?.cryptoClaimId).toBeUndefined();
    expect((await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).stage).toBe("existing-original");
    for(const patch of [{installedPolicyDigest:"a".repeat(64)},{expectedBackendBindingDigest:"a".repeat(64)},{funderPrivateKey:generatePrivateKey()}])
      expect((await executor({...f.options,...patch},rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    expect(()=>executor({...f.options,expectedIdentity:{...f.identity,storageId:randomUUID()}},rpc.endpoint)).toThrow("refused");
    expect(()=>executor({...f.options,assertCurrentAuthority:async()=>{}},rpc.endpoint)).toThrow("refused");
    let accessed=false;const accessor={...f.options};Object.defineProperty(accessor,"funderPrivateKey",{enumerable:true,get(){accessed=true;return f.options.funderPrivateKey;}});
    expect(()=>executor(accessor,rpc.endpoint)).toThrow("refused");expect(accessed).toBe(false);
    expect(()=>executor({...f.options,sign:()=>{} } as GatewayFundingExecutorOptions,rpc.endpoint)).toThrow("refused");
    expect(()=>executor(f.options,rpc.endpoint,{totalDeadlineMs:30001})).toThrow("refused");
    const next={...f.operation,operationId:randomUUID(),ownerAuthorizationId:randomUUID()};
    await installGatewayFundingSqliteOwnerAuthorization(f.file,f.identity,next);
    expect((await executor(f.options,rpc.endpoint).executeStep(next.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    expect(await f.ledger.inspectReservation(next.operationId,"nativeTransfer")).toBeNull(); // no gap beyond unresolved barrier
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it("keyless recovery of an unadmitted authorization never admits or reserves it",async()=>{
    const f=await fixture(),before=await inspectGatewayFundingSqliteOwnerTarget(f.file,f.identity);
    expect(await f.ledger.inspectOperation(f.operation.operationId)).toBeNull();
    const forbidden=vi.fn(async()=>{throw new Error("No recovery writes permitted");});
    const readOnly={...f.ledger,admitOperation:forbidden,reserveStep:forbidden,claimCrypto:forbidden,savePrepared:forbidden,claimBroadcast:forbidden};
    const keylessOptions={ledger:readOnly,terminalStore:f.terminalStore,expectedIdentity:f.identity,installedPolicyDigest:f.options.installedPolicyDigest,
      expectedBackendBindingDigest:f.options.expectedBackendBindingDigest,finalityPolicyDigest:f.options.finalityPolicyDigest,assertCurrentAuthority:()=>{}};
    expect((await reconciler(keylessOptions,async()=>null).reconcileStep(f.operation.operationId,"nativeTransfer")).status).toBe("missing-reservation");
    expect(forbidden).not.toHaveBeenCalled();expect(await f.ledger.inspectOperation(f.operation.operationId)).toBeNull();
    expect((await inspectGatewayFundingSqliteOwnerTarget(f.file,f.identity)).reviewedSnapshotDigest).toBe(before.reviewedSnapshotDigest);
  },20000);
  it.each(["not-fresh","mismatched-readback"])("requires fresh durable crypto claim and exact readback before signing: %s",async fault=>{
    const f=await fixture(),rpc=await rpcServer();let claimed=false;
    const ledger={...f.ledger,claimCrypto:async(...args:Parameters<GatewayFundingLedger["claimCrypto"]>)=>{
      const actual=await f.ledger.claimCrypto(...args);claimed=true;return fault==="not-fresh" ? {...actual,fresh:false} : actual;
    },inspectReservation:async(...args:Parameters<GatewayFundingLedger["inspectReservation"]>)=>{
      const actual=await f.ledger.inspectReservation(...args);return actual && claimed && fault==="mismatched-readback" ? {...actual,cryptoClaimId:randomUUID()} : actual;
    }};
    expect((await executor({...f.options,ledger},rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    const actual=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(actual?.cryptoClaimId).toBeTruthy();expect(actual?.prepared).toBeUndefined();
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it.each(["not-fresh","mismatched-readback"])("requires fresh durable broadcast claim and exact readback before physical send: %s",async fault=>{
    const f=await fixture(),rpc=await rpcServer();let claimed=false;
    const ledger={...f.ledger,claimBroadcast:async(...args:Parameters<GatewayFundingLedger["claimBroadcast"]>)=>{
      const actual=await f.ledger.claimBroadcast(...args);claimed=true;return fault==="not-fresh" ? {...actual,fresh:false} : actual;
    },inspectReservation:async(...args:Parameters<GatewayFundingLedger["inspectReservation"]>)=>{
      const actual=await f.ledger.inspectReservation(...args);return actual && claimed && fault==="mismatched-readback" ? {...actual,broadcastClaimId:randomUUID()} : actual;
    }};
    expect((await executor({...f.options,ledger},rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    const actual=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(actual?.broadcastClaimId).toBeTruthy();expect(actual?.prepared).toBeTruthy();
    expect(signing.calls).toBe(1);expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it.each([2,3])("refuses authority drift after deferred chain read %s before crypto/send",async chainRead=>{
    const f=await fixture();let current=true,reads=0;const rpc=await rpcServer(async(method)=>{
      if(method==="eth_chainId"){if(++reads===chainRead)current=false;return "0x4cef52";}throw new Error("unexpected send");
    });
    const answer=await executor({...f.options,assertCurrentAuthority:()=>{if(!current)throw new Error();}},rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer");
    expect(answer.status).toBe("reconciliation-required");expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
    const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");
    expect(Boolean(original?.prepared)).toBe(chainRead===3);
  },20000);
  it.each(["crypto","prepared","broadcast","send"])("actual child kill at %s retains originals and a separate no-key restart never signs/sends",async mode=>{
    const f=await fixture();let sent!:()=>void;const captured=new Promise<void>(resolve=>{sent=resolve;});
    const rpc=await rpcServer(async(method)=>{if(method==="eth_chainId")return "0x4cef52";sent();return new Promise(()=>{});});
    const metadata={file:f.file,identity:f.identity,operationId:f.operation.operationId,installedPolicyDigest:f.options.installedPolicyDigest,
      expectedBackendBindingDigest:f.options.expectedBackendBindingDigest,finalityPolicyDigest:f.options.finalityPolicyDigest};
    const running=child({...metadata,mode,endpoint:rpc.endpoint,funderPrivateKey:f.options.funderPrivateKey,spendPrivateKey:f.options.spendPrivateKey});
    await Promise.race([mode==="send" ? captured : running.commit,running.result]);running.process.kill("SIGKILL");await running.closed;
    expect(running.process.signalCode).toBe("SIGKILL");
    const snapshot=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(snapshot?.cryptoClaimId).toBeTruthy();
    if(mode!=="crypto")expect(snapshot?.prepared).toBeTruthy();if(mode==="broadcast" || mode==="send")expect(snapshot?.broadcastClaimId).toBeTruthy();
    const original=canonicalJson(snapshot),restart=child({...metadata,mode:"keyless"});
    expect((await restart.result as {status:string}).status).toBe("reconciliation-required");await restart.closed;expect(restart.process.exitCode).toBe(0);
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(original);
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(mode==="send" ? 1 : 0);
  },30000);
  it.each(["success","reverted"])("keyless actual issuer/protected-store integration retains terminal %s and restart reads it without new observation",async status=>{
    const f=await fixture(),now=1800000000000,q=(value:string|number)=>`0x${BigInt(value).toString(16)}`;
    const inclusion=`0x${"a".repeat(64)}`,anchor=`0x${"b".repeat(64)}`;
    const rpc=await rpcServer(async(method,params)=>{
      if(method==="eth_chainId")return "0x4cef52";
      const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"),p=original!.prepared!,t=p.transaction;
      if(method==="eth_sendRawTransaction")return p.transactionHash;
      if(method==="eth_getTransactionByHash") {
        const signature=parseTransaction(p.rawTransaction);
        return {hash:p.transactionHash,from:t.sender,to:t.to,input:t.data,type:"0x2",chainId:q(t.chainId),nonce:q(t.nonce),value:q(t.valueWei),gas:q(t.gas),
          maxFeePerGas:q(t.maxFeePerGasWei),maxPriorityFeePerGas:q(t.maxPriorityFeePerGasWei),r:signature.r,s:signature.s,yParity:q(signature.yParity!),accessList:[],
          blockNumber:"0xa",blockHash:inclusion,transactionIndex:"0x0"};
      }
      if(method==="eth_getTransactionReceipt")return {transactionHash:p.transactionHash,from:t.sender,to:t.to,type:"0x2",status:status==="success" ? "0x1" : "0x0",
        gasUsed:"0x5208",effectiveGasPrice:"0x2",blockNumber:"0xa",blockHash:inclusion,transactionIndex:"0x0"};
      if(method==="eth_getBlockByNumber")return params[0]==="0xa" ? {number:"0xa",hash:inclusion,timestamp:q(now/1000-2),transactions:[p.transactionHash]}
        : {number:"0xb",hash:anchor,timestamp:q(now/1000-1),transactions:[]};
      throw new Error("Unsupported synthetic RPC");
    });
    expect((await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("broadcast-acknowledged");
    const observer=createGatewayFundingReceiptObserverForTrustedComposition((_endpoint,init)=>fetch(rpc.endpoint,init),()=>now);
    const keyless={ledger:f.ledger,terminalStore:f.terminalStore,expectedIdentity:f.identity,installedPolicyDigest:f.options.installedPolicyDigest,
      expectedBackendBindingDigest:f.options.expectedBackendBindingDigest,finalityPolicyDigest:f.options.finalityPolicyDigest,assertCurrentAuthority:()=>{}};
    expect((await reconciler(keyless,observer).reconcileStep(f.operation.operationId,"nativeTransfer")).status).toBe(`execution-${status}`);
    const saved=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(saved?.terminal?.receiptStatus).toBe(status);
    const before=canonicalJson(saved),neverObserve=vi.fn(async()=>{throw new Error("Do not replace terminal evidence");});
    expect((await reconciler(keyless,neverObserve).reconcileStep(f.operation.operationId,"nativeTransfer")).stage).toBe("stored-original-terminal");
    expect(neverObserve).not.toHaveBeenCalled();expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
  },20000);
  it.each([2,3])("refuses elapsed-overdue crypto/send after chain read %s while synchronous binding prevents timer delivery",async chainRead=>{
    const f=await fixture();let reads=0,armed=false,timerDelivered=false,blockedWithoutTimer=false;
    const rpc=await rpcServer(async method=>{if(method==="eth_chainId"){if(++reads===chainRead)armed=true;return "0x4cef52";}throw new Error("Unexpected overdue send");});
    // Actual identity-fenced native SQLite admission may itself exceed 1s on
    // Windows. Keep its real reads/claims, then cross a lower-only 5s deadline
    // synchronously while neither the external nor executor timer can fire.
    const timer=setTimeout(()=>{timerDelivered=true;},5000),guard=()=>{
      if(armed){armed=false;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5200);blockedWithoutTimer=!timerDelivered;}
    };
    try {
      const answer=await executor({...f.options,assertCurrentAuthority:guard},rpc.endpoint,{totalDeadlineMs:5000}).executeStep(f.operation.operationId,"nativeTransfer");
      expect(answer.status).toBe("reconciliation-required");expect(blockedWithoutTimer).toBe(true);expect(signing.calls).toBe(chainRead===2 ? 0 : 1);
      expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
      const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(original?.cryptoClaimId).toBeTruthy();expect(Boolean(original?.prepared)).toBe(chainRead===3);
      const before=canonicalJson(original);await executor(f.options,rpc.endpoint).executeStep(f.operation.operationId,"nativeTransfer");
      expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);expect(signing.calls).toBe(chainRead===2 ? 0 : 1);
    }finally{clearTimeout(timer);}
  },20000);
});
