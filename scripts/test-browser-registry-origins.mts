/** Actual DedicatedWorker authority composition; every API/RPC response is synthetic. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { encodeFunctionResult, keccak256, toFunctionSelector, type Hex } from "viem";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "../lib/registry/registry-abi";
import { ARC_MAINNET_PROFILE as profile } from "../lib/arc-network-profile";

const legacy = { network: profile.networkId, address: `0x${"22".repeat(20)}`, version: 1,
  codeHash: keccak256("0x6000"), deployBlock: "10" };
const current = { ...legacy, address: `0x${"33".repeat(20)}`, version: 3, codeHash: keccak256("0x6001"), deployBlock: "20" };
const id = `0x${"44".repeat(32)}`, payout = `0x${"55".repeat(20)}` as Hex, origin = "https://keryx.cc";
const origins = JSON.stringify([legacy, current]);
const bundle = await build({ stdin: { contents: `import {readBrowserMainnetSource} from './lib/session/browser-session-source-authority';
  import {assertBrowserListingRegistryOrigin} from './lib/registry/browser-source-registry-authority';
  self.onmessage=async({data})=>{try{if(data.operation==='listing'){assertBrowserListingRegistryOrigin(data.address,data.version);self.postMessage({ok:true});return;}
    const authority=await readBrowserMainnetSource('${id}');self.postMessage({ok:true,worker:typeof window==='undefined'&&self instanceof DedicatedWorkerGlobalScope,authority:{...authority,wallets:[...authority.wallets]}})}catch{self.postMessage({ok:false})}};`,
  resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, platform: "browser", format: "iife", define: {
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify("arc"),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": JSON.stringify(current.address),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_VERSION": JSON.stringify("3"),
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS": JSON.stringify(origins),
  } });
let bound: unknown = legacy, runtimeCode = "0x6000", declaredVersion = 3, changedHash = false;
let blockReads = 0;
const rpc: Array<{ method: string; params: unknown[] }> = [];
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<main>Synthetic registry worker acceptance</main>" });
      if (url.pathname === "/worker.js") return route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text });
      assert.equal(url.pathname, "/api/sources"); assert.equal(request.method(), "GET");
      return route.fulfill({ json: { sources: [{ id: "publication", onchainId: id, ...(bound ? { registryAuthority: bound } : {}) }] } });
    }
    assert.equal(url.origin, new URL(profile.rpcUrl).origin); assert.equal(request.method(), "POST");
    const body = request.postDataJSON() as { id: number; method: string; params: unknown[] };
    rpc.push(body); let result: unknown;
    if (body.method === "eth_chainId") result = profile.chainIdHex;
    else if (body.method === "eth_getCode") result = runtimeCode;
    else if (body.method === "eth_getBlockByNumber") {
      blockReads++; result = { number: "0x64", hash: `0x${(changedHash && blockReads > 1 ? "77" : "66").repeat(32)}`,
        timestamp: `0x${Math.floor(Date.now()/1000).toString(16)}`, transactions: [] };
    } else {
      assert.equal(body.method, "eth_call");
      const call = body.params[0] as { data: Hex };
      result = call.data === toFunctionSelector("registryVersion()")
        ? encodeFunctionResult({ abi: REVISIONED_REGISTRY_ABI, functionName: "registryVersion", result: declaredVersion })
        : encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: payout, payoutWallet: payout,
          authors: [{ wallet: payout, basisPoints: 10000 }], fetchPriceUsdc6: BigInt(5000), contentCid: "", tags: "", active: true } });
    }
    return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
  });
  const page = await context.newPage(); await page.goto(origin);
  async function observe(operation: { operation: "listing"; address: string; version: number } | Record<string, never> = {}) {
    rpc.length = 0; blockReads = 0;
    return page.evaluate(async operation => {
      const worker = new Worker("/worker.js");
      try { return await new Promise<{ ok: boolean; worker?: boolean; authority?: { fetchPayTo: string; listPriceUsdc: number; registryAuthority: unknown } }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Synthetic worker deadline")), 12000);
        worker.onmessage = event => { clearTimeout(timeout); resolve(event.data); };
        worker.onerror = () => { clearTimeout(timeout); reject(new Error("Synthetic worker startup failed")); };
        worker.postMessage(operation);
      }); } finally { worker.terminate(); }
    }, operation);
  }
  for (const allowed of [legacy, current]) {
    assert.equal((await observe({ operation: "listing", address: allowed.address, version: allowed.version })).ok, true);
    assert.equal(rpc.length, 0, "Listing membership uses compiled public pins only");
  }
  for (const refused of [{ ...legacy, version: 3 }, { ...current, version: 1 }, { ...current, address: payout }]) {
    assert.equal((await observe({ operation: "listing", address: refused.address, version: refused.version })).ok, false);
    assert.equal(rpc.length, 0);
  }
  const old = await observe(); assert.equal(old.ok, true); assert.equal(old.worker, true);
  assert.deepEqual(old.authority?.registryAuthority, legacy); assert.equal(old.authority?.fetchPayTo, payout); assert.equal(old.authority?.listPriceUsdc, 0.005);
  for (const request of rpc.filter(request => request.method === "eth_call" || request.method === "eth_getCode")) {
    assert.equal(request.method === "eth_call" ? (request.params[0] as { to: string }).to : request.params[0], legacy.address);
    assert.equal(request.params[1], "0x64");
  }
  bound = current; runtimeCode = "0x6001";
  assert.equal((await observe()).ok, true);
  assert.ok(rpc.some(request => request.method === "eth_call" && (request.params[0] as { data: string }).data === toFunctionSelector("registryVersion()")));
  declaredVersion = 2; assert.equal((await observe()).ok, false); declaredVersion = 3;
  runtimeCode = "0x6002"; assert.equal((await observe()).ok, false); runtimeCode = "0x6001";
  changedHash = true; assert.equal((await observe()).ok, false); changedHash = false;
  for (const mutation of [{ ...current, address: payout }, { ...current, codeHash: legacy.codeHash }, { ...current, version: 1 },
    { ...current, deployBlock: "21" }, { ...current, network: "eip155:5042002" }, null]) {
    bound = mutation; assert.equal((await observe()).ok, false); assert.equal(rpc.length, 0);
  }
  console.log("Actual DedicatedWorker registry origin acceptance passed; all transport synthetic, no keys or spending.");
} finally { await browser.close(); }
