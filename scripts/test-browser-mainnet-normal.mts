/** Real production worker/Chromium IndexedDB, synthetic authenticated transport only. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { encodeFunctionResult, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile";
import { browserSessionCustodyContext } from "../lib/session/browser-session-custody";
import { createSessionGrantConsentMessage } from "../lib/payments/session-grant-consent";
import { REGISTRY_ABI } from "../lib/registry/registry-abi";
import { contentSecurityPolicy } from "../lib/security-headers";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

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
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } });
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
const reqId = "00000000-0000-4000-8000-000000000002";
let epoch = "00000000-0000-4000-8000-000000000001";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies([{ name: "siwe_session", value: "synthetic-cookie", url: origin, secure: true, httpOnly: true, sameSite: "Strict" }]);
  await context.route("**/*", async route => {
    requests++; const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(profile.rpcUrl).origin) {
      assert.equal(request.method(), "POST"); const body = request.postDataJSON() as { id: number; method: string; params: unknown[] };
      assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_call"].includes(body.method));
      if (body.method === "eth_call") assert.equal((body.params[0] as {to:string}).to.toLowerCase(), registry.toLowerCase());
      const result = body.method === "eth_chainId" ? rpcChain : body.method === "eth_getBlockByNumber" ? block :
        encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: creator.address, payoutWallet: payout,
          authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: price, contentCid: "", tags: "", active: true } });
      return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
    }
    assert.equal(url.origin, origin, "No unreviewed network destination");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", headers: { "content-security-policy": csp }, body: "<main>Normal browser acceptance</main>" });
    if(packagedFiles.has(url.pathname)) return route.fulfill({contentType:"application/javascript",headers:{"content-security-policy":csp},body:packagedFiles.get(url.pathname)!});
    if (url.pathname === "/normal-worker.js") return route.fulfill({ contentType: "application/javascript",
      headers: { "content-security-policy": csp }, body: bundled!.outputFiles[0].text });
    assert.ok(request.headers().cookie?.includes("siwe_session=synthetic-cookie"), "Worker must use cookie authentication");
    if (!authenticated) return route.fulfill({ status: 403, json: { error: "unavailable" } });
    if (url.pathname === "/api/session/grant") {
      nextGrantReads++; if (!grant) return route.fulfill({ status: 403, json: { error: "unavailable" } });
      return route.fulfill({ json: grant });
    }
    if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [{ id: sourceId, onchainId: registryId }] } });
    assert.equal(url.pathname, "/api/ask/challenge"); assert.deepEqual(request.postDataJSON(), { reqId });
    return route.fulfill({ json: { sessionId: owner.address.toLowerCase(), reqId, grantEpoch: epoch,
      sessAddr: grant!.sessAddr, sourceId, kind: "fetch", expectedNonce: `0x${nonceIndex.toString(16).padStart(64,"0")}`,
      browserAuthorizationProtocol: "durable-v1", requirements: { scheme: "exact", network: profile.networkId,
        asset: profile.usdcAddress, amount: "1000", payTo: creator.address, maxTimeoutSeconds: 604900,
        extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } },
      paymentContext: { item: { itemId: "article", itemTitle: "A reviewed mainnet article", itemUrl: "https://creator.test/article",
        contentVersion: `sha256:${"77".repeat(32)}` } } } });
  });
  type Fixture = { call(type: string, fields?: Record<string, unknown>): Promise<unknown> };
  async function mount(page: Page) {
    await page.goto(origin);
    await page.evaluate(workerUrl => {
      const worker = new Worker(workerUrl), pending = new Map<number, { resolve(v:unknown):void; reject(e:Error):void }>(); let seq=0;
      worker.onmessage = ({data:r}) => { const slot=pending.get(r.id);if(!slot)return;pending.delete(r.id);if(r.ok)slot.resolve(r.result);else slot.reject(new Error(r.error)); };
      worker.onerror = () => { for(const slot of pending.values())slot.reject(new Error("Packaged worker failed"));pending.clear(); };
      (window as unknown as { fixture: Fixture }).fixture = { call(type,fields={}) {
        const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,type,...fields});}); } };
    },workerUrl);
  }
  const call = (page:Page,type:string,fields:Record<string,unknown>={}) => page.evaluate(({type,fields}) =>
    (window as unknown as {fixture:Fixture}).fixture.call(type,fields),{type,fields});
  const first=await context.newPage();await mount(first);
  assert.equal((await call(first,"initializeOwner",{owner:owner.address}) as {derivationMessage:string}).derivationMessage,custody.derivationMessage);
  const derived=await call(first,"deriveFromSignature",{signature}) as {address:Hex};
  const consent={format:"keryx-session-grant-consent-v1" as const,network:profile.networkId,origin,ownerAddr:owner.address.toLowerCase(),
    sessAddr:derived.address.toLowerCase(),grantEpoch:epoch,capMicroUsdc:"2000",expirySeconds:String(Math.floor(Date.now()/1000)+3600)};
  const ownerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)});
  const sessionSignature=await call(first,"signGrantConsentProof",{consent,ownerSignature});
  grant={active:true,sessionId:consent.ownerAddr,ownerAddr:consent.ownerAddr,sessAddr:consent.sessAddr,
    network:consent.network,origin,grantEpoch:epoch,capMicroUsdc:consent.capMicroUsdc,consent,ownerSignature,sessionSignature};
  const authorized=await call(first,"authorizePayment",{reqId}) as {paymentHeader:string};
  const payment=JSON.parse(atob(authorized.paymentHeader));
  assert.equal((await recoverTypedDataAddress({domain:{name:"GatewayWalletBatched",version:"1",chainId:5042,verifyingContract:profile.gatewayWallet},
    types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
      {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},primaryType:"TransferWithAuthorization",
    message:payment.authorization,signature:payment.signature})).toLowerCase(),consent.sessAddr);
  assert.ok(nextGrantReads >= 3,"Grant must be reauthenticated after crypto");
  await call(first,"lock");await mount(first);await call(first,"initializeOwner",{owner:owner.address});
  assert.equal((await call(first,"restoreRetained") as {address:string}).address,derived.address);
  await assert.rejects(call(first,"authorizePayment",{reqId}));
  const second=await context.newPage();await mount(second);await call(second,"initializeOwner",{owner:owner.address});
  assert.equal((await call(second,"restoreRetained") as {address:string}).address,derived.address);
  nonceIndex=2;
  const race=await Promise.allSettled([call(first,"authorizePayment",{reqId}),call(second,"authorizePayment",{reqId})]);
  assert.equal(race.filter(r=>r.status==="fulfilled").length,1,"Atomic IDB must admit nonce once across tabs");
  nonceIndex=3;await assert.rejects(call(first,"authorizePayment",{reqId}),"Persisted owner cap exhausted");
  epoch="00000000-0000-4000-8000-000000000003";
  const renewed={...consent,grantEpoch:epoch};
  const renewedOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(renewed,profile)});
  const renewedSessionSignature=await call(first,"signGrantConsentProof",{consent:renewed,ownerSignature:renewedOwnerSignature});
  grant={...grant,grantEpoch:epoch,consent:renewed,ownerSignature:renewedOwnerSignature,sessionSignature:renewedSessionSignature};
  await assert.rejects(call(first,"authorizePayment",{reqId}),"New epoch cannot reset lifetime signer exposure");
  epoch="00000000-0000-4000-8000-000000000004";
  const increased={...consent,grantEpoch:epoch,capMicroUsdc:"3000"};
  const increasedOwnerSignature=await owner.signMessage({message:createSessionGrantConsentMessage(increased,profile)});
  const increasedSessionSignature=await call(first,"signGrantConsentProof",{consent:increased,ownerSignature:increasedOwnerSignature});
  grant={...grant,grantEpoch:epoch,capMicroUsdc:"3000",consent:increased,ownerSignature:increasedOwnerSignature,sessionSignature:increasedSessionSignature};
  assert.ok((await call(first,"authorizePayment",{reqId}) as {paymentHeader:string}).paymentHeader,"Explicit increased cumulative owner cap permits only the additional capacity");
  authenticated=false;await assert.rejects(call(first,"bindGrant"));
  await call(first,"lock");assert.equal((await call(first,"restoreRetained") as {address:string}).address,derived.address,"Expired/revoked auth cannot erase recovery");
  authenticated=true;rpcChain="0x4cef52";nonceIndex=4;
  await assert.rejects(call(first,"authorizePayment",{reqId}),"Wrong RPC chain refuses before signing");
  rpcChain=profile.chainIdHex;payout=owner.address;await assert.rejects(call(first,"authorizePayment",{reqId}),"Source-owned payout must match");
  payout=creator.address;price=BigInt(2000);await assert.rejects(call(first,"authorizePayment",{reqId}),"Exact registry price must match");
  const other=privateKeyToAccount(`0x${"88".repeat(32)}`);
  await assert.rejects(call(first,"signGrantConsentProof",{consent:{...consent,ownerAddr:other.address.toLowerCase()},ownerSignature}));
  await assert.rejects(call(first,"signTransaction",{transaction:{}}));await assert.rejects(call(first,"signTypedData",{payload:{}}));
  console.log(JSON.stringify({status:"passed",realChromium:true,realIndexedDB:true,worker:nextDist?"Next production packaged":"production source",requests,
    authenticatedChallenge:true,ownerAndSessionProof:true,nonceAndCapRetained:true,logoutRecovery:true,liveFunds:false}));
} finally { await browser.close(); }
