/** Actual Chromium workers + IndexedDB. All HTTP is intercepted; synthetic keys, no funds/RPC. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE } from "../lib/arc-network-profile";
import { createIsolatedSessionContext } from "../lib/session/isolated-session-context";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), payee = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
const origin = "https://isolated-session.test";
const input = { profile: ARC_MAINNET_PROFILE, origin, owner: owner.address, epoch: "browser-fixture",
  candidateDigest: `0x${"33".repeat(32)}` as Hex, maxPaymentMicroUsdc: "10000", expiresAtSeconds: 2_000_003_600 };
const pinned = createIsolatedSessionContext(input), signature = await owner.signMessage({ message: pinned.derivationMessage });
const bundles = new Map<string, string>();
for (const [name, epoch] of [["main", input.epoch], ["next", "other-epoch"], ["aborted", "aborted-write"]]) {
  const { profile: _profile, ...context } = { ...input, epoch };
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import { ARC_MAINNET_PROFILE } from './lib/arc-network-profile';
import { createIsolatedSessionSigner } from './lib/session/isolated-session-signer';
import { indexedDbWrappingKeyStore } from './lib/session/isolated-session-vault';
const signer = createIsolatedSessionSigner({...${JSON.stringify(context)}, profile: ARC_MAINNET_PROFILE}, {
  store:indexedDbWrappingKeyStore(),currentOrigin:()=>self.location.origin,nowSeconds:()=>2000000000,
  authorisedPayees:async()=>new Set([${JSON.stringify(payee.toLowerCase())}]) });
self.onmessage = async ({data:r}) => { try { let result;
  switch(r.type) {
    case 'context':result=signer.context;break;
    case 'derive':result=await signer.derive(r.signature);break;
    case 'restore':result=await signer.restore(r.blob);break;
    case 'sign':result=await signer.signPayment(r.payload);break;
    case 'clear':result=await signer.clear();break;
    case 'abortNextWrite':{const original=IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add=function(...args){IDBObjectStore.prototype.add=original;
        const req=original.apply(this,args);this.transaction.abort();return req;};result=true;break;}
    default:throw new Error('unknown fixture operation');
  } self.postMessage({id:r.id,ok:true,result});
}catch(error){self.postMessage({id:r.id,ok:false,error:error.message});} };
` }, bundle: true, write: false, platform: "browser", format: "iife" });
  bundles.set(`/worker-${name}.js`, bundle.outputFiles[0].text);
}
type Fixture = { call(name: string, type: string, args?: Record<string, unknown>): Promise<unknown> };
const browser = await chromium.launch({ headless: true });
let requests = 0;
try {
  const context = await browser.newContext();
  await context.route("**/*", route => {
    requests++; const url = new URL(route.request().url());
    assert.equal(route.request().method(), "GET");
    assert.ok([origin, "https://foreign-session.test"].includes(url.origin));
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<main>Signer fixture</main>" });
    const body = bundles.get(url.pathname); assert.ok(body, "only statically compiled fixture workers may load");
    return route.fulfill({ contentType: "application/javascript", body });
  });
  async function mount(page: Page, at = origin) {
    await page.goto(`${at}/`);
    await page.evaluate(() => {
      const workers = new Map<string, Worker>(), pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(); let seq = 0;
      (window as unknown as { fixture: Fixture }).fixture = { call(name, type, args = {}) {
        let worker = workers.get(name);
        if (!worker) { worker = new Worker(`/worker-${name}.js`);
          worker.onmessage = ({data:r}) => { const slot=pending.get(r.id); if(!slot)return;pending.delete(r.id);
            if(r.ok)slot.resolve(r.result);else slot.reject(new Error(r.error)); };
          worker.onerror = () => {for(const slot of pending.values())slot.reject(new Error("fixture worker unavailable"));pending.clear();};workers.set(name,worker); }
        const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker!.postMessage({id,type,...args});});
      } };
    });
  }
  const call = (page: Page, name: string, type: string, args: Record<string, unknown> = {}) => page.evaluate(({name,type,args}) =>
    (window as unknown as { fixture: Fixture }).fixture.call(name,type,args), {name,type,args});
  const pages = await Promise.all([context.newPage(),context.newPage()]); await Promise.all(pages.map(page=>mount(page)));
  const [first,second]=pages;
  assert.equal((await call(first,"main","context") as typeof pinned).derivationMessage,pinned.derivationMessage);
  const derived = await Promise.all(pages.map(page=>page.evaluate(async signature=>{
    const blob=await (window as unknown as {fixture:Fixture}).fixture.call("main","derive",{signature}) as {
      wrapped:Uint8Array;iv:Uint8Array;address:string;contextDigest:string;format:string};
    const serialized={...blob,wrapped:Array.from(blob.wrapped),iv:Array.from(blob.iv)};
    sessionStorage.setItem("fixture-ciphertext",JSON.stringify(serialized));return serialized;
  },signature)));
  assert.equal(derived[0].address,derived[1].address);
  assert.deepEqual(Object.keys(derived[0]).sort(),["address","contextDigest","format","iv","wrapped"]);
  const restore=(page:Page,name:string,serialized:Record<string,unknown>)=>page.evaluate(({name,serialized})=>
    (window as unknown as {fixture:Fixture}).fixture.call(name,"restore",{blob:{...serialized,
      wrapped:Uint8Array.from(serialized.wrapped as number[]),iv:Uint8Array.from(serialized.iv as number[])}}),{name,serialized});
  assert.equal(await restore(first,"main",derived[1]),derived[0].address);
  assert.equal(await restore(second,"main",derived[0]),derived[0].address);
  await mount(first);
  assert.equal(await first.evaluate(()=>{
    const saved=JSON.parse(sessionStorage.getItem("fixture-ciphertext")!);
    return (window as unknown as {fixture:Fixture}).fixture.call("main","restore",{blob:{...saved,wrapped:Uint8Array.from(saved.wrapped),iv:Uint8Array.from(saved.iv)}});
  }),derived[0].address);
  const address=derived[0].address as Hex;
  const payload={domain:{name:"GatewayWalletBatched",version:"1",chainId:5042,verifyingContract:ARC_MAINNET_PROFILE.gatewayWallet},primaryType:"TransferWithAuthorization" as const,
    types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},{name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},
    message:{from:address,to:payee,value:BigInt(2000),validAfter:BigInt(1_999_999_400),validBefore:BigInt(2_000_691_200),nonce:`0x${"44".repeat(32)}` as Hex}};
  const signed=await call(first,"main","sign",{payload}) as Hex;
  assert.equal(await recoverTypedDataAddress({...payload,signature:signed}),address);
  await assert.rejects(call(first,"main","sign",{payload:{...payload,domain:{...payload.domain,chainId:5042002}}}));
  await assert.rejects(call(first,"next","derive",{signature}));
  await assert.rejects(restore(first,"next",derived[0]));
  await assert.rejects(restore(first,"main",{...derived[0],address:payee}));
  // Prove the documented same-origin residual without returning plaintext or AES key bytes.
  assert.deepEqual(await first.evaluate(async ({namespace,blob})=>{
    const key=await new Promise<CryptoKey>(resolve=>{const req=indexedDB.open(namespace,1);req.onsuccess=()=>{
      const db=req.result,tx=db.transaction("wrap-keys","readonly"),read=tx.objectStore("wrap-keys").get("wrapping-key-v2");tx.oncomplete=()=>{db.close();resolve(read.result);};};});
    let exportRefused=false;try{await crypto.subtle.exportKey("raw",key);}catch{exportRefused=true;}
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(blob.iv),additionalData:new TextEncoder().encode(`${blob.contextDigest}\n${blob.address.toLowerCase()}`)},key,Uint8Array.from(blob.wrapped));
    return {exportRefused,sameOriginDecryptPossible:/^0x[0-9a-f]{64}$/.test(new TextDecoder().decode(plain))};
  },{namespace:pinned.storageNamespace,blob:derived[0]}),{exportRefused:true,sameOriginDecryptPossible:true});
  const aborted=createIsolatedSessionContext({...input,epoch:"aborted-write"});
  const abortedSignature=await owner.signMessage({message:aborted.derivationMessage});
  await call(first,"aborted","abortNextWrite");await assert.rejects(call(first,"aborted","derive",{signature:abortedSignature}));
  await assert.rejects(call(first,"aborted","sign",{payload}));await call(first,"aborted","derive",{signature:abortedSignature});
  await call(first,"main","clear");await assert.rejects(restore(first,"main",derived[0]));
  const foreign=await context.newPage();await mount(foreign,"https://foreign-session.test");await assert.rejects(call(foreign,"main","derive",{signature}));
  assert.ok(requests<=16,"bounded to fixture documents and workers");
  console.log("Chromium isolated signer acceptance passed: worker/IndexedDB concurrent key retention, reload, signatures, AAD, aborted writes, namespace clear and explicit XSS residual; no live runtime/funds.");
} finally {await browser.close();}
