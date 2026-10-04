import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { SiweMessage } from "siwe";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile";
import { browserSessionCustodyContext } from "../lib/session/browser-session-custody";
import { privateHeadlessTestDirectory } from "./helpers/headless-state-test-fixture";
import { headlessCashoutFixture,testHeadlessWrapping } from "./helpers/headless-cashout-test-fixture";
vi.stubEnv("KERYX_NETWORK","arc");vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK","arc");
const {runHeadlessMainnet}=await import("./web-client-mainnet.mjs");
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();});
afterAll(()=>vi.unstubAllEnvs());
const owner=privateKeyToAccount(`0x${"11".repeat(32)}`),payout=privateKeyToAccount(`0x${"22".repeat(32)}`).address.toLowerCase();
const epoch="00000000-0000-4000-8000-000000000001",reqId="00000000-0000-4000-8000-000000000002",nonce=`0x${"33".repeat(32)}`;
function fixture(lost=false,duplicate=false){
  const directory=privateHeadlessTestDirectory();roots.push(directory);
  vi.stubEnv("KERYX_HEADLESS_OWNER_PRIVATE_KEY",`0x${"11".repeat(32)}`);vi.stubEnv("KERYX_HEADLESS_WRAPPING_KEY",`0x${"55".repeat(32)}`);
  vi.stubEnv("KERYX_HEADLESS_STATE_DIRECTORY",directory);vi.stubEnv("KERYX_BASE_URL","https://keryx.cc");
  const context=browserSessionCustodyContext(profile,"https://keryx.cc",owner.address),file=path.join(directory,`${context.storageNamespace}.sqlite`);
  const requests:string[]=[],signals:Array<{path:string;signal:AbortSignal}>=[];let consent:Record<string,unknown>,proof:Record<string,unknown>;
  const json=(v:unknown)=>Response.json(v);
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));requests.push(url.pathname);signals.push({path:url.pathname,signal:init!.signal as AbortSignal});expect(url.origin).toBe(context.origin);expect(init?.redirect).toBe("error");
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    if(url.pathname==="/api/auth/nonce")return json({nonce:"syntheticnonce1234"});
    if(url.pathname==="/api/auth/verify"){expect(new SiweMessage(body.message).chainId).toBe(5042);return json({ok:true});}
    if(url.pathname==="/api/session/withdraw/payments")return json({network:profile.networkId,sessAddr:consent.sessAddr,retryAuthorized:false,payments:[],nextCursor:null});
    if(url.pathname==="/api/session/grant/challenge"){
      consent={format:"keryx-session-grant-consent-v1",network:profile.networkId,origin:context.origin,ownerAddr:context.owner,
        sessAddr:body.sessAddr.toLowerCase(),grantEpoch:epoch,capMicroUsdc:"2000",expirySeconds:String(Math.floor(Date.now()/1000)+3600)};
      return json({consent,funding:{confirmedSpentMicroUsdc:"0"}});
    }
    if(url.pathname==="/api/session/grant"&&init?.method==="POST"){
      expect(body).not.toHaveProperty("privateKey");expect(body).not.toHaveProperty("derivationSignature");
      proof={active:true,sessionId:context.owner,ownerAddr:context.owner,sessAddr:consent.sessAddr,grantEpoch:epoch,
        network:profile.networkId,origin:context.origin,capMicroUsdc:"2000",spentMicroUsdc:"0",consent,ownerSignature:body.signature,sessionSignature:body.sessionSignature};return json({ok:true});
    }
    if(url.pathname==="/api/session/grant")return json(proof);
    if(url.pathname==="/api/ask/challenge")return json({sessionId:context.owner,reqId,grantEpoch:epoch,sessAddr:consent.sessAddr,
      sourceId:"publication",kind:"fetch",expectedNonce:nonce,browserAuthorizationProtocol:"durable-v1",
      requirements:{scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"1000",payTo:payout,maxTimeoutSeconds:604900,
        extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}}});
    if(url.pathname==="/api/sources")return json({sources:[{id:"publication",onchainId:`0x${"44".repeat(32)}`} ]});
    if(url.pathname==="/api/ask"){const notification=`event: sign-request\ndata: ${JSON.stringify({reqId,requirements:{network:"eip155:5042002",payTo:owner.address,amount:"999999"}})}\n\n`;return new Response(notification+(duplicate?notification:"")+`event: done\ndata: {"answer":"Synthetic hermetic answer"}\n\n`);}
    if(url.pathname==="/api/ask/sign"){
      const header=JSON.parse(atob(body.paymentHeader)),a=header.authorization;
      const signer=await recoverTypedDataAddress({domain:{name:"GatewayWalletBatched",version:"1",chainId:5042,verifyingContract:profile.gatewayWallet},
        types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},
        primaryType:"TransferWithAuthorization",message:a,signature:header.signature as Hex});
      expect(signer.toLowerCase()).toBe(consent.sessAddr);expect(a.to).toBe(payout);expect(a.value).toBe("1000");expect(a.nonce).toBe(nonce);
      const db=new DatabaseSync(file,{readOnly:true});expect(db.prepare("SELECT nonce FROM exposure").all()).toHaveLength(1);expect(db.prepare("SELECT nonce FROM headers").all()).toHaveLength(1);db.close();
      if(lost)throw new Error("synthetic-lost-paid-response");return json({ok:true});
    }
    if(url.pathname.startsWith("/api/session/authorizations/"))return json({journal:{requestId:reqId,sessionId:context.owner,grantEpoch:epoch,signer:consent.sessAddr,nonce,phase:"signed",
      requirements:{scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"1000",payTo:payout,maxTimeoutSeconds:604900,
        extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}},payment:{authorizationId:nonce,kind:"fetch",sourceId:"publication",payer:String(consent.sessAddr),payee:payout,network:profile.networkId,settled:false,settlementStatus:"pending",amountUsdc:0.001,txHash:null}},
      authorization:{consent,ownerSignature:proof.ownerSignature,sessionSignature:proof.sessionSignature},settlementConfirmed:false,statusAuthority:"retained-journal-only",retryAuthorized:false});
    throw new Error("Unexpected hermetic endpoint");
  };
  return{directory,file,requests,signals,ports:{fetchImpl,readSource:async()=>({fetchPayTo:payout,creator:payout,wallets:new Set([payout]),listPriceUsdc:0.001,onchain:true,active:true})}};
}
it("normal mainnet headless uses authenticated challenge, native encrypted custody and committed exposure before paid POST",async()=>{
  const f=fixture();vi.spyOn(console,"log").mockImplementation(()=>{});await runHeadlessMainnet(["ask","Synthetic question","1000","2000"],f.ports);
  expect(f.requests.filter(p=>p==="/api/ask/sign")).toHaveLength(1);expect(f.requests).not.toContain("/api/faucet");
  expect(fs.readFileSync(f.file).toString()).not.toContain("11".repeat(32));
});
it("lost signed response preserves originals and blocks a second research/signature",async()=>{
  const f=fixture(true),log=vi.spyOn(console,"log").mockImplementation(()=>{}),error=vi.spyOn(console,"error").mockImplementation(()=>{});
  await runHeadlessMainnet(["ask","Synthetic question","1000","2000"],f.ports);
  expect(log).toHaveBeenCalledWith("Synthetic hermetic answer");expect(error).toHaveBeenCalledWith(expect.stringContaining("Continuing research"));
  const original=fs.readFileSync(f.file);await expect(runHeadlessMainnet(["ask","Another question","1000","2000"],f.ports)).rejects.toThrow("preserve original");
  expect(f.requests.filter(p=>p==="/api/ask/sign")).toHaveLength(1);expect(f.requests.filter(p=>p==="/api/ask")).toHaveLength(1);expect(fs.readFileSync(f.file)).toEqual(original);
});
it("HTTP mainnet refuses before custody creation, owner signing or transport",async()=>{
  const f=fixture();vi.stubEnv("KERYX_BASE_URL","http://keryx.cc");await expect(runHeadlessMainnet(["ask","Synthetic question","1000","2000"],f.ports)).rejects.toThrow();
  expect(f.requests).toEqual([]);expect(fs.readdirSync(f.directory)).toEqual([]);
});

it("uses distinct bounded whole-research and control deadlines without extending payment authority",async()=>{
 const originalTimeout=AbortSignal.timeout.bind(AbortSignal),deadlines:number[]=[];
 vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{deadlines.push(ms);return originalTimeout(ms);});
 const f=fixture();vi.spyOn(console,"log").mockImplementation(()=>{});
 await runHeadlessMainnet(["ask","Synthetic question","1000","2000"],f.ports);
 expect(deadlines.filter(ms=>ms===600_000)).toHaveLength(1);
 expect(deadlines.filter(ms=>ms===60_000).length).toBeGreaterThan(1);
});

it("a duplicate sign notification after lost ack never starts a second authorization or paid POST",async()=>{
 const f=fixture(true,true);vi.spyOn(console,"log").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});
 await runHeadlessMainnet(["ask","Synthetic question","1000","2000"],f.ports);
 expect(f.requests.filter(p=>p==="/api/ask/sign")).toHaveLength(1);
 expect(f.requests.filter(p=>p==="/api/ask/challenge")).toHaveLength(1);
});

it("ordinary cashout command restores expired custody, retains exposure on lost authorize and never uses grant renewal or owner transaction authority",async()=>{
 const directory=privateHeadlessTestDirectory();roots.push(directory);const f=await headlessCashoutFixture(directory);
 await f.state.withdrawals.storage.reserveWithdrawal(f.key.context.storageNamespace,f.p,(await f.state.withdrawals.storage.readExposure(f.key.context.storageNamespace)).version);
 f.key.lock();f.state.close();
 vi.stubEnv("KERYX_HEADLESS_OWNER_PRIVATE_KEY",`0x${"11".repeat(32)}`);vi.stubEnv("KERYX_HEADLESS_WRAPPING_KEY",testHeadlessWrapping);
 vi.stubEnv("KERYX_HEADLESS_STATE_DIRECTORY",directory);vi.stubEnv("KERYX_BASE_URL","https://keryx.cc");
 const requests:string[]=[],log=vi.spyOn(console,"log").mockImplementation(()=>{});
 const ports={cashout:{chain:async()=>{}},fetchImpl:async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=new URL(String(input)).pathname;requests.push(path);
  if(path==="/api/auth/nonce")return Response.json({nonce:"syntheticnonce1234"});
  if(path==="/api/auth/verify")return Response.json({ok:true});
  if(path==="/api/session/credit")return Response.json({status:"known",network:profile.networkId,address:f.p.sessAddr,available:"1000000"});
  if(path==="/api/session/withdraw/payments")return Response.json({network:profile.networkId,sessAddr:f.p.sessAddr,retryAuthorized:false,payments:[],nextCursor:null});
  if(path==="/api/session/withdraw/authorize")throw new Error("synthetic-lost-authorize-ack");
  expect(init?.method??"GET").toBe("GET");expect(path).toBe(`/api/session/withdraw/${f.p.requestId}`);
  return Response.json({preparation:f.p,signingPhase:"prepared",cancellation:null,progress:{status:"prepared",retryAuthorized:false,chainFinalityVerified:false},attestation:null,mint:null,completion:null});
 }};
 await expect(runHeadlessMainnet(["withdraw-sign",f.p.requestId,"500000","1000"],ports)).rejects.toThrow("synthetic-lost");
 await expect(runHeadlessMainnet(["withdraw-cancel",f.p.requestId],ports)).rejects.toThrow();
 await runHeadlessMainnet(["withdraw-status",f.p.requestId],ports);
 expect(requests.filter(p=>p==="/api/session/withdraw/authorize")).toHaveLength(1);
 expect(requests).not.toContain("/api/session/grant");expect(requests).not.toContain("/api/session/withdraw/cancel");expect(requests).not.toContain("/api/session/withdraw/submit");
 const file=path.join(directory,`${f.key.context.storageNamespace}.sqlite`),db=new DatabaseSync(file,{readOnly:true});
 const retained=JSON.parse(String(db.prepare("SELECT value FROM withdrawals").get()!.value));expect(retained).toMatchObject({exposed:true});expect(retained).not.toHaveProperty("signatureCipher");db.close();
 expect(log).toHaveBeenCalledWith(expect.stringContaining('"exposed":true'));
},30000);
