/** Actual React hooks, synthetic wallet/storage/HTTP. No payment or external network. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";
import { SiweMessage } from "siwe";
const owner = `0x${"1".repeat(40)}`, signer = `0x${"2".repeat(40)}`;
const utc = Date.parse("2026-10-01T00:00:00.000Z");
const authDates = { nonce: "syntheticNonce12345", issuedAt: new Date(utc).toISOString(),
  challengeExpiresAt: new Date(utc + 300000).toISOString(), sessionExpiresAt: new Date(utc + 7 * 86400000).toISOString() };
const fixture = await build({ stdin: { contents: `
 import React from 'react';import{createRoot}from'react-dom/client';
 import{SessionGrantPanel}from'./components/keryx/session-grant-panel';import{AskForm}from'./components/keryx/ask-form';import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
 window.fixtureWallet={account:{address:'${owner}'},chain:{id:5042002},signMessage:()=>new Promise((resolve,reject)=>{window.resolveRecovery=resolve;window.rejectRecovery=reject})};window.keyClears=0;window.storageClears=0;window.loginMessages=[];window.gatewayCredit=50000n;
 function Probe(){const auth=useSiweAuth(),[tick,setTick]=React.useState(0),[binding,setBinding]=React.useState({sessionId:null});return <>
 <SessionGrantPanel onBindingChange={setBinding}/><output id="binding">{JSON.stringify(binding)}</output><output id="auth">{auth.session?'authenticated':'signed-out'}</output>
 <AskForm payer={binding.paused?'paused':binding.expired?'expired':binding.sessionId?'session':'treasury'} onAsk={()=>{throw Error('Payment forbidden')}}/>
 <button onClick={()=>setTick(tick+1)}>Rerender</button>
 <button onClick={()=>{void auth.signIn();}}>Sign in</button><output id="tick">{tick}</output></>}
 createRoot(document.getElementById('root')).render(<Probe/>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"', "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-clock-boundaries", setup(b) {
    b.onResolve({ filter: /^(wagmi)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onResolve({ filter: /^@\/lib\/config$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onResolve({ filter: /^@\/components\/keryx\/(grant-spend-dialog|faucet-panel)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onResolve({ filter: /(session-signer-client|session-storage|gateway-deposit|gateway\/read-credit)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents:
      args.path === "wagmi" ? `export const useAccount=()=>({address:'${owner}',isConnected:true});export const useWalletClient=()=>({data:window.fixtureWallet});export const usePublicClient=()=>null;export const useSwitchChain=()=>({switchChainAsync:async()=>{throw Error('Network switch forbidden')}});export const useSignMessage=()=>({signMessageAsync:async({message})=>{window.loginMessages.push(message);return 'synthetic-login-signature'}});`
      : args.path.endsWith("grant-spend-dialog") ? `import React from 'react';export const GrantSpendDialog=({grantState,onTryRecover,onRecoverViaSignature})=><><output id="state">{JSON.stringify(grantState)}</output><button onClick={()=>{void onTryRecover()}}>Recover</button><button onClick={()=>{void onRecoverViaSignature()}}>Signature recovery</button></>;`
      : args.path.endsWith("faucet-panel") ? `export const FaucetPanel=()=>null;`
      : args.path === "@/lib/config" ? `export const config={sessionGrantTtlSeconds:3600,rpcUrl:'https://rpc.invalid'};`
      : args.path.endsWith("session-signer-client") ? `const signer={sessionAddress:'${signer}',restore:async()=> '${signer}',clear:async()=>{window.keyClears++},account:()=>null,deriveFromSignature:async()=>({address:'${signer}',wrapped:{},iv:{}})};export const getSessionSigner=()=>signer;`
      : args.path.endsWith("session-storage") ? `export const readSession=()=>({blob:{},sessAddr:'${signer}',sessionId:'${owner}'});export const clearSession=()=>{window.storageClears++};export const clearPending=()=>{};export const purgeLegacyPlaintextKey=()=>{};export const isPendingFresh=()=>false;export const writeSession=()=>{throw Error('Storage write forbidden')};export const markPending=()=>{throw Error('Pending write forbidden')};`
      : args.path.endsWith("gateway-deposit") ? `export const depositToGateway=()=>{throw Error('Deposit forbidden')};`
      : `export const readGatewayCredit=async()=>window.gatewayCredit;` }));
  } }] });
const browser = await chromium.launch({ headless: true });
try {
  for (const skew of [-86400000, 86400000]) {
    const context = await browser.newContext();
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let epoch = "original", ttl = 1800, remaining = ttl, hold = false, held: Route | undefined, fail = false;
    let holdPost = false, heldPost: Route | undefined;
    let postCount = 0, getCount = 0, verifyCount = 0;
    const response = () => ({ active: true, sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch: epoch,
      expiresAt: new Date(utc + ttl).toISOString(), serverNow: new Date(utc + ttl - remaining).toISOString(), remainingMs: remaining, ttlMs: ttl, cap: 0.05 });
    await context.route("**/*", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.url() === "https://clock.test/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (path === "/api/auth/session") return route.fulfill({ json: { session: { address: owner, role: "asker" } } });
      if (path === "/api/models") return route.fulfill({ json: { models: [] } });
      if (path === "/api/auth/nonce") return route.fulfill({ json: authDates });
      if (path === "/api/auth/verify") { verifyCount++; return route.fulfill({ json: { ok: true, address: owner, role: "asker" } }); }
      if (path === "/api/session/grant" && request.method() === "POST") {
        postCount++; assert.deepEqual(request.postDataJSON(), { sessAddr: signer, budget: 0.05, recover: true });
        if (holdPost) { heldPost = route; return; }
        return route.fulfill({ json: response() });
      }
      if (path === "/api/session/grant" && request.method() === "GET") {
        getCount++; if (hold) { held = route; return; }
        return fail ? route.fulfill({ status: 503, json: { error: "unavailable" } }) : route.fulfill({ json: response() });
      }
      errors.push("Unexpected request"); await route.abort();
    });
    await page.goto("https://clock.test/");
    await page.evaluate(offset => { Date.now = () => Date.parse("2026-10-01T00:00:00.000Z") + offset; }, skew);
    await page.addScriptTag({ content: fixture.outputFiles[0].text });
    await page.waitForTimeout(50); assert.deepEqual(errors, []);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { loginMessages: string[] }).loginMessages.length === 1);
    await page.waitForTimeout(20);
    const login = new SiweMessage(await page.evaluate(() => (window as unknown as { loginMessages: string[] }).loginMessages[0]));
    assert.equal(login.issuedAt, authDates.issuedAt); assert.equal(login.expirationTime, authDates.sessionExpiresAt); assert.equal(verifyCount, 1);
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    const state = async () => JSON.parse((await page.locator("#state").textContent())!) as { status: string; grantEpoch: string; sessAddr: string; sessionId: string };
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "active");
    const start = performance.now();
    await page.waitForTimeout(300); await page.getByRole("button", { name: "Rerender", exact: true }).click();
    await page.evaluate(offset => { Date.now = () => Date.parse("2026-10-01T00:00:00.000Z") - offset; }, skew);
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "expired", undefined, { timeout: 2200 });
    assert(performance.now() - start < 2100, "Rerender extended original UI TTL");
    // A new registration replaces the generation. Focus GET is read-only and cannot extend it.
    epoch = "second"; ttl = 60000; remaining = ttl;
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).grantEpoch === "second");
    remaining = 600; const beforeFocusPosts = postCount;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "expired", undefined, { timeout: 1500 });
    assert.equal(postCount, beforeFocusPosts); assert(getCount >= 1);
    // Late status of the old generation must not alter a newly registered one.
    epoch = "third"; remaining = ttl;
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).grantEpoch === "third");
    hold = true; held = undefined; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    for (let i = 0; i < 50 && !held; i++) await page.waitForTimeout(10);
    assert(held, "No held old-generation lookup");
    epoch = "fourth"; hold = false;
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).grantEpoch === "fourth");
    await held.fulfill({ json: { active: false } }).catch(() => {}); await page.waitForTimeout(30);
    assert.equal((await state()).status, "active");
    fail = true; const lastPosts = postCount;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "paused");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#binding")!.textContent!).paused === true);
    const binding = JSON.parse((await page.locator("#binding").textContent())!);
    assert.equal(binding.sessionId, owner); assert.equal(binding.expired, false); assert.equal(binding.grantCap, undefined);
    await page.getByPlaceholder("Ask a question worth reading for...").fill("Synthetic paused question");
    assert(await page.getByRole("button", { name: "Ask Keryx", exact: true }).isDisabled());
    await page.getByPlaceholder("Ask a question worth reading for...").press("Control+Enter");
    assert(await page.getByText("Session status unavailable. Recover your funded session below before another question.").isVisible());
    await page.getByRole("button", { name: "Signature recovery", exact: true }).click();
    await page.waitForTimeout(30);
    assert.equal((await state()).status, "paused");
    assert.equal(JSON.parse((await page.locator("#binding").textContent())!).sessionId, owner);
    assert(await page.getByRole("button", { name: "Ask Keryx", exact: true }).isDisabled());
    await page.evaluate(() => (window as unknown as { rejectRecovery: (error: Error) => void }).rejectRecovery(new Error("Signature rejected")));
    await page.waitForTimeout(30); assert.equal((await state()).status, "paused");
    await page.evaluate(() => { (window as unknown as { gatewayCredit: bigint }).gatewayCredit = 0n; });
    await page.getByRole("button", { name: "Signature recovery", exact: true }).click();
    await page.evaluate(() => (window as unknown as { resolveRecovery: (signature: string) => void }).resolveRecovery("synthetic-derivation"));
    await page.waitForTimeout(30); assert.equal((await state()).status, "paused");
    assert.equal(JSON.parse((await page.locator("#binding").textContent())!).sessionId, owner);
    assert(await page.getByRole("button", { name: "Ask Keryx", exact: true }).isDisabled());
    await page.evaluate(() => { (window as unknown as { gatewayCredit: bigint }).gatewayCredit = 50000n; });
    assert.equal(postCount, lastPosts); assert.equal((await state()).sessionId, owner); assert.equal((await state()).sessAddr, signer);
    assert.deepEqual(await page.evaluate(() => ({ keys: (window as unknown as { keyClears: number }).keyClears,
      storage: (window as unknown as { storageClears: number }).storageClears })), { keys: 0, storage: 0 });
    // Starting a refresh never suspends the already committed grant's original expiry.
    fail = false; epoch = "zero-credit"; ttl = 1400; remaining = ttl;
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).grantEpoch === "zero-credit");
    await page.evaluate(() => { (window as unknown as { gatewayCredit: bigint }).gatewayCredit = 0n; });
    const zeroPosts = postCount; await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "expired", undefined, { timeout: 2000 });
    assert.equal(postCount, zeroPosts);
    await page.evaluate(() => { (window as unknown as { gatewayCredit: bigint }).gatewayCredit = 50000n; });
    epoch = "pending-refresh";
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).grantEpoch === "pending-refresh");
    holdPost = true; heldPost = undefined; await page.getByRole("button", { name: "Recover", exact: true }).click();
    for (let i = 0; i < 50 && !heldPost; i++) await page.waitForTimeout(10);
    assert(heldPost, "No held refresh request");
    await page.waitForFunction(() => JSON.parse(document.querySelector("#state")!.textContent!).status === "expired", undefined, { timeout: 2000 });
    await heldPost.fulfill({ status: 503, json: { error: "unavailable" } }); holdPost = false;
    // A wallet switch during POST must reject the old owner's acknowledgment before activation.
    epoch = "owner-switch"; ttl = 60000; remaining = ttl; holdPost = true; heldPost = undefined;
    await page.getByRole("button", { name: "Recover", exact: true }).click();
    for (let i = 0; i < 50 && !heldPost; i++) await page.waitForTimeout(10);
    assert(heldPost, "No held owner request");
    await page.evaluate(() => { (window as unknown as { fixtureWallet: { account: { address: string }; chain: { id: number } } }).fixtureWallet =
      { account: { address: `0x${"3".repeat(40)}` }, chain: { id: 5042002 } }; });
    await page.getByRole("button", { name: "Rerender", exact: true }).click();
    await heldPost.fulfill({ json: response() }); await page.waitForTimeout(50);
    assert.notEqual((await state()).status, "active"); assert.notEqual((await state()).grantEpoch, "owner-switch");
    assert.deepEqual(errors, []); await context.close();
  }
  console.log("PASS real auth/grant hooks: UTC skew, fixed TTL/rerender, readonly focus clamp/failure, stale generation, retained key, refresh expiry and owner-switch races");
} finally { await browser.close(); }
