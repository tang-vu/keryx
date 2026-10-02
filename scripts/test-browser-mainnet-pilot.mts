/** Actual dedicated worker + renderer + native IDB/crypto. Every HTTP request is intercepted.
 * Synthetic owner/registry/delegation/cookie/settlement. No key, transaction or funds leave fixture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionResult, recoverMessageAddress, recoverTypedDataAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile.ts";
import { REGISTRY_ABI } from "../lib/registry/registry-abi.ts";
import { createIsolatedSessionContext } from "../lib/session/isolated-session-context.ts";
import { createPilotGrantMessage, verifyPublicMainnetEnrollment, publicMainnetEnrollmentDigest } from "../lib/mainnet-pilot/public-enrollment.ts";
const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), creator = privateKeyToAccount(`0x${"22".repeat(32)}`);
const origin = "https://mainnet-pilot.test", sourceId = `0x${"33".repeat(32)}`;
const artifact = { format: "keryx-mainnet-enrollment-v1", candidateDigest: "44".repeat(32), releaseCommit: "55".repeat(20), origin,
  network: profile, registryAddress: `0x${"66".repeat(20)}`, invitedBuyers: [owner.address.toLowerCase()],
  retainedTestnetSigners: [`0x${"77".repeat(20)}`], approvedSourceIds: [sourceId],
  approvedCreatorAddresses: [creator.address.toLowerCase()], approvedPayoutAddresses: [creator.address.toLowerCase()],
  limits: { totalMicros: 10000, perBuyerMicros: 10000, perAskMicros: 10000, perPaymentMicros: 10000, maxAsks: 20 },
  epoch: "renderer-fixture", expiresAtSeconds: Math.floor(Date.now()/1000)+3600 };
const digest = await publicMainnetEnrollmentDigest(artifact), verified = await verifyPublicMainnetEnrollment(artifact, digest, origin);
const signerContext = createIsolatedSessionContext({ profile, origin, owner: owner.address, epoch: artifact.epoch,
  candidateDigest: `0x${digest}`, maxPaymentMicroUsdc: "10000", expiresAtSeconds: artifact.expiresAtSeconds });
const define = { "process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_JSON": JSON.stringify(JSON.stringify(artifact)),
  "process.env.NEXT_PUBLIC_KERYX_MAINNET_ENROLLMENT_DIGEST": JSON.stringify(digest), "process.env.NODE_ENV": '"production"' };
const worker = await build({ entryPoints: ["lib/session/mainnet-pilot-signer.worker.ts"], bundle: true, write: false, platform: "browser", format: "iife", define,
  plugins: [{ name: "fixture-delayed-cryptography", setup(builder) {
    // Delay the actual signing await to force other-tab revocation; no production selector.
    builder.onLoad({ filter: /isolated-session-signer\.ts$/ }, args => ({ loader: "ts", contents:
      readFileSync(args.path,"utf8").replace("const signature = await signer.signTypedData", "await new Promise(resolve => setTimeout(resolve, 150)); const signature = await signer.signTypedData") }));
  } }] });
const renderer = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Client from './components/keryx/mainnet-pilot-client';createRoot(document.getElementById('root')).render(<Client/>);` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define,
  tsconfig: "tsconfig.json", plugins: [{ name: "fixture-worker-url", setup(builder) {
    builder.onLoad({ filter: /browser-signer-client\.ts$/ }, args => ({ loader: "ts",
      contents: readFileSync(args.path,"utf8").replace('new URL("../session/mainnet-pilot-signer.worker.ts", import.meta.url)', 'new URL("/worker.js", location.origin)') }));
  } }] });
let cookie = false, signerAddress = "", grantEpoch = "", challengeReads = 0, previewReads = 0, grantSignatures = 0;
let mode = "valid", requestCounter = 0;
let signingGrantReads = 0, revokeDuringSign: (()=>Promise<void>) | null = null;
let issued: { owner: string; signer: string; grantEpoch: string; capMicroUsdc: string; expirySeconds: string; enrollmentDigest: string } | null = null;
let reqId = "", nonce = "", submitted: string | null = null;
const item = { itemId: "fixture-article", itemTitle: "Synthetic item", itemUrl: `${origin}/article`, contentVersion: `sha256:${"88".repeat(32)}`,
  contentReceipt: { deliveryKind: "full_text", storageMode: "db_encrypted", plaintextBytes: 42, bodyHash: `0x${"99".repeat(32)}` } };
const requirements = { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress, amount: "2000", payTo: creator.address,
  maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } };
const block = { number: "0x10", hash: `0x${"aa".repeat(32)}`, parentHash: `0x${"bb".repeat(32)}`, nonce: "0x0000000000000000",
  sha3Uncles: `0x${"00".repeat(32)}`, logsBloom: `0x${"00".repeat(256)}`, transactionsRoot: `0x${"00".repeat(32)}`, stateRoot: `0x${"00".repeat(32)}`,
  receiptsRoot: `0x${"00".repeat(32)}`, miner: creator.address, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x1",
  gasLimit: "0x1", gasUsed: "0x0", timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}`, transactions: [], uncles: [], baseFeePerGas: "0x1" };
const record = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: creator.address, payoutWallet: creator.address,
  authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(2000), contentCid: "", tags: "fixture", active: true } });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.exposeFunction("fixtureWallet", async (method: string, params: unknown[]) => {
    if (["eth_requestAccounts","eth_accounts"].includes(method)) return [owner.address];
    if (method === "personal_sign") {
      const message = Buffer.from(String(params[0]).slice(2), "hex").toString("utf8");
      if (message === signerContext.derivationMessage) return owner.signMessage({ message });
      assert.ok(issued); const { enrollmentDigest: _d, ...fields } = issued;
      assert.equal(message, createPilotGrantMessage(verified, fields)); grantSignatures++; return owner.signMessage({ message });
    }
    throw new Error(`forbidden fixture wallet method ${method}`);
  });
  await context.addInitScript("window.ethereum={request:({method,params})=>window.fixtureWallet(method,params??[])};window.__name=(fn)=>fn;");
  await context.route("**/*", async route => {
    requestCounter++; const request = route.request(), url = new URL(request.url());
    const json = (body: unknown, status = 200, extra: Record<string,string> = {}) => route.fulfill({ status, contentType: "application/json", headers: extra, body: JSON.stringify(body) });
    if (url.origin === new URL(profile.rpcUrl).origin) {
      assert.equal(request.method(), "POST"); const rpc = request.postDataJSON(); assert.ok(!Array.isArray(rpc));
      let result: unknown;
      if (rpc.method === "eth_chainId") result = mode === "wrong-chain" ? "0x4cef52" : profile.chainIdHex;
      else if (rpc.method === "eth_getBlockByNumber") result = mode === "changed-block" && rpc.params[0] === "0x10" ? {...block,hash:`0x${"cc".repeat(32)}`} : block;
      else if (rpc.method === "eth_call") { assert.equal(rpc.params[0].to.toLowerCase(), artifact.registryAddress); assert.equal(rpc.params[1], "0x10"); result = record; }
      else throw new Error(`forbidden RPC method ${rpc.method}`);
      return json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    assert.equal(url.origin, origin, "no other network allowed");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/renderer.js"></script>' });
    if (url.pathname === "/renderer.js") return route.fulfill({ contentType: "application/javascript", body: renderer.outputFiles[0].text });
    if (url.pathname === "/worker.js") return route.fulfill({ contentType: "application/javascript", body: worker.outputFiles[0].text });
    if (url.pathname === "/api/mainnet-pilot/grant/challenge") {
      assert.equal(request.method(), "POST"); const body = request.postDataJSON(); assert.equal(body.owner, owner.address.toLowerCase());
      signerAddress = body.signer; grantEpoch = crypto.randomUUID(); issued = { owner: body.owner, signer: signerAddress, grantEpoch,
        capMicroUsdc: "10000", expirySeconds: String(artifact.expiresAtSeconds), enrollmentDigest: digest }; return json(issued);
    }
    if (url.pathname === "/api/mainnet-pilot/grant" && request.method() === "POST") {
      const { signature, enrollmentDigest, ...fields } = request.postDataJSON(); assert.equal(enrollmentDigest, digest); assert.ok(issued);
      assert.deepEqual(fields, (({enrollmentDigest:_digest,...f})=>f)(issued));
      assert.equal((await recoverMessageAddress({ message: createPilotGrantMessage(verified, fields), signature })).toLowerCase(), owner.address.toLowerCase());
      cookie = true; return json(issued,200,{ "Set-Cookie": "__Host-keryx-pilot-session=fixture-only; Path=/; Secure; HttpOnly; SameSite=Strict" });
    }
    const authenticated = cookie && request.headers().cookie?.includes("__Host-keryx-pilot-session=fixture-only");
    if (!authenticated || (mode === "auth-outage" && url.pathname === "/api/mainnet-pilot/grant")) return json({ error: "closed" },403);
    if (url.pathname === "/api/mainnet-pilot/grant") {
      if (request.method() === "DELETE") { cookie = false; return json({ revoked: true, retainedAuthorizations: true },200,
        { "Set-Cookie": "__Host-keryx-pilot-session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict" }); }
      signingGrantReads++;
      const result = await json(issued);
      if (mode === "revoke-during-sign" && signingGrantReads === 2) setTimeout(()=>{void revokeDuringSign!();},30);
      return result;
    }
    if (url.pathname === "/api/mainnet-pilot/ask") {
      reqId = crypto.randomUUID(); nonce = `0x${String(requestCounter).padStart(64,"0")}`; submitted = null; signingGrantReads=0;
      return route.fulfill({ contentType: "text/event-stream", body:
        `event: sign-request\ndata: ${JSON.stringify({ reqId, requirements: { payTo: "forged-page-payee" } })}\n\n`+
        `event: done\ndata: ${JSON.stringify({ id: reqId, answer: "Synthetic cited answer survives a refused payment leg.", citations: [{sourceId}], payments: [], simulation: true })}\n\n` });
    }
    if (url.pathname === "/api/mainnet-pilot/challenge") {
      challengeReads++; assert.deepEqual(request.postDataJSON(), {reqId});
      return json({ enrollmentDigest: mode === "wrong-digest" ? "00".repeat(32) : digest, ownerAddr: owner.address,
        sessAddr: signerAddress, grantEpoch:mode==="wrong-epoch"?"wrong-epoch":grantEpoch, reqId,
        sourceId:mode==="wrong-source"?`0x${"ff".repeat(32)}`:sourceId, kind: "fetch",
        requirements: mode==="wrong-price"?{...requirements,amount:"2001"}:mode==="wrong-payee"?{...requirements,payTo:owner.address}:requirements,
        expectedNonce: nonce, paymentContext: { item }, browserAuthorizationProtocol: "durable-v1" });
    }
    if (url.pathname.endsWith("/preview")) {
      previewReads++; assert.equal(url.searchParams.get("version"),item.contentVersion);
      return json({ sourceId, item: mode === "wrong-item" ? {...item,itemTitle:"changed"} : mode==="wrong-receipt"?{...item,contentReceipt:{...item.contentReceipt,bodyHash:`0x${"ee".repeat(32)}`}}:item,
        payTo: creator.address, listPriceMicroUsdc: "2000" });
    }
    if (url.pathname === "/api/mainnet-pilot/sign") {
      const body = request.postDataJSON(); assert.equal(body.reqId,reqId); submitted = body.paymentHeader;
      const signed = JSON.parse(Buffer.from(submitted!,"base64").toString("utf8")), a = signed.authorization;
      assert.equal(a.nonce,nonce); assert.equal(a.value,"2000"); assert.equal(a.to.toLowerCase(),creator.address.toLowerCase());
      const recovered = await recoverTypedDataAddress({ domain: {name:"GatewayWalletBatched",version:"1",chainId:profile.chainId,verifyingContract:profile.gatewayWallet},
        types: {TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},
        primaryType:"TransferWithAuthorization",message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:signed.signature as Hex });
      assert.equal(recovered.toLowerCase(),signerAddress); return json({ok:true,delivered:true});
    }
    throw new Error(`unexpected fixture request ${request.method()} ${url.pathname}`);
  });
  const page = await context.newPage();
  page.on("pageerror",error=>console.error("fixture page error",error.message));
  const connect = async () => { await page.getByRole("button",{name:"Connect or restore invited wallet"}).click();
    try { await page.getByText("Fresh isolated session signer:").waitFor({timeout:10000}); }
    catch(error){console.error("fixture connect status",await page.getByRole("status").textContent());throw error;} };
  await page.goto(`${origin}/`); await connect(); assert.equal(grantSignatures,0);
  await page.getByRole("button",{name:"Delegate funded session"}).click(); await page.getByText("Authenticated bounded pilot session.",{exact:true}).waitFor();
  const firstAddress = signerAddress;
  const research = async () => {
    await page.getByRole("textbox",{name:"Question"}).fill("Synthetic question");
    await page.getByRole("button",{name:"Research with bounded co-signing"}).click();
    await page.getByText("Research finished. Pending or uncertain payments require settlement evidence.",{exact:true}).waitFor();
    await page.getByText("Synthetic cited answer survives a refused payment leg.",{exact:true}).waitFor();
  };
  await research(); assert.ok(submitted); assert.equal(challengeReads,1); assert.equal(previewReads,1);
  await page.reload(); await connect(); await page.getByText("Restored authenticated pilot session.",{exact:true}).waitFor();
  assert.equal(signerAddress,firstAddress); assert.equal(grantSignatures,1); await page.getByRole("heading",{name:"Answer",exact:true}).waitFor();
  const otherTab = await context.newPage(); await otherTab.goto(`${origin}/`);
  revokeDuringSign = async () => { assert.equal(await otherTab.evaluate(async()=> (await fetch('/api/mainnet-pilot/grant',{method:'DELETE',credentials:'same-origin'})).status),200); };
  mode="revoke-during-sign"; await research(); assert.equal(submitted,null,"other-tab revocation during awaited signing suppresses header publication");assert.equal(cookie,false);
  mode="valid";await page.reload();await connect();await page.getByRole("button",{name:"Delegate funded session"}).click();
  await page.getByText("Authenticated bounded pilot session.",{exact:true}).waitFor();
  for (const refusal of ["wrong-digest","wrong-epoch","wrong-source","wrong-price","wrong-payee","wrong-chain","changed-block","wrong-item","wrong-receipt","auth-outage"]) { mode = refusal; await research(); assert.equal(submitted,null,refusal); }
  mode = "valid";
  // Both independently loaded workers race the same nonce: native IDB permits one signature.
  const signature = await owner.signMessage({message:signerContext.derivationMessage});
  const race = await page.evaluate(async ({signature,owner}) => {
    const call = (worker:Worker,type:string,args:Record<string,unknown>={}) => new Promise<unknown>((resolve,reject)=>{
      const id=Math.random(); worker.onmessage=({data})=>data.ok?resolve(data.result):reject(new Error(data.error)); worker.postMessage({id:Math.floor(id*1e9),type,...args}); });
    const workers=[new Worker('/worker.js'),new Worker('/worker.js')];
    for(const w of workers){await call(w,'initialize',{owner});await call(w,'derive',{signature});}
    const request = await fetch('/api/mainnet-pilot/ask',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'race',budgetUsd:0.01})});
    const text=await request.text();const reqId=JSON.parse(/^data: (.+)$/m.exec(text)![1]).reqId;
    const result=await Promise.allSettled(workers.map(w=>call(w,'sign',{reqId})));workers.forEach(w=>w.terminate());return result.map(r=>r.status);
  },{signature,owner:owner.address.toLowerCase()});
  assert.deepEqual(race.sort(),["fulfilled","rejected"]);
  // Two more successful signatures reach retained 10000 cap (including interrupted signing).
  await research(); await research(); assert.ok(submitted);
  await research(); assert.equal(submitted,null,"signed capacity retained across native IDB workers and reload");
  await page.getByRole("button",{name:"Revoke session and clear this tab"}).click();
  await page.getByText(/Server grant revoked and this tab’s custody cleared/).waitFor(); assert.equal(cookie,false);
  await connect(); await page.getByRole("button",{name:"Delegate funded session"}).click();
  await page.getByText("Authenticated bounded pilot session.",{exact:true}).waitFor(); assert.equal(signerAddress,firstAddress);
  await research(); assert.equal(submitted,null,"new grant and rederived key cannot erase retained signed exposure");
  console.log(`Mainnet browser candidate: renderer + dedicated worker + native IDB; ${requestCounter} intercepted requests; reload/auth/item/chain/digest/nonce/cap/revoke passed. Synthetic only.`);
} finally { await browser.close(); }
