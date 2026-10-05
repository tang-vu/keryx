/** Real production worker/Chromium IndexedDB, synthetic authenticated transport only. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { encodeFunctionResult, recoverTypedDataAddress, concatHex, keccak256,hashTypedData,type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile";
import { browserSessionCustodyContext } from "../lib/session/browser-session-custody";
import { createSessionGrantConsentMessage,createSessionGrantSignerProofMessage } from "../lib/payments/session-grant-consent";
import {prepareWithdrawIntentForProfile} from "../lib/gateway/withdraw-intent-core";
import {withdrawTypedData,withdrawPolicySchema} from "../lib/gateway/withdraw-protocol";
import type {SessionWithdrawalPreparation} from "../lib/gateway/session-withdrawal-protocol";
import { REGISTRY_ABI } from "../lib/registry/registry-abi";
import { contentSecurityPolicy } from "../lib/security-headers";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { createSessionWithdrawalAbort, type SessionWithdrawalAbort } from "../lib/gateway/session-withdrawal-abort";
import type { BrowserSessionAuthorizationBinding } from "../lib/session/browser-session-runtime";

process.env.KERYX_NETWORK = "arc"; process.env.NEXT_PUBLIC_KERYX_NETWORK = "arc";
const origin = "https://keryx.cc", registry = `0x${"33".repeat(20)}` as Hex;
const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), creator = privateKeyToAccount(`0x${"22".repeat(32)}`);
const sourceId = "mainnet-publication", registryId = `0x${"44".repeat(32)}` as Hex;
const custody = browserSessionCustodyContext(profile, origin, owner.address);
const signature = await owner.signMessage({ message: custody.derivationMessage });
const distArgument = process.argv.indexOf("--next-dist");
const nextDist = distArgument >= 0 ? resolve(process.argv[distArgument+1]) : null;
const bundled = nextDist ? null : await build({ entryPoints: ["lib/session/mainnet-session-signer.worker.ts"], bundle: true, write: false,
  platform: "browser", format: "iife", define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify("arc"),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
    "process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS":'"300"' } });
let workerUrl = "/normal-worker.js", csp = contentSecurityPolicy(true);
const packagedFiles = new Map<string,string>();
if (nextDist) {
  const chunkPath = join(nextDist,"static","chunks");
  for (const name of readdirSync(chunkPath).filter(n=>n.endsWith(".js")))
    packagedFiles.set(`/_next/static/chunks/${name}`,readFileSync(join(chunkPath,name),"utf8"));
  const entry = [...packagedFiles].find(([,source])=>source.includes("Browser session operation refused"));
  assert.ok(entry,"Next must emit the production mainnet worker entry");
  let descriptor: {bootstrap:string;chunks:string[]} | null = null;
  for(const source of packagedFiles.values()) for(const match of source.matchAll(/\.default\("(static\/chunks\/turbopack-worker-[^"/]+\.js)",(\[[^\]]+\])\)/g)) {
    const chunks=JSON.parse(match[2]) as string[];
    if(chunks.includes(entry[0].replace("/_next/",""))) descriptor={bootstrap:match[1],chunks};
  }
  assert.ok(descriptor,"Packaged client must reference the same mainnet entry");
  workerUrl=`/_next/${descriptor.bootstrap}#params=${encodeURIComponent(JSON.stringify([
    descriptor.chunks.map(chunk=>`/_next/${chunk}`).reverse(),"","/_next/","",""]))}`;
  const manifest=JSON.parse(readFileSync(join(nextDist,"routes-manifest.json"),"utf8")) as {headers:Array<{source:string;headers:Array<{key:string;value:string}>}>};
  csp=manifest.headers.find(rule=>rule.source==="/(.*)")!.headers.find(h=>h.key.toLowerCase()==="content-security-policy")!.value;
  assert.ok(csp.includes(profile.rpcUrl));assert.ok(!csp.includes("https://rpc.testnet.arc.network"));
}
const blockHash = `0x${"66".repeat(32)}`, zeroHash = `0x${"00".repeat(32)}`;
const block = { number: "0x64", hash: blockHash, parentHash: zeroHash, nonce: "0x0000000000000000", sha3Uncles: zeroHash,
  logsBloom: `0x${"00".repeat(256)}`, transactionsRoot: zeroHash, stateRoot: zeroHash, receiptsRoot: zeroHash,
  miner: `0x${"00".repeat(20)}`, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x1",
  gasLimit: "0x1000000", gasUsed: "0x1", timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}`,
  transactions: [], uncles: [], baseFeePerGas: "0x1" };
let grant: Record<string, unknown> | null = null, authenticated = true, rpcChain = profile.chainIdHex as string;
let nonceIndex = 1, payout = creator.address, price = BigInt(1000), nextGrantReads = 0, requests = 0;
let requestedAmount = "1000";
const reqId = "00000000-0000-4000-8000-000000000002";
let epoch = "00000000-0000-4000-8000-000000000001";
let preparation:SessionWithdrawalPreparation|null=null,withdrawalPhase="prepared";
let publicationAbort:SessionWithdrawalAbort|null=null,loseAuthorizeAck=false,loseAbortAck=false,abortPosts=0,liabilityReads=0,rpcReads=0,challengeReads=0;
const challenges=new Map<string,BrowserSessionAuthorizationBinding>(),paymentJournals:unknown[]=[];
const withdrawalStatus=()=>({preparation,signingPhase:withdrawalPhase,cancellation:null,...(publicationAbort?{publicationAbort}:{}),
  progress:{status:publicationAbort?"aborted-before-publication":"prepared",retryAuthorized:false,chainFinalityVerified:false},attestation:null,mint:null,completion:null});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies([{ name: "siwe_session", value: "synthetic-cookie", url: origin, secure: true, httpOnly: true, sameSite: "Strict" }]);
  await context.route("**/*", async route => {
    requests++; const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(profile.rpcUrl).origin) {
      rpcReads++;
      assert.equal(request.method(), "POST"); const body = request.postDataJSON() as { id: number; method: string; params: unknown[] };
      assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_call","eth_getCode"].includes(body.method));
      if (body.method === "eth_call") assert.equal((body.params[0] as {to:string}).to.toLowerCase(), registry.toLowerCase());
      const result = body.method === "eth_chainId" ? rpcChain : body.method === "eth_getBlockByNumber" ? block :body.method==="eth_getCode"?"0x60006000":
        encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: creator.address, payoutWallet: payout,
          authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: price, contentCid: "", tags: "", active: true } });
      return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
    }
    assert.equal(url.origin, origin, "No unreviewed network destination");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", headers: { "content-security-policy": csp }, body: "<main>Normal browser acceptance</main>" });
    if(packagedFiles.has(url.pathname)) return route.fulfill({contentType:"application/javascript",headers:{"content-security-policy":csp},body:packagedFiles.get(url.pathname)!});
    if (url.pathname === "/normal-worker.js") return route.fulfill({ contentType: "application/javascript",
      headers: { "content-security-policy": csp }, body: bundled!.outputFiles[0].text });
    if(url.pathname==="/api/session/credit")return route.fulfill({json:{status:"known",network:profile.networkId,address:url.searchParams.get("address")?.toLowerCase(),available:"1000000"}});
    assert.ok(request.headers().cookie?.includes("siwe_session=synthetic-cookie"), "Worker must use cookie authentication");
    if (!authenticated) return route.fulfill({ status: 403, json: { error: "unavailable" } });
    if(url.pathname==="/api/session/withdraw/payments"){
      liabilityReads++;assert.equal(url.searchParams.get("sessAddr"),grant!.sessAddr);
      return route.fulfill({json:{network:profile.networkId,sessAddr:grant!.sessAddr,retryAuthorized:false,payments:paymentJournals,nextCursor:null}});
    }
    if(url.pathname==="/api/session/withdraw/authorize"){
      assert.deepEqual(request.postDataJSON(),{requestId:preparation!.requestId});withdrawalPhase="exposed";
      if(loseAuthorizeAck){loseAuthorizeAck=false;return route.abort("failed");}
      return route.fulfill({json:withdrawalStatus()});
    }
    if(url.pathname==="/api/session/withdraw/abort"){
      abortPosts++;const body=request.postDataJSON() as {requestId:string;signature:string};assert.equal(body.requestId,preparation!.requestId);
      const proof=await createSessionWithdrawalAbort(preparation!,body.signature);
      if(publicationAbort)assert.deepEqual(proof,publicationAbort,"Lost acknowledgement retries only the same original abort");
      publicationAbort=proof;withdrawalPhase="aborted_before_publication";
      if(loseAbortAck){loseAbortAck=false;return route.abort("failed");}
      return route.fulfill({json:withdrawalStatus()});
    }
    if(url.pathname===`/api/session/withdraw/${preparation?.requestId}`)return route.fulfill({json:withdrawalStatus()});
    if (url.pathname === "/api/session/grant") {
      nextGrantReads++; if (!grant) return route.fulfill({ status: 403, json: { error: "unavailable" } });
      return route.fulfill({ json: grant });
    }
    if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [{ id: sourceId, onchainId: registryId }] } });
    if (url.pathname === `/api/source/${sourceId}/item/article/preview`) {
      assert.equal(url.searchParams.get("version"), `sha256:${"77".repeat(32)}`);
      return route.fulfill({ json: { sourceId, item: { itemId: "article", itemTitle: "A reviewed mainnet article", itemUrl: "https://creator.test/article",
        contentVersion: `sha256:${"77".repeat(32)}` }, payTo: payout, listPriceMicroUsdc: price.toString() } });
    }
    assert.equal(url.pathname, "/api/ask/challenge"); assert.deepEqual(request.postDataJSON(), { reqId });challengeReads++;
    const challenge:BrowserSessionAuthorizationBinding={ sessionId: owner.address.toLowerCase(), reqId, grantEpoch: epoch,
      sessAddr: String(grant!.sessAddr), sourceId, kind: "fetch", expectedNonce: `0x${nonceIndex.toString(16).padStart(64,"0")}`,
      browserAuthorizationProtocol: "durable-v1", requirements: { scheme: "exact", network: profile.networkId,
        asset: profile.usdcAddress, amount: requestedAmount, payTo: creator.address, maxTimeoutSeconds: 604900,
        extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } },
      paymentContext: { item: { itemId: "article", itemTitle: "A reviewed mainnet article", itemUrl: "https://creator.test/article",
        contentVersion: `sha256:${"77".repeat(32)}` } } };
    challenges.set(challenge.expectedNonce,structuredClone(challenge));
    return route.fulfill({json:challenge});
  });
  type Fixture = { call(type: string, fields?: Record<string, unknown>): Promise<unknown> };
  async function mount(page: Page) {
    await page.goto(origin);
    await page.evaluate(workerUrl => {
      const worker = new Worker(workerUrl), pending = new Map<number, { resolve(v:unknown):void; reject(e:Error):void }>(); let seq=0;
      worker.onmessage = ({data:r}) => { const slot=pending.get(r.id);if(!slot)return;pending.delete(r.id);if(r.ok)slot.resolve(r.result);else slot.reject(Object.assign(new Error(r.error), { code: r.code })); };
      worker.onerror = () => { for(const slot of pending.values())slot.reject(new Error("Packaged worker failed"));pending.clear(); };
      (window as unknown as { fixture: Fixture }).fixture = { call(type,fields={}) {
        const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,type,...fields});}); } };
    },workerUrl);
  }
  const call = (page:Page,type:string,fields:Record<string,unknown>={}) => page.evaluate(({type,fields}) =>
    (window as unknown as {fixture:Fixture}).fixture.call(type,fields),{type,fields});
  // Read the actual worker's durable store; this fixture never edits its exposure or custody.
  const exposure=(page:Page,id?:string)=>page.evaluate(({namespace,id})=>new Promise<{
    total:string;nonceCount:number;barrier:string|null;exposed:boolean;hasSignature:boolean;cancelled:boolean;abortPending:boolean|null;
  }>((resolve,reject)=>{
    const opening=indexedDB.open(`${namespace}-authorizations`,1);
    opening.onupgradeneeded=()=>opening.transaction!.abort();opening.onerror=()=>reject(new Error("Worker exposure store missing"));
    opening.onsuccess=()=>{
      const db=opening.result,tx=db.transaction(["nonces","grants"],"readonly"),grants=tx.objectStore("grants");
      const total=grants.get("signed-total"),count=tx.objectStore("nonces").count(),barrier=grants.get("active-withdrawal"),row=id?grants.get(`withdrawal:${id}`):null;
      tx.oncomplete=()=>{db.close();resolve({total:total.result?.total??"0",nonceCount:count.result,barrier:barrier.result??null,
        exposed:!!row?.result?.exposed,hasSignature:!!row?.result?.signature,cancelled:!!row?.result?.cancelled,
        abortPending:row?.result?.publicationAbort?.pending??null});};
      tx.onabort=tx.onerror=()=>{db.close();reject(new Error("Worker exposure read failed"));};
    };
  }),{namespace:custody.storageNamespace,id});
  const first=await context.newPage();await mount(first);
  assert.equal((await call(first,"initializeOwner",{owner:owner.address}) as {derivationMessage:string}).derivationMessage,custody.derivationMessage);
  assert.equal(await first.evaluate(async () => {
    try { await (window as unknown as { fixture: Fixture }).fixture.call("restoreRetained"); return null; }
    catch (error) { return (error as { code?: string }).code; }
  }), "session_custody_missing", "Only empty retained storage can permit initial derivation");
  const derived=await call(first,"deriveFromSignature",{signature}) as {address:Hex};
  const consent={format:"keryx-session-grant-consent-v1" as const,network:profile.networkId,origin,ownerAddr:owner.address.toLowerCase(),
    sessAddr:derived.address.toLowerCase(),grantEpoch:epoch,capMicroUsdc:"2000",expirySeconds:String(Math.floor(Date.now()/1000)+3600)};
  const ownerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)});
  const sessionSignature=await call(first,"signGrantConsentProof",{consent,ownerSignature});
  grant={active:true,sessionId:consent.ownerAddr,ownerAddr:consent.ownerAddr,sessAddr:consent.sessAddr,
    network:consent.network,origin,grantEpoch:epoch,capMicroUsdc:consent.capMicroUsdc,spentMicroUsdc:"0",consent,ownerSignature,sessionSignature};
  const authorized=await call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}) as {paymentHeader:string};
  const payment=JSON.parse(atob(authorized.paymentHeader));
  assert.equal((await recoverTypedDataAddress({domain:{name:"GatewayWalletBatched",version:"1",chainId:5042,verifyingContract:profile.gatewayWallet},
    types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
      {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},primaryType:"TransferWithAuthorization",
    message:payment.authorization,signature:payment.signature})).toLowerCase(),consent.sessAddr);
  assert.ok(nextGrantReads >= 3,"Grant must be reauthenticated after crypto");
  await call(first,"lock");await mount(first);await call(first,"initializeOwner",{owner:owner.address});
  assert.equal((await call(first,"restoreRetained") as {address:string}).address,derived.address);
  await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}));
  const second=await context.newPage();await mount(second);await call(second,"initializeOwner",{owner:owner.address});
  assert.equal((await call(second,"restoreRetained") as {address:string}).address,derived.address);
  nonceIndex=2;
  const race=await Promise.allSettled([call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),call(second,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}})]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1,"Atomic IDB must admit nonce once across tabs");
  nonceIndex=3;await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),"Persisted owner cap exhausted");
  epoch="00000000-0000-4000-8000-000000000003";
  const renewed={...consent,grantEpoch:epoch};
  const renewedOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(renewed,profile)});
  const renewedSessionSignature=await call(first,"signGrantConsentProof",{consent:renewed,ownerSignature:renewedOwnerSignature});
  grant={...grant,grantEpoch:epoch,consent:renewed,ownerSignature:renewedOwnerSignature,sessionSignature:renewedSessionSignature};
  await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),"New epoch cannot reset lifetime signer exposure");
  epoch="00000000-0000-4000-8000-000000000004";
  const increased={...consent,grantEpoch:epoch,capMicroUsdc:"3000"};
  const increasedOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(increased,profile)});
  const increasedSessionSignature=await call(first,"signGrantConsentProof",{consent:increased,ownerSignature:increasedOwnerSignature});
  grant={...grant,grantEpoch:epoch,capMicroUsdc:"3000",consent:increased,ownerSignature:increasedOwnerSignature,sessionSignature:increasedSessionSignature};
  assert.ok((await call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}) as {paymentHeader:string}).paymentHeader,"Explicit increased cumulative owner cap permits only the additional capacity");
  const failedOriginal=challenges.get(payment.authorization.nonce)!;
  assert.ok(failedOriginal,"Retain the synthetic original that actually returned a browser signature");
  paymentJournals.push({nonce:failedOriginal.expectedNonce,sessionId:failedOriginal.sessionId,signer:failedOriginal.sessAddr,
    requestId:failedOriginal.reqId,grantEpoch:failedOriginal.grantEpoch,phase:"failed",requirements:failedOriginal.requirements,
    paymentContext:failedOriginal.paymentContext,signedHeaderHash:createHash("sha256").update(authorized.paymentHeader).digest("hex"),
    payment:{authorizationId:failedOriginal.expectedNonce,payer:failedOriginal.sessAddr,payee:failedOriginal.requirements.payTo,
      network:profile.networkId,sourceId:failedOriginal.sourceId,kind:failedOriginal.kind,amountUsdc:0.001,
      settled:false,settlementStatus:"failed",txHash:"synthetic-original-terminal-failure"}});
  nonceIndex=4;const readsBeforeRecovery=liabilityReads;
  assert.ok((await call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000012",budgetMicroUsdc:"10000"}}) as {paymentHeader:string}).paymentHeader,
    "Actual worker retries local admission after matching the original terminal failure");
  assert.ok(liabilityReads>readsBeforeRecovery,"The production worker must wire failure reconciliation into admission");
  assert.equal((await exposure(first)).total,"3000","Only the failed 1000 micros were restored and reused");
  nonceIndex=40;
  await assert.rejects(call(second,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000013",budgetMicroUsdc:"10000"}}),
    "Another tab cannot release the same terminal failure twice");
  assert.equal((await exposure(second)).total,"3000");
  authenticated=false;await assert.rejects(call(first,"bindGrant"));
  await call(first,"lock");assert.equal((await call(first,"restoreRetained") as {address:string}).address,derived.address,"Expired/revoked auth cannot erase recovery");
  authenticated=true;rpcChain="0x4cef52";nonceIndex=4;
  await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),"Wrong RPC chain refuses before signing");
  rpcChain=profile.chainIdHex;payout=owner.address;await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),"Source-owned payout must match");
  payout=creator.address;price=BigInt(2000);await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000008",budgetMicroUsdc:"10000"}}),"Exact registry price must match");
  epoch="00000000-0000-4000-8000-000000000005";
  const larger={...consent,grantEpoch:epoch,capMicroUsdc:"500000"};
  const largerOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(larger,profile)});
  const largerSessionSignature=await call(first,"signGrantConsentProof",{consent:larger,ownerSignature:largerOwnerSignature});
  grant={...grant,grantEpoch:epoch,capMicroUsdc:larger.capMicroUsdc,consent:larger,ownerSignature:largerOwnerSignature,sessionSignature:largerSessionSignature};
  const question={id:"00000000-0000-4000-8000-000000000009",budgetMicroUsdc:"10000"};
  price=BigInt(11000);requestedAmount="11000";nonceIndex=5;
  await assert.rejects(call(first,"authorizePayment",{reqId,question}),"A .01 question refuses .011 even with .5 lifetime consent");
  price=BigInt(6000);requestedAmount="6000";
  assert.ok((await call(first,"authorizePayment",{reqId,question}) as {paymentHeader:string}).paymentHeader);
  nonceIndex=6;price=BigInt(4000);requestedAmount="4000";
  assert.ok((await call(second,"authorizePayment",{reqId,question}) as {paymentHeader:string}).paymentHeader,"Both tabs share the same .01 question sum");
  nonceIndex=7;price=BigInt(1);requestedAmount="1";
  await assert.rejects(call(first,"authorizePayment",{reqId,question}),"A further micro-USDC exceeds the original question budget");
  await assert.rejects(call(second,"authorizePayment",{reqId,question:{...question,budgetMicroUsdc:"500000"}}),"Same question cannot enlarge its immutable cap");
  const other=privateKeyToAccount(`0x${"88".repeat(32)}`);
  await assert.rejects(call(first,"signGrantConsentProof",{consent:{...consent,ownerAddr:other.address.toLowerCase()},ownerSignature}));
  await assert.rejects(call(first,"signTransaction",{transaction:{}}));await assert.rejects(call(first,"signTypedData",{payload:{}}));
  const expired={...consent,expirySeconds:"1"},fixtureAccount=privateKeyToAccount(keccak256(concatHex([custody.digest,signature])));
  const burnIntent={...prepareWithdrawIntentForProfile(profile,expired.sessAddr,"100000",expired.ownerAddr,"1000"),maxBlockHeight:"110"};
  preparation={format:"keryx-session-withdrawal-preparation-v1",network:profile.networkId,requestId:hashTypedData(withdrawTypedData(burnIntent)),
    ownerAddr:expired.ownerAddr,sessAddr:expired.sessAddr,grantEpoch:expired.grantEpoch,
    authorization:{consent:expired,ownerSignature:await owner.signMessage({message:createSessionGrantConsentMessage(expired,profile)}),
      sessionSignature:await fixtureAccount.signMessage({message:createSessionGrantSignerProofMessage(expired,profile)})},burnIntent,
    policy:withdrawPolicySchema.parse({owner:expired.sessAddr,recipient:expired.ownerAddr,domain:profile.cctpDomain,gatewayWallet:profile.gatewayWallet,
      gatewayMinter:profile.gatewayMinter,asset:profile.usdcAddress,maxValueMicros:"100000",maxFeeMicros:"1000"}),
    balance:{availableMicroUsdc:"1000000",heldPaymentMicroUsdc:"13000",heldWithdrawalMicroUsdc:"0",confirmedSpentMicroUsdc:"0",maxFeeMicroUsdc:"1000"},
    height:{minimumBlockHeight:"110",maximumBlockHeight:"400",observedBlockNumber:"100",observedBlockHash:blockHash,observedAt:new Date().toISOString()}};
  await call(first,"lock");await call(first,"restoreRetained");
  await assert.rejects(call(first,"signGrantConsentProof",{consent:expired,ownerSignature:preparation.authorization.ownerSignature}),"Expired payment permission stays closed");
  const interrupted=preparation;loseAuthorizeAck=true;
  await assert.rejects(call(first,"signWithdrawal",{requestId:interrupted.requestId,review:{amountMicroUsdc:"100000",maxFeeMicroUsdc:"1000"}}),
    "Synthetic authorize acknowledgement loss interrupts the real worker before burn publication");
  const interruptedExposure=await exposure(first,interrupted.requestId);
  assert.equal(withdrawalPhase,"exposed");assert.equal(interruptedExposure.barrier,interrupted.requestId);
  assert.equal(interruptedExposure.exposed,true);assert.equal(interruptedExposure.hasSignature,false);
  block.number="0x6f"; // The original finite burn height (110) has now passed.
  loseAbortAck=true;const rpcBeforeAbort=rpcReads;
  await assert.rejects(call(first,"abortWithdrawal",{requestId:interrupted.requestId}),"Lost abort ACK retains the local publication fence");
  assert.equal(abortPosts,1,"The actual worker transport must reach the abort endpoint before synthetic ACK loss");
  assert.equal(withdrawalPhase,"aborted_before_publication");assert.equal(loseAbortAck,false);
  const pendingAbort=await exposure(first,interrupted.requestId);
  assert.equal(pendingAbort.abortPending,true);assert.equal(pendingAbort.cancelled,true);
  assert.equal(pendingAbort.hasSignature,false);assert.equal(pendingAbort.barrier,interrupted.requestId);
  assert.equal(rpcReads,rpcBeforeAbort,"Publication abort needs no new burn, mint or expired-height observation");
  nonceIndex=8;
  await assert.rejects(call(second,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000014",budgetMicroUsdc:"10000"}}),
    "A pending abort acknowledgement still blocks payment admission in other tabs");
  assert.equal((await exposure(second)).nonceCount,pendingAbort.nonceCount);
  await call(first,"lock");await mount(first);await call(first,"initializeOwner",{owner:owner.address});await call(first,"restoreRetained");
  assert.equal((await exposure(first,interrupted.requestId)).abortPending,true,"Worker restart preserves the pending abort");
  assert.deepEqual(await call(first,"abortWithdrawal",{requestId:interrupted.requestId}),{requestId:interrupted.requestId,abortedBeforePublication:true});
  assert.equal(abortPosts,2,"Retry acknowledges the original nonfinancial abort only");
  const finishedAbort=await exposure(first,interrupted.requestId);
  assert.equal(finishedAbort.abortPending,false);assert.equal(finishedAbort.cancelled,true);assert.equal(finishedAbort.exposed,true);
  assert.equal(finishedAbort.hasSignature,false);assert.equal(finishedAbort.barrier,null);
  // Upgrade only the signed public policy. The emitted worker keeps the same original
  // custody, nonce journal and lifetime exposure already exercised by the v1 cases.
  const beforeResearch=await exposure(first);assert.equal(beforeResearch.total,"13000");
  let researchEpochIndex=16;
  async function publishResearchBudget(capMicroUsdc:string) {
    epoch=`00000000-0000-4000-8000-${String(researchEpochIndex++).padStart(12,"0")}`;
    const researchConsent={...consent,format:"keryx-session-grant-consent-v2" as const,grantEpoch:epoch,capMicroUsdc,
      durationSeconds:604800,questionCapMicroUsdc:"1000",expirySeconds:String(Math.floor(Date.now()/1000)+604800)};
    const researchOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(researchConsent,profile)});
    const researchSessionSignature=await call(first,"signGrantConsentProof",{consent:researchConsent,ownerSignature:researchOwnerSignature});
    grant={...grant,grantEpoch:epoch,capMicroUsdc,spentMicroUsdc:(await exposure(first)).total,consent:researchConsent,
      ownerSignature:researchOwnerSignature,sessionSignature:researchSessionSignature};
    assert.deepEqual((await call(first,"bindGrant") as {consent:unknown}).consent,researchConsent,
      "Actual emitted worker verifies the owner and session proofs for an explicit seven-day budget");
    return researchConsent;
  }
  await publishResearchBudget("15000");
  const researchQuestion={id:"00000000-0000-4000-8000-000000000015",budgetMicroUsdc:"1000"};
  price=BigInt(1000);requestedAmount="1000";nonceIndex=50;
  const challengesBeforeOversized=challengeReads;
  await assert.rejects(call(first,"authorizePayment",{reqId,question:{...researchQuestion,budgetMicroUsdc:"1001"}}),
    "Signed per-question maximum refuses even when cumulative capacity is larger");
  assert.equal(challengeReads,challengesBeforeOversized,"Oversized questions refuse before authenticated challenge lookup");
  assert.deepEqual(await exposure(first),beforeResearch,"Policy publication and refused questions cannot reset retained exposure");
  assert.ok((await call(first,"authorizePayment",{reqId,question:researchQuestion}) as {paymentHeader:string}).paymentHeader);
  assert.equal((await exposure(first)).total,"14000");
  await publishResearchBudget("15000");
  const renewedResearchQuestion={id:"00000000-0000-4000-8000-000000000017",budgetMicroUsdc:"1000"};
  await assert.rejects(call(second,"authorizePayment",{reqId,question:renewedResearchQuestion}),
    "Renewal cannot reuse a v2 nonce even though its fresh question and remaining capacity fit");
  nonceIndex=2;
  await assert.rejects(call(first,"authorizePayment",{reqId,question:renewedResearchQuestion}),
    "A v1 nonce remains consumed after the v2 transition and renewal");
  assert.equal((await exposure(second)).total,"14000");
  nonceIndex=51;
  assert.ok((await call(second,"authorizePayment",{reqId,question:renewedResearchQuestion}) as {paymentHeader:string}).paymentHeader);
  assert.equal((await exposure(first)).total,"15000");
  nonceIndex=52;
  await assert.rejects(call(first,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000018",budgetMicroUsdc:"1000"}}),
    "Renewed seven-day budgets retain the exact lifetime ceiling across tabs");
  await call(first,"lock");await mount(first);await call(first,"initializeOwner",{owner:owner.address});await call(first,"restoreRetained");
  assert.equal((await exposure(first)).total,"15000","Reload and lock keep the v1 plus v2 lifetime exposure");
  await call(first,"bindGrant");
  // Explicitly signed spare capacity lets the later cashout test isolate its withdrawal
  // barrier rather than reject because this newly exercised research cap is exhausted.
  await publishResearchBudget("20000");
  // A new reviewed original remains independently signable. Reset only the synthetic
  // chain snapshot and server fixture; leave both workers' actual retained history intact.
  block.number="0x64";withdrawalPhase="prepared";publicationAbort=null;
  const freshBurn={...prepareWithdrawIntentForProfile(profile,expired.sessAddr,"100000",expired.ownerAddr,"1000"),maxBlockHeight:"110"};
  preparation={...interrupted,burnIntent:freshBurn,requestId:hashTypedData(withdrawTypedData(freshBurn)),
    balance:{...interrupted.balance,heldPaymentMicroUsdc:"15000"}};
  assert.notEqual(preparation.requestId,interrupted.requestId);
  const cashout=await call(first,"signWithdrawal",{requestId:preparation.requestId,review:{amountMicroUsdc:"100000",maxFeeMicroUsdc:"1000"}}) as {signature:Hex};
  assert.equal((await recoverTypedDataAddress({...withdrawTypedData(freshBurn),signature:cashout.signature})).toLowerCase(),expired.sessAddr);
  const abortPostsBeforePublished=abortPosts;
  await assert.rejects(call(first,"abortWithdrawal",{requestId:preparation.requestId}),"An already returned burn signature can never be aborted");
  assert.equal(abortPosts,abortPostsBeforePublished,"Published burns refuse before any abort request");
  assert.equal((await exposure(first,preparation.requestId)).hasSignature,true);
  nonceIndex=53;await assert.rejects(call(second,"authorizePayment",{reqId,question:{id:"00000000-0000-4000-8000-000000000019",budgetMicroUsdc:"1000"}}),"Retained withdrawal barrier blocks other tabs with otherwise available research capacity");
  assert.equal(withdrawalPhase,"exposed");
  console.log(JSON.stringify({status:"passed",realChromium:true,realIndexedDB:true,worker:nextDist?"Next production packaged":"production source",requests,
    authenticatedChallenge:true,ownerAndSessionProof:true,nonceAndCapRetained:true,logoutRecovery:true,expiredOwnerCashout:true,
    failedPaymentCapacityRecovery:true,interruptedSigningAbort:true,abortLostAckRestart:true,publishedBurnAbortRefused:true,
    sevenDayResearchBudget:true,signedQuestionMaximum:true,v1AndV2NonceRetention:true,researchRenewalCapRetained:true,liveFunds:false}));
} finally { await browser.close(); }
