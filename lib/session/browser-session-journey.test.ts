import { afterEach, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, toHex, keccak256, parseTransaction,
  encodeFunctionData, encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { createSqliteStorage } from "../db/storage-identity-provision";
import type { QueryRun } from "../types";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.doUnmock("next/headers"); vi.doUnmock("@circle-fin/x402-batching/server");
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

/** Production composition is intact: native sealed DB, JWT/row auth, normal handlers, SSE,
 * runAgent, BrowserCoSignGateway, paid encrypted seller and actual browser worker/IndexedDB.
 * Only Next's request cookie accessor and external RPC/Circle transport are synthetic. */
it.each([false, true, "liveness", "creator"] as const)("completes a normal mainnet browser journey (%s)", async failCitation => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-browser-mainnet-journey-")), databasePath = join(folder, "fresh.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: profile.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: randomUUID(), storageId: randomUUID(),
    enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(), provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(databasePath, identity);
  const manifest = join(folder, "storage.json");
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath } }));
  const origin = "https://keryx.cc", registry = `0x${"33".repeat(20)}` as Hex;
  for (const [name, value] of Object.entries({ KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
    KERYX_STORAGE_MANIFEST: manifest, KERYX_SQLITE_PATH: databasePath, CONTENT_MASTER_KEY: randomBytes(32).toString("hex"),
    KERYX_REGISTRY_ADDRESS: registry, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: registry, BASE_URL: origin, JWT_SECRET: randomBytes(32).toString("hex"),
    KERYX_WITHDRAWAL_MAX_VALUE_MICROS:"1000000", KERYX_WITHDRAWAL_MAX_FEE_MICROS:"1000", KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS:"300", NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS:"300",
    KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS:"20" })) vi.stubEnv(name, value);
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), creator = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const cookies = new AsyncLocalStorage<string | undefined>();
  vi.doMock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "keryx_session" && cookies.getStore() ? { value: cookies.getStore() } : undefined }) }));
  const settledNonces = new Set<string>(); let sessionAddress = "", circleDebit = BigInt(0), depositCredit = BigInt(0);
  vi.doMock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class {
    constructor(options: { url: string }) { expect(options.url).toBe(profile.gatewayApiUrl); }
    async verify(payload: { payload: { authorization: { from: string; nonce: string }; signature: string } }, requirements: import("../payments/browser-cosign-gateway").PaymentRequirements) {
      const { verifyBrowserSignature } = await import("../payments/verify-browser-signature");
      await verifyBrowserSignature(Buffer.from(JSON.stringify(payload.payload)).toString("base64"), { requirements, expectedSigner: sessionAddress, expectedNonce: payload.payload.authorization.nonce });
      return { isValid: true, payer: sessionAddress };
    }
    async settle(payload: { resource: { url: string }; payload: { authorization: { nonce: string; value: string } } }) {
      if (failCitation && payload.resource.url.includes("/api/cite/")) return { success: false, errorReason: "synthetic citation failure" };
      expect(settledNonces.has(payload.payload.authorization.nonce)).toBe(false);
      settledNonces.add(payload.payload.authorization.nonce); circleDebit += BigInt(payload.payload.authorization.value);
      return { success: true, payer: sessionAddress, transaction: `synthetic-circle-${settledNonces.size}`, network: profile.networkId };
    }
  } }));
  const { getDb } = await import("../db"), db = await getDb(); cleanup.push(() => (db as unknown as { close(): void }).close());
  await db.activateBrowserJournal();
  const { sourceId: deriveSourceId, REGISTRY_ABI } = await import("../registry/registry-client");
  const source = { id: "normal-mainnet-source", name: "Durable payment nonce protection", url: "https://creator.example", description: "Durable reservations protect payment nonces",
    tags: ["payment", "nonces", "reservations"], walletAddress: creator.address, authors: [{ name: "Creator", walletAddress: creator.address, splitWeight: 1 }],
    fetchPrice: 0.001, createdAt: new Date().toISOString(), verified: true, active: true, onchainId: deriveSourceId(creator.address, "https://creator.example") };
  await db.upsertSource(source);
  const body = "Durable reservations protect payment nonces by recording every nonce before a signature is exposed. Unknown payment authorizations retain capacity until confirmed settlement evidence resolves them.";
  const { storeSourceItem } = await import("../sources/store-source-item");
  await db.addItems([await storeSourceItem({ id: "normal-article", sourceId: source.id, title: source.name, summary: "Nonce reservations protect payments", content: body,
    link: `${source.url}/article`, publishedAt: new Date().toISOString(), deliveryKind: "full_text" }, { localOnly: true, requireEncrypted: true })]);
  const { issueWebSession } = await import("../auth-session"), { config } = await import("../config");
  const { token } = await issueWebSession(db, config.jwtSecret, owner.address.toLowerCase(), "asker");
  const { NextRequest } = await import("next/server");
  const grantChallenge = await import("../../app/api/session/grant/challenge/route"), grant = await import("../../app/api/session/grant/route");
  const challenge = await import("../../app/api/ask/challenge/route"), sign = await import("../../app/api/ask/sign/route"), ask = await import("../../app/api/ask/route");
  const sourceIndex = await import("../../app/api/sources/route"), preview = await import("../../app/api/source/[id]/item/[itemId]/preview/route");
  const credit = await import("../../app/api/session/credit/route"), revoke = await import("../../app/api/session/revoke/route");
  const withdrawPrepare=await import("../../app/api/session/withdraw/prepare/route"),withdrawAuthorize=await import("../../app/api/session/withdraw/authorize/route"),
    withdrawCancel=await import("../../app/api/session/withdraw/cancel/route"),withdrawSubmit=await import("../../app/api/session/withdraw/submit/route"),
    withdrawStatus=await import("../../app/api/session/withdraw/[requestId]/route"),withdrawPayments=await import("../../app/api/session/withdraw/payments/route"),
    withdrawComplete=await import("../../app/api/session/withdraw/complete/route");
  const seller = await import("../../app/api/source/[id]/item/[itemId]/route"), cite = await import("../../app/api/cite/[id]/route");
  const creatorPrepare=await import("../../app/api/me/withdrawals/prepare/route"),creatorSubmit=await import("../../app/api/me/withdrawals/submit/route"),
    creatorStatus=await import("../../app/api/me/withdrawals/status/route"),creatorComplete=await import("../../app/api/me/withdrawals/complete/route");
  async function dispatch(url: string, init: RequestInit = {}, cookie?: string): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", "keryx.cc");
    if (!headers.has("origin")) headers.set("origin", origin);
    const req = new NextRequest(url, { ...init, signal: init.signal ?? undefined, headers });
    return cookies.run(cookie, async () => {
      const path = req.nextUrl.pathname;
      if(path==="/api/me/withdrawals/prepare")return creatorPrepare.POST(req);
      if(path==="/api/me/withdrawals/submit")return creatorSubmit.POST(req);
      if(path==="/api/me/withdrawals/status")return creatorStatus.POST(req);
      if(path==="/api/me/withdrawals/complete")return creatorComplete.POST(req);
      if (path === "/api/session/grant/challenge") return grantChallenge.POST(req);
      if (path === "/api/session/grant") return init.method === "POST" ? grant.POST(req) : grant.GET(req);
      if (path === "/api/session/credit") return credit.GET(req);
      if (path === "/api/session/revoke") return revoke.POST(req);
      if(path==="/api/session/withdraw/prepare")return withdrawPrepare.POST(req);
      if(path==="/api/session/withdraw/authorize")return withdrawAuthorize.POST(req);
      if(path==="/api/session/withdraw/cancel")return withdrawCancel.POST(req);
      if(path==="/api/session/withdraw/submit")return withdrawSubmit.POST(req);
      if(path==="/api/session/withdraw/complete")return withdrawComplete.POST(req);
      if(path==="/api/session/withdraw/payments")return withdrawPayments.GET(req);
      if(/^\/api\/session\/withdraw\/0x[0-9a-f]{64}$/.test(path))return withdrawStatus.GET(req,{params:Promise.resolve({requestId:path.split("/").at(-1)!})});
      if (path === "/api/ask/challenge") return challenge.POST(req);
      if (path === "/api/ask/sign") return sign.POST(req);
      if (path === "/api/ask") return ask.POST(req);
      if (path === "/api/sources") return sourceIndex.GET(req);
      if (path.startsWith("/api/cite/")) return cite.POST(req, { params: Promise.resolve({ id: source.id }) });
      const ctx = { params: Promise.resolve({ id: source.id, itemId: "normal-article" }) };
      if (path.endsWith("/preview")) return preview.GET(req, ctx);
      if (path.startsWith("/api/source/")) return seller.GET(req, ctx);
      throw new Error(`Unexpected synthetic handler path ${path}`);
    });
  }
  const blockHash = `0x${"66".repeat(32)}`;
  let blockTimestamp=Math.floor(Date.now()/1000);
  let mintTransaction: Record<string,unknown>|null=null,mintReceipt:Record<string,unknown>|null=null,transferCalls=0;
  const mintHash=`0x${"ab".repeat(32)}`,finalHash=`0x${"cd".repeat(32)}`;
  async function rpc(input: RequestInit) {
    const request = JSON.parse(String(input.body)) as { id: number; method: string; params?: Array<{to?:string;data?:string}|string> };
    const tag=request.params?.[0];
    const result = request.method === "eth_chainId" ? profile.chainIdHex : request.method === "eth_getBlockByNumber"
      ? { number: toHex(mintTransaction?(tag==="0x65"?101:102):100),hash:mintTransaction?(tag==="0x65"?mintHash:finalHash):blockHash,
        timestamp:toHex(blockTimestamp),transactions:mintTransaction&&tag==="0x65"?[mintTransaction.hash]:[],gasLimit:"0x1000000",gasUsed:"0x0",baseFeePerGas:"0x1" }
      :request.method==="eth_getCode"?"0x60006000":request.method==="eth_getTransactionByHash"?mintTransaction:
        request.method==="eth_getTransactionReceipt"?mintReceipt:
      request.method === "eth_call" ? (typeof tag==="object"&&tag.to?.toLowerCase()===profile.gatewayMinter.toLowerCase()
        ?(tag.data?.length===74?`0x${"0".repeat(63)}1`:"0x"):encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: {
        creator: creator.address, payoutWallet: creator.address, authors: [{ wallet: creator.address, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(1000), contentCid: "", tags: "", active: true } })) : null;
    if (result === null) throw new Error(`Unexpected synthetic RPC method ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  }
  vi.stubGlobal("fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    const target = String(url);
    if (target.startsWith(profile.rpcUrl)) return rpc(init);
    if (target === config.gatewayBalanceApi) {
      const requested = JSON.parse(String(init.body));
      const depositor=requested.sources[0].depositor.toLowerCase();
      if(failCitation!=="creator")sessionAddress ||= depositor;
      return Response.json({ token: "USDC", balances: [{ depositor, domain: profile.cctpDomain, balance: (Number(BigInt(1_000_000)+depositCredit-circleDebit)/1e6).toFixed(6) }] });
    }
    if(target===`${profile.gatewayApiUrl}/v1/info`)return Response.json({domains:[{domain:26,chain:"Arc",network:"Mainnet",processedHeight:"100",burnIntentExpirationHeight:"110",
      walletContract:{address:profile.gatewayWallet,supportedTokens:["USDC"]},minterContract:{address:profile.gatewayMinter,supportedTokens:["USDC"]}}]});
    if(target===`${profile.gatewayApiUrl}/v1/estimate`)return Response.json([{burnIntent:{spec:JSON.parse(String(init.body))[0].spec,maxBlockHeight:"110",maxFee:"1000"}}]);
    if(target===`${profile.gatewayApiUrl}/v1/transfer`){transferCalls++;throw new Error("Synthetic original transfer response lost");}
    if (target.startsWith(origin)) return dispatch(target, init);
    throw new Error("Unexpected external network refused");
  });
  const worker = await build({ entryPoints: ["lib/session/mainnet-session-signer.worker.ts"], platform: "browser", bundle: true, write: false,
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
      "process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS":'"300"' } });
  const hook = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useMainnetSessionGrant} from './lib/hooks/use-mainnet-session-grant';
    import {SessionCashoutPanel} from './components/keryx/session-cashout-panel';
    import {CreatorOwnerWithdrawalPanel} from './components/keryx/creator-owner-withdrawal-panel';
    import * as creatorJournals from './lib/gateway/withdrawal-browser-journal';window.creatorJournals=creatorJournals;
    import * as creatorHistory from './lib/gateway/withdrawal-history-status';window.creatorHistory=creatorHistory;
    import {getSessionSigner} from './lib/session/session-signer-client';
    import {listFundingRecords} from './lib/buyer/funding-journal';window.fundingRecords=listFundingRecords;
    window.sentFunding=[];
    window.workerOperations=[];const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{postMessage(message){window.workerOperations.push(message.type);super.postMessage(message)}};
    window.retainedSignerAddress=()=>getSessionSigner().sessionAddress;
    window.fundingChain={getChainId:async()=>5042,readContract:async()=>2000000n,getBalance:async()=>2000000000000000000n,
      estimateGas:async({to})=>to?.toLowerCase()==='${profile.gatewayMinter.toLowerCase()}'?300000n:21000n,estimateFeesPerGas:async()=>({maxFeePerGas:1n,maxPriorityFeePerGas:1n}),
      getTransactionCount:async()=>window.sentFunding.length,getBlockNumber:async()=>BigInt(100+window.sentFunding.length*2),
      getTransaction:async({hash})=>{const tx=window.sentFunding.find(tx=>tx.hash===hash);return {...tx,value:BigInt(tx.value),blockNumber:BigInt(tx.blockNumber)}},
      getTransactionReceipt:async({hash})=>{const tx=window.sentFunding.find(tx=>tx.hash===hash);return {transactionHash:hash,blockHash:tx.blockHash,blockNumber:BigInt(tx.blockNumber),status:'success'}}};
    window.wallet={account:{address:'${owner.address}'},getChainId:async()=>5042,getAddresses:async()=>['${owner.address}'],signMessage:async({message})=>window.ownerPersonalSign(message),
      signTypedData:async(fields)=>window.ownerBurnSign(JSON.parse(JSON.stringify(fields,(_,v)=>typeof v==='bigint'?v.toString():v))),
      sendTransaction:async(tx)=>{const hash=await window.ownerFundingSubmit({from:typeof tx.account==='string'?tx.account:tx.account.address,to:tx.to,data:tx.data,value:tx.value.toString(),nonce:tx.nonce,
      gas:tx.gas?.toString(),maxFeePerGas:tx.maxFeePerGas?.toString(),maxPriorityFeePerGas:tx.maxPriorityFeePerGas?.toString()});
      window.sentFunding.push({hash,from:tx.account,to:tx.to,input:tx.data,value:tx.value.toString(),nonce:tx.nonce,blockHash:'${blockHash}',blockNumber:String(101+tx.nonce*2)});return hash;}};
    function Probe(){const grant=useMainnetSessionGrant(); window.normalGrant=grant;return <><output id="state">{JSON.stringify(grant.state)}</output><SessionCashoutPanel sessAddr={grant.state.sessAddr}/></>}
    createRoot(document.getElementById('root')).render(${failCitation==="creator"?`<CreatorOwnerWithdrawalPanel address="${owner.address}"/>`:"<Probe/>"});
  ` }, bundle: true, write: false, platform: "browser", format: "esm",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(registry), "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
      "process.env.NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS":'"300"' },
    plugins: [{ name: "synthetic-owner-wallet", setup(builder) {
      builder.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export const useWalletClient=()=>({data:window.wallet});export const usePublicClient=()=>window.fundingChain;export const useSwitchChain=()=>({switchChainAsync:async()=>{}});" }));
    } }] });
  const browser = await chromium.launch({ headless: true }); cleanup.push(() => browser.close());
  const context = await browser.newContext(); await context.addCookies([{ name: "keryx_session", value: token, url: origin, secure: true, httpOnly: true, sameSite: "Strict" }]);
  const ownerMessages: string[] = [];
  await context.exposeFunction("ownerPersonalSign", (message: string) => { ownerMessages.push(message); return owner.signMessage({ message }); });
  let creatorBurnSigns=0;
  await context.exposeFunction("ownerBurnSign", async (fields: ReturnType<typeof import("../gateway/withdraw-protocol").withdrawTypedData>) => {
    creatorBurnSigns++;return owner.signTypedData(fields);
  });
  let duringApproval: (() => Promise<void>) | undefined;
  let duringNextGrantChallenge: (() => Promise<void>) | undefined;
  let afterDeposit: (() => Promise<void>) | undefined;
  let startAfterDeposit: (() => void) | undefined, laterSignatureReady: Promise<void> | undefined;
  const fundingProposals: Array<{ requested: string; cap: string }> = [];
  const { GATEWAY_DEPOSIT_FOR_ABI } = await import("../buyer/funding-policy");
  let originalCashoutId="";
  await context.exposeFunction("ownerFundingSubmit", async (tx: { from: string; to: string; data: Hex; value: string; nonce: number;gas?:string;maxFeePerGas?:string;maxPriorityFeePerGas?:string }) => {
    expect(tx.from.toLowerCase()).toBe(owner.address.toLowerCase()); expect(tx.value).toBe("0");
    if(tx.nonce===2||failCitation==="creator"){
      expect(tx.to.toLowerCase()).toBe(profile.gatewayMinter.toLowerCase());
      const localRecord=(await db.getCreatorWithdrawal(originalCashoutId,failCitation==="creator"?owner.address.toLowerCase():sessionAddress))!;
      const {WITHDRAWAL_MINTER_ABI}=await import("../gateway/withdrawal-mint-observation");
      expect(decodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,data:tx.data}).functionName).toBe("gatewayMint");
      const raw=await owner.signTransaction({type:"eip1559",chainId:profile.chainId,nonce:tx.nonce,gas:BigInt(tx.gas!),
        maxFeePerGas:BigInt(tx.maxFeePerGas!),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas!),to:profile.gatewayMinter,value:BigInt(0),data:tx.data});
      const parsed=parseTransaction(raw),txHash=keccak256(raw);
      mintTransaction={type:"0x2",chainId:toHex(profile.chainId),nonce:toHex(tx.nonce),gas:toHex(BigInt(tx.gas!)),maxFeePerGas:toHex(BigInt(tx.maxFeePerGas!)),
        maxPriorityFeePerGas:toHex(BigInt(tx.maxPriorityFeePerGas!)),to:profile.gatewayMinter,from:owner.address.toLowerCase(),value:"0x0",input:tx.data,accessList:[],r:parsed.r,s:parsed.s,
        yParity:toHex(parsed.yParity!),hash:txHash,blockHash:mintHash,blockNumber:"0x65",transactionIndex:"0x0"};
      const {WITHDRAWAL_MINT_EVENT}=await import("../gateway/withdrawal-mint-receipt"),{withdrawalTransferSpecHash}=await import("../gateway/withdrawal-attestation");
      const spec=localRecord.request.burnIntent.spec;
      mintReceipt={transactionHash:txHash,blockHash:mintHash,blockNumber:"0x65",transactionIndex:"0x0",from:owner.address.toLowerCase(),to:profile.gatewayMinter,
        status:"0x1",type:"0x2",gasUsed:toHex(150000),cumulativeGasUsed:toHex(150000),effectiveGasPrice:toHex(BigInt(tx.maxFeePerGas!)),logs:[{
          transactionHash:txHash,blockHash:mintHash,blockNumber:"0x65",transactionIndex:"0x0",logIndex:"0x0",address:profile.gatewayMinter,removed:false,
          topics:encodeEventTopics({abi:WITHDRAWAL_MINT_EVENT,eventName:"AttestationUsed",args:{token:profile.usdcAddress,recipient:owner.address,transferSpecHash:withdrawalTransferSpecHash(localRecord)}}),
          data:encodeAbiParameters([{type:"uint32"},{type:"bytes32"},{type:"bytes32"},{type:"uint256"}],[26,spec.sourceDepositor,spec.sourceSigner,BigInt(spec.value)])}]};
      return txHash;
    }
    if (tx.nonce === 0) {
      expect(tx.to.toLowerCase()).toBe(profile.usdcAddress.toLowerCase());
      expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({ functionName: "approve", args: [profile.gatewayWallet, BigInt(50000)] });
      await duringApproval!();
    } else {
      expect(tx.nonce).toBe(1); expect(tx.to.toLowerCase()).toBe(profile.gatewayWallet.toLowerCase());
      const decoded = decodeFunctionData({ abi: GATEWAY_DEPOSIT_FOR_ABI, data: tx.data });
      expect(decoded.functionName).toBe("depositFor");
      expect(String(decoded.args![1]).toLowerCase()).toBe(sessionAddress); expect(decoded.args![2]).toBe(BigInt(50000));
      depositCredit += BigInt(50000);
      startAfterDeposit?.();
      duringNextGrantChallenge = afterDeposit;
    }
    return `0x${(tx.nonce+1).toString(16).padStart(64,"0")}`;
  });
  let holdGrant = false, holdRevoke = false, releaseHeld: (() => void) | undefined, held = false;
  let failStatusLookup=false,holdAskChallenge=false;
  await context.route("**/*", async route => {
    const req = route.request(), url = req.url();
    if (url === `${origin}/`) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/hook.js"></script>' });
    if (url === `${origin}/hook.js`) return route.fulfill({ contentType: "application/javascript", body: hook.outputFiles[0].text });
    if (url === `${origin}/worker.js` || url === `${origin}/mainnet-session-signer.worker.ts`) return route.fulfill({ contentType: "application/javascript", body: worker.outputFiles[0].text });
    if (url.startsWith(profile.rpcUrl)) { const response = await rpc({ body: req.postData() }); return route.fulfill({ status: response.status, body: await response.text(), contentType: "application/json" }); }
    if(failStatusLookup&&url===`${origin}/api/session/grant`&&req.method()==="GET")return route.fulfill({status:503,contentType:"application/json",body:"{}"});
    expect(url.startsWith(origin)).toBe(true);
    const receivedToken = req.headers().cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("keryx_session="))?.slice("keryx_session=".length);
    if (holdRevoke && url === `${origin}/api/session/revoke`) { holdRevoke = false; held = true; await new Promise<void>(resolve => { releaseHeld = resolve; }); }
    if(holdAskChallenge&&url===`${origin}/api/ask/challenge`){holdAskChallenge=false;held=true;await new Promise<void>(resolve=>{releaseHeld=resolve})}
    if (url === `${origin}/api/session/grant/challenge` && duringNextGrantChallenge) {
      const settle = duringNextGrantChallenge; duringNextGrantChallenge = undefined; await settle();
    }
    const response = await dispatch(url, { method: req.method(), body: req.postData() ?? undefined, headers: req.headers() }, receivedToken);
    if (laterSignatureReady && url.includes("/api/session/credit?") && new URL(url).searchParams.has("after")) await laterSignatureReady;
    if (afterDeposit && url === `${origin}/api/session/grant/challenge` && response.ok) {
      const proposal = await response.clone().json();
      fundingProposals.push({ requested: JSON.parse(req.postData()!).budgetMicros, cap: proposal.consent.capMicroUsdc });
    }
    if (holdGrant && req.method() === "GET" && url === `${origin}/api/session/grant`) { holdGrant = false; held = true; await new Promise<void>(resolve => { releaseHeld = resolve; }); }
    return route.fulfill({ status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) });
  });
  const page = await context.newPage();await page.goto(origin);
  if(failCitation==="creator"){
    const {ARC_TESTNET_PROFILE}=await import("../arc-network-profile");
    const {prepareWithdrawIntentForProfile}=await import("../gateway/withdraw-intent-core"),{withdrawTypedData}=await import("../gateway/withdraw-protocol");
    const {createWithdrawalRequest}=await import("../gateway/withdrawal-request");
    const legacyIntent={...prepareWithdrawIntentForProfile(ARC_TESTNET_PROFILE,owner.address,"100000",owner.address,"1000"),maxBlockHeight:"110"};
    const legacy=await createWithdrawalRequest({burnIntent:legacyIntent,signature:await owner.signTypedData(withdrawTypedData(legacyIntent))},
      {owner:owner.address,recipient:owner.address,domain:26,asset:ARC_TESTNET_PROFILE.usdcAddress,gatewayWallet:ARC_TESTNET_PROFILE.gatewayWallet,
        gatewayMinter:ARC_TESTNET_PROFILE.gatewayMinter,maxValueMicros:"100000",maxFeeMicros:"1000"},ARC_TESTNET_PROFILE);
    const legacyBundle=await build({stdin:{contents:"import * as journal from './lib/gateway/withdrawal-browser-journal';window.legacyJournal=journal;",resolveDir:process.cwd()},
      bundle:true,platform:"browser",write:false,define:{"process.env.NEXT_PUBLIC_KERYX_NETWORK":'"arcTestnet"',
        "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS":"undefined","process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS":"undefined"}});
    await page.addScriptTag({content:legacyBundle.outputFiles[0].text});
    await page.evaluate(async record=>(window as unknown as {legacyJournal:{importWithdrawalBrowserJournal(record:unknown,owner:string):Promise<unknown>}}).legacyJournal.importWithdrawalBrowserJournal(record,record.owner),legacy);
    expect(await page.evaluate(async id=>{const fixture=window as unknown as {wallet:{account:{address:string}};creatorJournals:{readWithdrawalBrowserJournal(id:string,owner:string):Promise<unknown>}};
      try{await fixture.creatorJournals.readWithdrawalBrowserJournal(id,fixture.wallet.account.address);return true}catch{return false}},legacy.id)).toBe(false);
    const status=()=>page.getByRole("status",{name:"Creator withdrawal status"}).textContent();
    await page.getByLabel("Creator withdrawal amount").fill("0.1");
    await page.getByLabel("Creator withdrawal maximum fee").fill("0.000999");
    await page.getByRole("button",{name:"Prepare creator withdrawal",exact:true}).click();
    await expect.poll(status).toContain("differs from your review");
    expect(creatorBurnSigns).toBe(0);expect(transferCalls).toBe(0);
    await page.getByLabel("Creator withdrawal maximum fee").fill("0.001");
    await page.getByRole("button",{name:"Prepare creator withdrawal",exact:true}).click();
    await expect.poll(()=>page.getByLabel("Original creator withdrawal request").inputValue()).toMatch(/^0x[0-9a-f]{64}$/);
    originalCashoutId=await page.getByLabel("Original creator withdrawal request").inputValue();
    await page.getByLabel("Creator withdrawal amount").fill("0.2");
    await page.getByRole("button",{name:"Sign reviewed creator burn",exact:true}).click();
    await expect.poll(status).toContain("review differs");expect(creatorBurnSigns).toBe(0);
    await page.getByLabel("Creator withdrawal amount").fill("0.1");
    await page.getByRole("button",{name:"Sign reviewed creator burn",exact:true}).click();
    await expect.poll(status).toContain("Original burn signature saved");expect(creatorBurnSigns).toBe(1);
    await page.getByRole("button",{name:"Send signed creator burn",exact:true}).click();
    await expect.poll(status,{timeout:20000}).toContain("Original transfer attempt retained");
    expect(transferCalls).toBe(1);
    await page.reload();await page.getByLabel("Saved creator withdrawals").selectOption(originalCashoutId);
    await page.getByRole("button",{name:"Read creator recovery",exact:true}).click();
    await expect.poll(status,{timeout:20000}).toContain("awaiting-transfer-evidence");
    expect(await page.getByRole("button",{name:"Send signed creator burn",exact:true}).isDisabled()).toBe(true);
    const record=(await db.getCreatorWithdrawal(originalCashoutId,owner.address.toLowerCase()))!;
    const claim=(await db.getCreatorWithdrawalTransferClaim(originalCashoutId,owner.address.toLowerCase()))!;
    const spec=record.request.burnIntent.spec,attester=privateKeyToAccount(`0x${"44".repeat(32)}`);
    const encodedSpec="ca85def7000000010000001a0000001a"+[spec.sourceContract,spec.destinationContract,spec.sourceToken,spec.destinationToken,
      spec.sourceDepositor,spec.destinationRecipient,spec.sourceSigner,spec.destinationCaller].map(v=>v.slice(2)).join("")+BigInt(spec.value).toString(16).padStart(64,"0")+spec.salt.slice(2)+"00000000";
    const attestation=`0xff6fb334${BigInt(120).toString(16).padStart(64,"0")}00000154${encodedSpec}` as Hex;
    await db.saveCreatorWithdrawalAttestation(originalCashoutId,owner.address.toLowerCase(),claim.claimId,
      {transferId:randomUUID(),attestation,expirationBlock:"120",signature:await attester.signMessage({message:{raw:keccak256(attestation)}})});
    await page.getByRole("button",{name:"Review creator mint and gas",exact:true}).click();
    await expect.poll(status,{timeout:20000}).toContain("Owner mint submitted");
    const originalHash=await page.getByLabel("Original creator mint hash").inputValue();expect(originalHash).toMatch(/^0x[0-9a-f]{64}$/);
    await page.reload();await page.getByLabel("Saved creator withdrawals").selectOption(originalCashoutId);
    expect(await page.getByLabel("Original creator mint hash").inputValue()).toBe(originalHash);
    await page.getByRole("button",{name:"Read creator recovery",exact:true}).click();
    await expect.poll(status,{timeout:20000}).toContain("attestation-stored");
    expect(await page.getByRole("button",{name:"Review creator mint and gas",exact:true}).isDisabled()).toBe(true);
    await page.getByRole("button",{name:"Verify creator mint finality",exact:true}).click();
    await expect.poll(status,{timeout:20000}).toBe("Original owner mint finality verified");
    expect(transferCalls).toBe(1);expect(creatorBurnSigns).toBe(1);
    expect((await db.getCreatorOwnerWithdrawalCompletion(originalCashoutId,owner.address.toLowerCase()))?.observation.transactionHash).toBe(originalHash);
    const historyProgress=await page.evaluate(async row=>(window as unknown as {creatorHistory:{readWithdrawalHistoryStatus(row:unknown,current:()=>string,signal:AbortSignal):Promise<unknown>}}).creatorHistory.readWithdrawalHistoryStatus(row,()=>row.owner,new AbortController().signal),
      {id:record.id,owner:record.owner,recipient:record.policy.recipient,amountMicros:record.request.burnIntent.spec.value,maxFeeMicros:record.request.burnIntent.maxFee,createdAt:new Date().toISOString()});
    expect(historyProgress).toMatchObject({state:"server-reported-progress",progress:{network:profile.networkId,chainFinalityVerified:true,transactionHash:originalHash}});
    expect(record.network).toBe(profile.networkId);expect(record.format).toBe("creator-withdrawal-request-v2");
    expect(await page.evaluate(async()=> (await indexedDB.databases()).map(entry=>entry.name))).toEqual(expect.arrayContaining(["keryx-creator-withdrawals-v1","keryx-creator-withdrawals-v2-arc"]));
    expect(await page.evaluate(()=>[...document.body.querySelectorAll("input")].some(input=>input.value.length===132))).toBe(false);
    return;
  }
  await page.waitForFunction(() => !!(window as unknown as { normalGrant?: unknown }).normalGrant);
  await page.evaluate(() => (window as unknown as { normalGrant: { generateAndFund(budget: number): Promise<void> } }).normalGrant.generateAndFund(0.05));
  const hookState = async () => JSON.parse((await page.locator("#state").textContent())!);
  expect(await hookState()).toMatchObject({ status: "active", cap: 0.05, spent: 0 });
  expect((await hookState()).sessAddr.toLowerCase()).toBe(sessionAddress);
  await page.evaluate(() => {
    const worker = new Worker("/worker.js"), pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>(); let id = 0;
    worker.onmessage = ({ data }) => { const slot = pending.get(data.id); if (!slot) return; pending.delete(data.id); if (data.ok) slot.resolve(data.result); else slot.reject(new Error(data.error)); };
    (window as unknown as { call(type: string, fields?: object): Promise<unknown> }).call = (type, fields = {}) => new Promise((resolve, reject) => { const seq = ++id; pending.set(seq, { resolve, reject }); worker.postMessage({ id: seq, type, ...fields }); });
  });
  const call = (type: string, fields: object = {}) => page.evaluate(({ type, fields }) => (window as unknown as { call(type: string, fields: object): Promise<unknown> }).call(type, fields), { type, fields });
  await call("initializeOwner", { owner: owner.address });
  expect((await call("restoreRetained") as { address: string }).address.toLowerCase()).toBe(sessionAddress);
  const { createSessionGrantConsentMessage } = await import("../payments/session-grant-consent");
  async function completeResearch(question: string, budget: number, questionId: string, beforeSubmit?: () => Promise<void>) {
  const response = await dispatch(`${origin}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, budget, sessionId: owner.address, browserAuthorizationProtocol: "durable-v1", mode: "quick", scholarly: false }) }, token);
  expect(response.status).toBe(200); const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "", done: QueryRun | null = null, signs = 0;
  for (;;) {
    const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true });
    while (buffer.includes("\n\n")) {
      const end = buffer.indexOf("\n\n"), packet = buffer.slice(0, end); buffer = buffer.slice(end+2);
      const event = /^event: (.+)$/m.exec(packet)?.[1], data = JSON.parse(/^data: (.+)$/m.exec(packet)![1]);
      if (event === "error") throw new Error(JSON.stringify(data));
      if (event === "sign-request") {
        signs++; const { paymentHeader } = await call("authorizePayment", { reqId: data.reqId, question: { id: questionId, budgetMicroUsdc: String(Math.round(budget*1e6)) } }) as { paymentHeader: string };
        await beforeSubmit?.();
        const status = await page.evaluate(async ({ reqId, paymentHeader, sessionId }) => (await fetch("/api/ask/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, reqId, paymentHeader }) })).status, { reqId: data.reqId, paymentHeader, sessionId: owner.address.toLowerCase() });
        expect(status).toBe(200);
      }
      if (event === "done") done = data;
    }
  }
  expect(done).not.toBeNull(); return { done: done!, signs };
  }
  if(failCitation==="liveness"){
    await page.evaluate(()=>{const fixture=window as unknown as {normalGrant:{authorizeSessionPayment:unknown};cachedAuthorize:unknown};fixture.cachedAuthorize=fixture.normalGrant.authorizeSessionPayment});
    failStatusLookup=true;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect.poll(async()=>(await hookState()).status).toBe("paused");
    const invokeCached=()=>page.evaluate(async()=>{try{await (window as unknown as {cachedAuthorize(reqId:string,question:object):Promise<string>}).cachedAuthorize("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",budgetMicroUsdc:"10000"});return true}catch{return false}});
    expect(await invokeCached()).toBe(false);
    expect(await page.evaluate(()=>(window as unknown as {workerOperations:string[]}).workerOperations.filter(v=>v==="authorizePayment").length)).toBe(0);
    expect(await page.evaluate(()=>(window as unknown as {retainedSignerAddress():string|null}).retainedSignerAddress())).toBeNull();
    failStatusLookup=false;
    await page.evaluate(()=>(window as unknown as {normalGrant:{tryRecover():Promise<boolean>}}).normalGrant.tryRecover());
    await expect.poll(async()=>(await hookState()).status).toBe("active");
    expect(await invokeCached()).toBe(false); // Same owner/epoch restored under a fresh local registration.
    const response=await dispatch(`${origin}/api/ask`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:"How do durable reservations protect payment nonces?",budget:0.01,sessionId:owner.address,browserAuthorizationProtocol:"durable-v1",mode:"quick",scholarly:false})},token);
    expect(response.status).toBe(200);const reader=response.body!.getReader(),decoder=new TextDecoder();let packet="",reqId:string|null=null;
    while(!reqId){const next=await reader.read();if(next.done)throw new Error("Expected original live challenge");packet+=decoder.decode(next.value,{stream:true});
      while(packet.includes("\n\n")){const end=packet.indexOf("\n\n"),event=packet.slice(0,end);packet=packet.slice(end+2);
        if(/^event: sign-request$/m.test(event))reqId=JSON.parse(/^data: (.+)$/m.exec(event)![1]).reqId}}
    held=false;holdAskChallenge=true;
    const pending=page.evaluate(async reqId=>{try{return await (window as unknown as {normalGrant:{authorizeSessionPayment(reqId:string,question:object):Promise<string>}}).normalGrant.authorizeSessionPayment(reqId!,{id:crypto.randomUUID(),budgetMicroUsdc:"10000"})}catch{return null}},reqId);
    await expect.poll(()=>held).toBe(true);failStatusLookup=true;await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect.poll(async()=>(await hookState()).status).toBe("paused");releaseHeld!();
    expect(await pending).toBeNull();expect(settledNonces.size).toBe(0);
    expect(await page.evaluate(()=>(window as unknown as {workerOperations:string[]}).workerOperations.filter(v=>v==="authorizePayment").length)).toBe(1);
    const {cancelPending}=await import("../payments/pending-signatures");cancelPending(owner.address.toLowerCase(),reqId!);await reader.cancel();
    return;
  }
  const { done, signs } = await completeResearch("How do durable reservations protect payment nonces?", 0.01, identity.enrollmentId);
  expect(done).not.toBeNull(); expect(done!.answer).toContain("[S1]"); expect(done!.answer).toContain("nonce"); expect(done!.citations.length).toBeGreaterThan(0);
  expect(signs).toBe(2); expect(settledNonces.size).toBe(failCitation ? 1 : 2);
  const payments = await db.listCreatorPaymentAttemptsByQuery(done!.id);
  expect(payments.find(p => p.kind === "fetch")?.settled).toBe(true);
  expect(payments.some(p => p.kind === "citation" && p.settled)).toBe(!failCitation);
  expect(await db.getQueryRun(done!.id)).not.toBeNull();
  if (!failCitation) {
    const renew = async () => {
      const proposal = await dispatch(`${origin}/api/session/grant/challenge`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessAddr: sessionAddress, budgetMicros: "50000", recover: true }) }, token);
      expect(proposal.status).toBe(200);
      const { consent } = await proposal.json();
      const signature = await owner.signMessage({ message: createSessionGrantConsentMessage(consent, config.profile) });
      const sessionSignature = await call("signGrantConsentProof", { consent, ownerSignature: signature });
      const accepted = await dispatch(`${origin}/api/session/grant`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent, signature, sessionSignature }) }, token);
      expect(accepted.status).toBe(200); const metadata = await accepted.json();
      expect(metadata.capMicroUsdc).toBe(consent.capMicroUsdc);
      expect(BigInt(metadata.spentMicroUsdc)).toBeGreaterThan(BigInt(0));
      return metadata;
    };
    const recover = () => page.evaluate(() => (window as unknown as { normalGrant: { tryRecover(): Promise<boolean> } }).normalGrant.tryRecover());
    held = false; holdGrant = true; const oldPublication = recover();
    await expect.poll(() => held).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("keryx:auth", { detail: "signed-out" })));
    releaseHeld!(); await oldPublication;
    expect((await hookState()).status).toBe("paused");
    expect((await hookState()).grantEpoch).toBeNull();

    // An older metadata response cannot publish after another tab replaces the exact proof.
    held = false; holdGrant = true; const replacedPublication = recover();
    await expect.poll(() => held).toBe(true); const replacement = await renew();
    releaseHeld!(); await replacedPublication;
    expect((await hookState()).status).toBe("paused");
    await recover(); await expect.poll(hookState).toMatchObject({ status: "active", grantEpoch: replacement.grantEpoch });
    expect((await hookState()).spent).toBe(Number(replacement.spentMicroUsdc)/1e6);

    // Old logout reaches the server only after a newer grant: CAS must preserve the newer epoch.
    held = false; holdRevoke = true;
    const delayedLogout = page.evaluate(() => (window as unknown as { normalGrant: { revoke(): Promise<unknown> } }).normalGrant.revoke());
    await expect.poll(() => held).toBe(true); const afterLogout = await renew();
    releaseHeld!(); await delayedLogout;
    expect((await hookState()).status).toBe("paused");
    expect((await (await dispatch(`${origin}/api/session/grant`, {}, token)).json()).grantEpoch).toBe(afterLogout.grantEpoch);
    await recover(); await expect.poll(hookState).toMatchObject({ status: "active", grantEpoch: afterLogout.grantEpoch });
    const originalCap = (await hookState()).cap;
    duringApproval = async () => {
      const debitBefore = circleDebit;
      const concurrent = await completeResearch("How do durable payment reservations preserve nonce protection?", 0.01, randomUUID());
      expect(concurrent.done.answer).toContain("[S1]"); expect(circleDebit).toBeGreaterThan(debitBefore);
    };
    let resumeLater!: () => void, signalReady!: () => void, later: Promise<{done: QueryRun; signs: number}>;
    const resume=new Promise<void>(resolve=>{resumeLater=resolve});
    laterSignatureReady=new Promise<void>(resolve=>{signalReady=resolve});
    startAfterDeposit=()=>{later=completeResearch("How do durable payment reservations preserve nonce protection?",0.01,randomUUID(),async()=>{signalReady();await resume});};
    afterDeposit=async()=>{const debitBefore=circleDebit;resumeLater();const result=await later;
      expect(result.done.answer).toContain("[S1]");expect(circleDebit).toBeGreaterThan(debitBefore);};
    const messagesBeforeFunding = ownerMessages.length;
    await page.evaluate(() => (window as unknown as { normalGrant: { topUp(amount: number): Promise<void> } }).normalGrant.topUp(0.05));
    const toppedUp=await hookState();expect(toppedUp.status,JSON.stringify(toppedUp)).toBe("active");
    expect(Math.round((await hookState()).cap*1e6)).toBe(Math.round(originalCap*1e6)+50000);
    const target = BigInt(Math.round(originalCap*1e6)+50000);
    expect(fundingProposals).toHaveLength(2);
    expect(BigInt(fundingProposals[0].cap)).toBeGreaterThan(target);
    expect(BigInt(fundingProposals[1].cap)).toBe(target);
    expect(BigInt(fundingProposals[1].requested)).toBeLessThan(BigInt(fundingProposals[0].requested));
    expect(ownerMessages.length-messagesBeforeFunding).toBe(1);
    const fundingRows = await page.evaluate(owner => (window as unknown as { fundingRecords(owner: string): Promise<Array<{ gatewayCreditAcknowledged?: boolean; activePayer?: string; gatewayCreditObservedAt?: string }>> }).fundingRecords(owner), owner.address);
    expect(fundingRows).toHaveLength(1); expect(fundingRows[0].gatewayCreditAcknowledged).toBe(true);
    expect(fundingRows[0].activePayer).toBeUndefined(); expect(fundingRows[0].gatewayCreditObservedAt).toBeDefined();
    expect(await page.evaluate(() => (window as unknown as { sentFunding: unknown[] }).sentFunding.length)).toBe(2);
    const retainedEpoch=(await hookState()).grantEpoch;
    await page.evaluate(()=>(window as unknown as {normalGrant:{revoke():Promise<unknown>}}).normalGrant.revoke());
    await call("lock");await call("restoreRetained");blockTimestamp=Math.floor(Date.now()/1000);
    const prepareCashout=async()=>{
      const response=await dispatch(`${origin}/api/session/withdraw/prepare`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sessAddr:sessionAddress,grantEpoch:retainedEpoch,amountMicros:"100000"})},token);
      expect(response.status).toBe(200);return response.json();
    };
    const abandoned=await prepareCashout();
    expect(await call("cancelUnexposedWithdrawal",{requestId:abandoned.requestId})).toMatchObject({cancelledUnexposed:true});
    const prepared=await prepareCashout();expect(prepared.requestId).not.toBe(abandoned.requestId);
    originalCashoutId=prepared.requestId;
    await expect(call("signWithdrawal",{requestId:prepared.requestId,review:{amountMicroUsdc:"100001",maxFeeMicroUsdc:"1000"}})).rejects.toThrow();
    await page.getByRole("button",{name:"Withdraw retained session funds",exact:true}).click();
    await page.getByLabel("Session withdrawal amount").fill("0.1");await page.getByLabel("Session withdrawal maximum fee").fill("0.001");
    await page.getByRole("button",{name:"Prepare reviewed amount and fee ceiling",exact:true}).click();
    await expect.poll(()=>page.getByLabel("Original session withdrawal request").inputValue()).toBe(prepared.requestId);
    await page.getByRole("button",{name:"Sign and submit original burn",exact:true}).click();
    await expect.poll(async()=>({status:await page.locator('p[role="status"]').textContent(),error:await page.locator('[role="alert"]').count()?await page.locator('[role="alert"]').textContent():null}),{timeout:20000}).toEqual({status:"transfer submitted; original recovery required",error:null});
    await expect(call("cancelUnexposedWithdrawal",{requestId:prepared.requestId})).rejects.toThrow();
    expect(transferCalls).toBe(1);
    expect(await call("reconcileWithdrawal",{requestId:prepared.requestId})).toMatchObject({completed:false});
    const record=(await db.getCreatorWithdrawal(prepared.requestId,sessionAddress))!,claim=(await db.getCreatorWithdrawalTransferClaim(prepared.requestId,sessionAddress))!;
    const spec=record.request.burnIntent.spec,attester=privateKeyToAccount(`0x${"44".repeat(32)}`);
    const encodedSpec="ca85def7000000010000001a0000001a"+[spec.sourceContract,spec.destinationContract,spec.sourceToken,spec.destinationToken,
      spec.sourceDepositor,spec.destinationRecipient,spec.sourceSigner,spec.destinationCaller].map(v=>v.slice(2)).join("")+
      BigInt(spec.value).toString(16).padStart(64,"0")+spec.salt.slice(2)+"00000000";
    const attestation=`0xff6fb334${BigInt(120).toString(16).padStart(64,"0")}00000154${encodedSpec}` as Hex;
    const vendor={transferId:randomUUID(),attestation,expirationBlock:"120",signature:await attester.signMessage({message:{raw:keccak256(attestation)}})};
    await db.saveCreatorWithdrawalAttestation(prepared.requestId,sessionAddress,claim.claimId,vendor);
    await page.getByRole("button",{name:"Review owner wallet mint and gas",exact:true}).click();
    await expect.poll(()=>page.locator('p[role="status"]').textContent(),{timeout:20000}).toBe("owner mint submitted; finality pending");
    expect(await page.getByLabel("Original session mint hash").inputValue()).toMatch(/^0x[0-9a-f]{64}$/);
    await page.getByRole("button",{name:"Verify original mint finality",exact:true}).click();
    await expect.poll(()=>page.locator('p[role="status"]').textContent(),{timeout:20000}).toBe("completed with original mainnet mint finality");
    expect(await call("reconcileWithdrawal",{requestId:prepared.requestId})).toMatchObject({completed:true,status:"mint-finalized-observed"});
    expect(transferCalls).toBe(1);
    await page.evaluate(()=>(window as unknown as {normalGrant:{recoverViaSignature():Promise<boolean>}}).normalGrant.recoverViaSignature());
    expect((await hookState()).status).toBe("active");
    const afterCashout=await completeResearch("How do durable payment reservations preserve nonce protection?",0.01,randomUUID());
    expect(afterCashout.done.answer).toContain("[S1]");
  }
  await call("lock"); expect((await call("restoreRetained") as { address: string }).address.toLowerCase()).toBe(sessionAddress);
}, 120000);
