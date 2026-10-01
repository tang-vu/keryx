import { afterEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn,type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath,pathToFileURL } from "node:url";
import { generatePrivateKey } from "viem/accounts";
import { canonicalJson } from "../canonical-json";
import { inspectGatewayFundingSqliteOwnerTarget,installGatewayFundingSqliteOwnerAuthorization,
  } from "../db/gateway-funding-sqlite";
import type { GatewayFundingLedger,GatewayFundingStep } from "../db/gateway-funding-ledger-types";
import { createGatewayFundingExecutorForTrustedSyntheticComposition as executor,
  createKeylessGatewayFundingReconcilerForTrustedSyntheticComposition as reconciler,type GatewayFundingExecutorOptions } from "./gateway-funding-executor";
import { validateSignedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { createGatewayFundingReceiptObserverForTrustedComposition } from "./gateway-funding-receipt-observer";
import { fundingFixture,fundingProtocol,cleanupFundingFixtures,type FundingProtocolHook } from "./gateway-funding-test-fixture";

// Spy preserves installed viem sign's synchronous noble implementation. The
// frozen noble export itself is non-writable; no replacement signer is injected
// into executor production code or its private factory.
const signing=vi.hoisted(()=>({calls:0}));
vi.mock("viem/accounts",async importOriginal=>{
  const actual=await importOriginal<typeof import("viem/accounts")>();
  return {...actual,sign:(...args:Parameters<typeof actual.sign>)=>{signing.calls++;return actual.sign(...args);}};
});

let currentFixture: Awaited<ReturnType<typeof fundingFixture>>;
const children:ChildProcessWithoutNullStreams[]=[];
afterEach(async()=>{await Promise.all(children.splice(0).map(child=>child.exitCode!==null || child.signalCode!==null ? Promise.resolve() : new Promise<void>(resolve=>{
    child.once("close",()=>resolve());child.kill("SIGKILL");})));
  await cleanupFundingFixtures();signing.calls=0;});
async function fixture(){return currentFixture=await fundingFixture();}
async function rpcServer(hook?:FundingProtocolHook){return fundingProtocol(currentFixture,hook);}
function receiptObserver(rpc:Awaited<ReturnType<typeof rpcServer>>) {
  return createGatewayFundingReceiptObserverForTrustedComposition((endpoint,init)=>fetch(rpc.origins[String(endpoint).includes("blockdaemon") ? 0 : 1],init));
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
      if(method!=="eth_sendRawTransaction")return;
      const raw=params[0],saved=(await Promise.all((["nativeTransfer","usdcTransfer","approval","deposit"] as const).map(s=>f.ledger.inspectReservation(f.operation.operationId,s)))).find(s=>s?.prepared?.rawTransaction===raw);
      expect(saved?.cryptoClaimId).toBeTruthy();expect(saved?.broadcastClaimId).toBeTruthy();expect(params).toEqual([saved!.prepared!.rawTransaction]);
      return saved!.prepared!.transactionHash;
    });
    const handle=executor(f.options,rpc.origins),steps=["nativeTransfer","usdcTransfer","approval","deposit"] as const,index=steps.indexOf(step);
    for(const prior of steps.slice(0,index)) {
      expect((await handle.executeStep(f.operation.operationId,prior)).status).toBe("broadcast-acknowledged");
      expect((await reconciler(f.keyless,receiptObserver(rpc)).reconcileStep(f.operation.operationId,prior)).status).toBe("execution-success");
    }
    const first=handle.executeStep(f.operation.operationId,step);
    expect(handle.executeStep(f.operation.operationId,step)).toBe(first);
    const result=await first;expect(result.status,result.stage).toBe("broadcast-acknowledged");
    expect(Object.keys(handle)).toEqual(["executeStep"]);expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(index+1);
    const original=await f.ledger.inspectReservation(f.operation.operationId,step);
    const prepared=original!.prepared!;
    expect((await validateSignedGatewayFundingTransaction(f.operation,step,prepared.transaction.nonce,{rawTransaction:prepared.rawTransaction,transactionHash:prepared.transactionHash},()=>{})).transactionHash).toBe(result.transactionHash);
    const restart=executor(f.options,rpc.origins);expect((await restart.executeStep(f.operation.operationId,step)).stage).toBe("existing-original");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(index+1);
  },120000);
  it.each(["crypto-claim","persist-prepared","broadcast-claim"])("retains committed %s after lost acknowledgement and never signs/sends on restart",async fault=>{
    const f=await fixture(),rpc=await rpcServer(),method=fault==="crypto-claim" ? "claimCrypto" : fault==="persist-prepared" ? "savePrepared" : "claimBroadcast";
    const wrapped={...f.ledger,[method]:async(...args:unknown[])=>{
      await (f.ledger[method] as (...values:unknown[])=>Promise<unknown>)(...args);throw new Error("synthetic lost ACK");
    }} as GatewayFundingLedger;
    const failed=await executor({...f.options,ledger:wrapped},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
    expect(failed.status).toBe("reconciliation-required");expect(failed.stage).toBe(fault);
    const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(original?.cryptoClaimId).toBeTruthy();
    if(fault!=="crypto-claim")expect(original?.prepared).toBeTruthy();if(fault==="broadcast-claim")expect(original?.broadcastClaimId).toBeTruthy();
    const before=canonicalJson(original);expect((await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).stage).toBe("existing-original");
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
    const {funderPrivateKey:_f,spendPrivateKey:_s,...binding}=f.options;
    const keyless=reconciler({...binding,terminalStore:f.terminalStore},async()=>null);
    expect((await keyless.reconcileStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it("retains original signed bytes after physical send with lost response and permits only keyless reconciliation",async()=>{
    const f=await fixture(),rpc=await rpcServer(async method=>{if(method==="eth_sendRawTransaction")throw new Error("lost ACK after request capture");});
    const handle=executor(f.options,rpc.origins),promise=handle.executeStep(f.operation.operationId,"nativeTransfer"),answer=await promise;
    expect(answer.status).toBe("reconciliation-required");expect(answer.stage).toBe("physical-send");
    expect(handle.executeStep(f.operation.operationId,"nativeTransfer")).toBe(promise);
    const before=canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"));
    await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
  },20000);
  it("refuses wrong chain, same-mode foreign identity/policy/backend/sender and Promise guard before exposure",async()=>{
    const f=await fixture(),rpc=await rpcServer(async()=>"0x1");
    expect((await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    const reserved=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(reserved?.state).toBe("reserved");
    expect(reserved?.cryptoClaimId).toBeUndefined();
    expect((await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).stage).toBe("existing-original");
    for(const patch of [{installedPolicyDigest:"a".repeat(64)},{expectedBackendBindingDigest:"a".repeat(64)},{funderPrivateKey:generatePrivateKey()}])
      expect((await executor({...f.options,...patch},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    expect(()=>executor({...f.options,expectedIdentity:{...f.identity,storageId:randomUUID()}},rpc.origins)).toThrow("refused");
    expect(()=>executor({...f.options,assertCurrentAuthority:async()=>{}},rpc.origins)).toThrow("refused");
    let accessed=false;const accessor={...f.options};Object.defineProperty(accessor,"funderPrivateKey",{enumerable:true,get(){accessed=true;return f.options.funderPrivateKey;}});
    expect(()=>executor(accessor,rpc.origins)).toThrow("refused");expect(accessed).toBe(false);
    expect(()=>executor({...f.options,sign:()=>{} } as GatewayFundingExecutorOptions,rpc.origins)).toThrow("refused");
    expect(()=>executor(f.options,rpc.origins,{totalDeadlineMs:30001})).toThrow("refused");
    const next={...f.operation,operationId:randomUUID(),ownerAuthorizationId:randomUUID()};
    await installGatewayFundingSqliteOwnerAuthorization(f.file,f.identity,next);
    expect((await executor(f.options,rpc.origins).executeStep(next.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
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
    expect((await executor({...f.options,ledger},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
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
    expect((await executor({...f.options,ledger},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("reconciliation-required");
    const actual=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(actual?.broadcastClaimId).toBeTruthy();expect(actual?.prepared).toBeTruthy();
    expect(signing.calls).toBe(1);expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
  },20000);
  it.each(["crypto","broadcast"])("refuses authority drift after durable %s claim before crypto/send",async phase=>{
    const f=await fixture(),rpc=await rpcServer();let current=true;
    const method=phase==="crypto" ? "claimCrypto" : "claimBroadcast";
    const ledger={...f.ledger,[method]:async(...args:unknown[])=>{const actual=await (f.ledger[method] as (...a:unknown[])=>Promise<unknown>)(...args);current=false;return actual;}} as GatewayFundingLedger;
    const answer=await executor({...f.options,ledger,assertCurrentAuthority:()=>{if(!current)throw new Error();}},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
    expect(answer.status).toBe("reconciliation-required");expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
    const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(Boolean(original?.prepared)).toBe(phase==="broadcast");
  },30000);
  it.each(["crypto","prepared","broadcast","send"])("actual child kill at %s retains originals and a separate no-key restart never signs/sends",async mode=>{
    const f=await fixture();let sent!:()=>void;const captured=new Promise<void>(resolve=>{sent=resolve;});
    const rpc=await rpcServer(async(method)=>{if(method==="eth_sendRawTransaction"){sent();return new Promise(()=>{});}});
    const metadata={file:f.file,identity:f.identity,operationId:f.operation.operationId,installedPolicyDigest:f.options.installedPolicyDigest,
      expectedBackendBindingDigest:f.options.expectedBackendBindingDigest,finalityPolicyDigest:f.options.finalityPolicyDigest};
    const running=child({...metadata,mode,origins:rpc.origins,funderPrivateKey:f.options.funderPrivateKey,spendPrivateKey:f.options.spendPrivateKey});
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
    const f=await fixture(),rpc=await rpcServer(async(method,_params,fallback)=>method==="eth_getTransactionReceipt" && status==="reverted" ? {...fallback as object,status:"0x0"} : undefined);
    expect((await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer")).status).toBe("broadcast-acknowledged");
    expect((await reconciler(f.keyless,receiptObserver(rpc)).reconcileStep(f.operation.operationId,"nativeTransfer")).status).toBe(`execution-${status}`);
    const saved=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(saved?.terminal?.receiptStatus).toBe(status);
    const before=canonicalJson(saved),neverObserve=vi.fn(async()=>{throw new Error("Do not replace terminal evidence");});
    expect((await reconciler(f.keyless,neverObserve).reconcileStep(f.operation.operationId,"nativeTransfer")).stage).toBe("stored-original-terminal");
    expect(neverObserve).not.toHaveBeenCalled();expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
    expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(1);
  },30000);
  it.each(["crypto","broadcast"])("refuses elapsed-overdue crypto/send after durable %s claim while synchronous binding prevents timer delivery",async phase=>{
    const f=await fixture();let armed=false,timerDelivered=false,blockedWithoutTimer=false;
    const rpc=await rpcServer();const method=phase==="crypto" ? "claimCrypto" : "claimBroadcast";
    const ledger={...f.ledger,[method]:async(...args:unknown[])=>{const actual=await (f.ledger[method] as (...a:unknown[])=>Promise<unknown>)(...args);armed=true;return actual;}} as GatewayFundingLedger;
    // Actual identity-fenced native SQLite admission may itself exceed 1s on
    // Windows. Keep its real reads/claims, then cross a lower-only deadline
    // synchronously while neither the external nor executor timer can fire.
    const deadline=phase==="crypto" ? 5000 : 25000;
    const timer=setTimeout(()=>{timerDelivered=true;},deadline),guard=()=>{
      if(armed){armed=false;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,deadline+200);blockedWithoutTimer=!timerDelivered;}
    };
    try {
      const answer=await executor({...f.options,ledger,assertCurrentAuthority:guard},rpc.origins,{totalDeadlineMs:deadline}).executeStep(f.operation.operationId,"nativeTransfer");
      expect(answer.status).toBe("reconciliation-required");expect(blockedWithoutTimer).toBe(true);expect(signing.calls).toBe(phase==="crypto" ? 0 : 1);
      expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
      const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(original?.cryptoClaimId).toBeTruthy();expect(Boolean(original?.prepared)).toBe(phase==="broadcast");
      const before=canonicalJson(original);await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
      expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);expect(signing.calls).toBe(phase==="crypto" ? 0 : 1);
    }finally{clearTimeout(timer);}
  },60000);
  it.each(["crypto","broadcast"])("expires opaque preflight at the actual %s boundary while the outer budget remains alive",async phase=>{
    const f=await fixture(),rpc=await rpcServer();let reads=0,armed=false,blocked=false,timerDelivered=false;
    const ledger={...f.ledger,inspectReservation:async(...args:Parameters<typeof f.ledger.inspectReservation>)=>{
      const saved=await f.ledger.inspectReservation(...args);
      const target=phase==="crypto" ? saved?.state==="crypto-claimed" : Boolean(saved?.broadcastClaimId);
      if(target && ++reads===2)armed=true;
      return saved;
    }} as GatewayFundingLedger;
    const guard=()=>{if(armed){armed=false;const timer=setTimeout(()=>{timerDelivered=true;},1000);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5200);blocked=!timerDelivered;clearTimeout(timer);}};
    const answer=await executor({...f.options,ledger,assertCurrentAuthority:guard},rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
    expect(blocked).toBe(true);expect(timerDelivered).toBe(false);expect(answer.status).toBe("reconciliation-required");
    expect(answer.stage).toBe(phase==="crypto" ? "crypto" : "physical-send");
    expect(signing.calls).toBe(phase==="crypto" ? 0 : 1);expect(rpc.calls.filter(c=>c.method==="eth_sendRawTransaction")).toHaveLength(0);
    const original=await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer");expect(original?.cryptoClaimId).toBeTruthy();
    expect(Boolean(original?.broadcastClaimId)).toBe(phase==="broadcast");const before=canonicalJson(original);
    await executor(f.options,rpc.origins).executeStep(f.operation.operationId,"nativeTransfer");
    expect(canonicalJson(await f.ledger.inspectReservation(f.operation.operationId,"nativeTransfer"))).toBe(before);
    expect(signing.calls).toBe(phase==="crypto" ? 0 : 1);
  },60000);
});
