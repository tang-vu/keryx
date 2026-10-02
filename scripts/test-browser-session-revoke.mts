/** Real hook, dedicated worker, IDB and crypto. Intercepted synthetic HTTP; no funds/RPC. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`).address.toLowerCase();
const signature = `0x${"22".repeat(65)}`;
const origin = "https://session-revoke.test";
const worker = await build({ entryPoints: ["lib/session/session-signer.worker.ts"], bundle: true, write: false,
  platform: "browser", format: "iife", define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture-delayed-clear-publication", setup(b) {
    b.onLoad({ filter: /session-signer\.worker\.ts$/ }, args => ({ loader: "ts", contents:
      readFileSync(args.path,"utf8").replace("await destroyWrappingKey();", "await destroyWrappingKey(); self.postMessage({id:-1,ok:true,result:'clear-deleted'}); await new Promise(resolve=>setTimeout(resolve,800));") }));
  } }] });
const renderer = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{useSessionGrant}from'./lib/hooks/use-session-grant';
import{getSessionSigner}from'./lib/session/session-signer-client';
import{writeSession,readSession}from'./lib/session/session-storage';
function Probe(){const grant=useSessionGrant();window.fixtureGrant=grant;
  const seed=async()=>{const{address,wrapped,iv}=await getSessionSigner().deriveFromSignature('${signature}');writeSession({wrapped,iv},address,'${owner}');await grant.tryRecover();};
  return <main><output id="state">{JSON.stringify(grant.state)}</output><button onClick={()=>void seed()}>Seed retained session</button>
    <button onClick={()=>void grant.revoke()}>Revoke</button><button onClick={()=>void grant.tryRecover()}>Restore retained session</button>
    <button onClick={()=>void grant.recoverViaSignature()}>Recover with signature</button></main>}
createRoot(document.getElementById('root')).render(<Probe/>);window.fixtureStored=readSession;
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-wallet-and-worker-url", setup(b) {
    b.onResolve({ filter: /^wagmi$/ }, () => ({path:"wallet",namespace:"fixture"}));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "ts", contents:
      `const wallet={account:{address:'${owner}'},chain:{id:5042002},signMessage:async()=>'${signature}'};export const useWalletClient=()=>({data:wallet});export const usePublicClient=()=>null;export const useSwitchChain=()=>({switchChainAsync:async()=>{throw Error('Transactions forbidden')}});` }));
    b.onLoad({ filter: /session-signer-client\.ts$/ }, args => ({ loader: "ts", contents:
      readFileSync(args.path,"utf8").replace('new URL("./session-signer.worker.ts", import.meta.url)','new URL("/worker.js",location.origin)') }));
  } }] });
const browser = await chromium.launch({headless:true});
try {
  const context=await browser.newContext(); let mode="conflict", epoch=0, signer="";
  await context.addInitScript(`const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener('message',event=>{if(event.data.id===-1)window.clearDeletionReady=true;});}};window.__name=fn=>fn;`);
  await context.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,"No live transport allowed");
    if(url.pathname==="/")return route.fulfill({contentType:"text/html",body:'<div id="root"></div><script src="/renderer.js"></script>'});
    if(url.pathname==="/renderer.js")return route.fulfill({contentType:"application/javascript",body:renderer.outputFiles[0].text});
    if(url.pathname==="/worker.js")return route.fulfill({contentType:"application/javascript",body:worker.outputFiles[0].text});
    if(url.pathname==="/api/session/credit")return route.fulfill({json:{status:"known",address:url.searchParams.get("address"),network:"eip155:5042002",available:"10000"}});
    if(url.pathname==="/api/session/grant"){
      if(req.method()==="POST"){signer=req.postDataJSON().sessAddr;epoch++;}
      const now=Date.now();return route.fulfill({json:{active:true,ok:true,sessionId:owner,ownerAddr:owner,sessAddr:signer,cap:0.01,
        grantEpoch:`epoch-${epoch}`,expiresAt:new Date(now+60000).toISOString(),serverNow:new Date(now).toISOString(),remainingMs:60000,ttlMs:60000}});
    }
    assert.equal(url.pathname,"/api/session/revoke");assert.equal(req.method(),"POST");
    if(mode==="conflict")return route.fulfill({status:409,json:{error:"session_changed"}});
    if(mode==="outage")return route.fulfill({status:503,json:{error:"unavailable"}});
    if(mode==="malformed")return route.fulfill({json:{ok:false}});
    return route.fulfill({json:{ok:true,sessAddr:signer,residualUsdc:0.008}});
  });
  const page=await context.newPage(),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole("button",{name:"Seed retained session"}).click();
  await page.waitForFunction(()=>JSON.parse(document.getElementById('state')!.textContent!).status==='active');
  const saved=await page.evaluate(()=>JSON.stringify((window as unknown as {fixtureStored:()=>unknown}).fixtureStored()));
  for(const failure of ["conflict","outage","malformed"]){
    mode=failure;await page.getByRole("button",{name:"Revoke",exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(document.getElementById('state')!.textContent!).status==='paused');
    assert.equal(await page.evaluate(()=>JSON.stringify((window as unknown as {fixtureStored:()=>unknown}).fixtureStored())),saved,failure);
    assert.equal(await page.evaluate(()=>(window as unknown as {fixtureGrant:{getSessionWalletClient:()=>unknown}}).fixtureGrant.getSessionWalletClient()),null,"Unconfirmed revoke blocks signing");
    // Native worker restore from the original ciphertext must still decrypt with retained IDB key.
    await page.getByRole("button",{name:"Restore retained session"}).click();
    await page.waitForFunction(()=>JSON.parse(document.getElementById('state')!.textContent!).status==='active');
  }
  mode="success";await page.getByRole("button",{name:"Revoke",exact:true}).click();
  await page.waitForFunction(()=>(window as unknown as {clearDeletionReady:boolean}).clearDeletionReady===true);
  await page.getByRole("button",{name:"Recover with signature"}).click();
  await page.waitForFunction(()=>JSON.parse(document.getElementById('state')!.textContent!).status==='active');
  const renewed=await page.evaluate(()=>JSON.stringify((window as unknown as {fixtureStored:()=>unknown}).fixtureStored()));
  await page.waitForTimeout(900);
  assert.equal(JSON.parse((await page.locator('#state').textContent())!).status,"active","Late old clear cannot reset renewed state");
  assert.equal(await page.evaluate(()=>JSON.stringify((window as unknown as {fixtureStored:()=>unknown}).fixtureStored())),renewed);
  await page.getByRole("button",{name:"Revoke",exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(document.getElementById('state')!.textContent!).status==='revoked');
  assert.equal(await page.evaluate(()=>(window as unknown as {fixtureStored:()=>unknown}).fixtureStored()),null);
  assert.deepEqual(errors,[]);console.log("PASS: real hook/worker/IDB conflict, outage, malformed success, recovery and delayed-clear generation fencing; synthetic only.");
}finally{await browser.close();}
