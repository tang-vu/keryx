/** Actual pinned Circle Web SDK, real browser/CSP and auth hook; every external/API
 * request intercepted with synthetic identities. No real OAuth, wallets or funds. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { contentSecurityPolicy } from "../lib/security-headers";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";
import { AUTH_CHALLENGE_TTL_MS } from "../lib/auth-time-policy";
import { registrationTarget, sourceClaimTarget } from "../lib/registration-return";

const base = "https://circle-smoke.test", owner = `0x${"1".repeat(40)}`;
const walletId = "00000000-0000-4000-8000-000000000001", initializeId = "00000000-0000-4000-8000-000000000002";
const signingId = "00000000-0000-4000-8000-000000000003";
const overrides = { KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_CIRCLE_GOOGLE_ENABLED: "true",
  NEXT_PUBLIC_CIRCLE_APP_ID: "synthetic-circle-app", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "synthetic-google-client" };
const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
Object.assign(process.env, overrides);
let csp: string;
try { csp = contentSecurityPolicy(true); } finally {
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
const result = await build({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{startGoogleWalletLogin,resumeGoogleWalletLogin,restoreCircleWalletIdentity,circleWalletIdentity,circleWalletCanSign,signCircleWallet}from'./lib/circle-wallet-browser';
  import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
  import ConnectPage from './app/connect/page';
  window.walletReady=()=>circleWalletCanSign();window.startGoogle=startGoogleWalletLogin;
  window.googleIdentity=()=>circleWalletIdentity();
  window.resumeGoogle=async()=>{window.resumeFinished=false;try{window.resumed=await resumeGoogleWalletLogin()}catch(error){window.resumeError=error.message}finally{window.resumeFinished=true}};
  window.restoreGoogle=async()=>{window.restored=await restoreCircleWalletIdentity()};
  window.signGoogle=async()=>{window.signed=await signCircleWallet('message','0x1234')};
  // Observe the same callback promise in the React effect flush, alongside its
  // normal consumer, before the asynchronous SDK continuation or vendor reply.
  function CallbackObserver(){React.useEffect(()=>{if(new URLSearchParams(location.hash.slice(1)).has('id_token'))void window.resumeGoogle();},[]);return null;}
  function Probe(){const auth=useSiweAuth();return <section><output id="auth">{auth.session?'authenticated':'signed out'}</output><button id="logout" onClick={()=>void auth.signOut()}>Sign out</button><button id="signin" onClick={()=>void auth.signIn()}>Sign in</button></section>}
  createRoot(document.getElementById('root')).render(<><Probe/><CallbackObserver/><ConnectPage/></>);
`, loader: "tsx", resolveDir: process.cwd() }, write: false, bundle: true, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x1111111111111111111111111111111111111111"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_CIRCLE_APP_ID": '"synthetic-circle-app"',
    "process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": '"synthetic-google-client"' },
  plugins: [circleSdkBrowserPlugin(), { name: "synthetic-wagmi-only", setup(builder) {
    builder.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ loader: "js", contents: `
      const connector={id:'circleGoogle'},connectors=[connector],connectAsync=async()=>({accounts:['${owner}'],chainId:5042});
      export const useAccount=()=>({address:'${owner}',isConnected:true,connector});
      export const useConnect=()=>({connectors,connectAsync,isPending:false});
      export const useDisconnect=()=>({disconnect:()=>{},disconnectAsync:async()=>{}});
      export const useChainId=()=>5042;
      export const useSwitchChain=()=>({isPending:false,switchChain:()=>{throw Error('Unexpected chain switch')}});
      export const useSignMessage=()=>({signMessageAsync:()=>{throw Error('Redundant SIWE forbidden')}});
    ` }));
    // Keep the actual /connect return-state, callback and SignedInStep. Stub only
    // unrelated layout/picker/session-list UI and Link's framework navigation.
    builder.onResolve({ filter: /^(?:next\/link|@\/components\/keryx\/(?:site-header|wallet-picker|account-sessions))$/ }, args => ({ path: args.path, namespace: "circle-return-ui" }));
    builder.onLoad({ filter: /.*/, namespace: "circle-return-ui" }, args => ({ loader: "js", resolveDir: process.cwd(), contents: args.path === "next/link"
      ? "import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children)}"
      : "export const SiteHeader=()=>null,WalletPicker=()=>null,AccountSessions=()=>null;" }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); let authenticated = false, signChallenges = 0, initializeChallenges = 0, needsInitialization = true, walletPreparations = 0, walletSessions = 0;
  let vendorDeviceFrames = 0, vendorVerifications = 0, walletActionFrames = 0;
  let verificationMode: "success" | "nonce-mismatch" | "vendor-refusal" = "success";
  const seen: string[] = [], errors: string[] = [], violations: string[] = [];
  await context.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", event => { (window as unknown as { cspErrors: string[] }).cspErrors.push(event.violatedDirective); });
    (window as unknown as { cspErrors: string[] }).cspErrors = [];
    const probe = window as unknown as { authEvents: number; resumeError?: string; verificationReceipts: unknown[]; vendorLoginReplies: unknown[] };
    probe.authEvents = 0; probe.verificationReceipts = []; probe.vendorLoginReplies = [];
    window.addEventListener("keryx:auth", () => { probe.authEvents++; });
    window.addEventListener("message", event => {
      if (event.origin === "https://pw-auth.circle.com" && event.data?.syntheticVerification) {
        probe.verificationReceipts.push({ ...event.data.syntheticVerification, rejectedBeforeVendorReply: !!probe.resumeError });
      }
      if (event.origin === "https://pw-auth.circle.com" && event.data?.onSocialLoginVerified) {
        probe.vendorLoginReplies.push({ code: event.data.onSocialLoginVerified.error?.code ?? null, hasResult: !!event.data.onSocialLoginVerified.result });
      }
    });
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()); seen.push(`${url.origin}${url.pathname}`);
    if (url.origin === "https://pw-auth.circle.com") {
      if (url.pathname === "/device-id") vendorDeviceFrames++;
      else if (url.pathname === "/social/verify-token") {
        vendorVerifications++;
        const reply = verificationMode === "success"
          ? { result: { userToken: "synthetic-circle-user-token", encryptionKey: "synthetic-circle-encryption-key", refreshToken: "synthetic-circle-refresh-token" } }
          : { error: { code: verificationMode === "nonce-mismatch" ? 155140 : 155139, message: "Synthetic vendor token verification refusal" } };
        // Circle 1.1.11 accepts onSocialLoginVerified.error, not onError (which
        // targets challenge completion). Reply only after its real w3s handshake.
        return route.fulfill({ contentType: "text/html", body: `<script>
          let replied=false;addEventListener('message',event=>{
            if(replied||event.origin!=='${base}'||!event.data?.w3s?.socialVerification)return;
            replied=true;const verification=event.data.w3s.socialVerification;
            parent.postMessage({syntheticVerification:{mode:'${verificationMode}',token:verification.token??null,
              provider:verification.socialLoginProvider??null,deviceToken:verification.deviceToken,deviceEncryptionKey:verification.deviceEncryptionKey}},'${base}');
            parent.postMessage({onSocialLoginVerified:${JSON.stringify(reply)}},'${base}');
          });parent.postMessage({onFrameReady:true},'${base}');</script>` });
      } else walletActionFrames++;
      const payload = url.pathname === "/device-id"
        ? `{deviceId:'${walletId}'}`
        : "null";
      return route.fulfill({ contentType: "text/html", body: payload !== "null" ? `<script>parent.postMessage(${payload},'${base}')</script>`
        : `<button id="confirm">Confirm wallet action</button><script>
          let challenge;addEventListener('message',event=>{if(event.origin==='${base}'){challenge=event.data?.w3s?.challenge?.challengeId;parent.postMessage({showUi:true},'${base}')}});
          document.getElementById('confirm').onclick=()=>parent.postMessage({onComplete:true,result:{type:challenge==='${initializeId}'?'INITIALIZE':'SIGN_MESSAGE',status:'COMPLETE',data:{signature:'0x1234'}}},'${base}');
          parent.postMessage({onFrameReady:true},'${base}');</script>` });
    }
    if (url.origin === "https://accounts.google.com") return route.fulfill({ contentType: "text/html", body: "Synthetic Google redirect intercepted" });
    assert.equal(url.origin, base, `Unexpected external request: ${url.origin}`);
    if (url.pathname === "/app.js") return route.fulfill({ contentType: "application/javascript", body: result.outputFiles[0].text });
    if (url.pathname === "/api/auth/session") return route.fulfill({ json: { session: authenticated ? { address: owner, role: "asker" } : null } });
    if (url.pathname === "/api/auth/signout") { authenticated = false; return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === "/api/auth/circle/config") return route.fulfill({ json: { available: true } });
    if (url.pathname === "/api/auth/circle/device") return route.fulfill({ json: { deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-encryption-key", state: "a".repeat(64), expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS } });
    if (url.pathname === "/api/auth/circle/prepare") {
      walletPreparations++;
      if (!needsInitialization) return route.fulfill({ json: { ready: true } });
      initializeChallenges++; return route.fulfill({ json: { ready: false, challengeId: initializeId } });
    }
    if (url.pathname === "/api/auth/circle/session") { walletSessions++; authenticated = true; return route.fulfill({ json: { ok: true, address: owner, walletId } }); }
    if (url.pathname === "/api/auth/circle/sign") { signChallenges++; return route.fulfill({ json: { challengeId: signingId } }); }
    assert(["/connect", "/"].includes(url.pathname), `Unexpected application request: ${url.pathname}`);
    return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body: '<div id="root"></div><script src="/app.js"></script>' });
  });
  // UNRUN R445 regression additions. Constant Wagmi owner deliberately exercises
  // successful Google callbacks that cannot trigger an address-change effect.
  const target = registrationTarget({ url: "https://publisher.example/", rssUrl: "https://publisher.example/feed.xml",
    name: "Publisher", sourceClaimId: "claim_original_445", challengeId: "b".repeat(64), referenceId: "public:publisher",
    fetchPrice: 0.005, chainId: 5042, owner, mode: "wallet-funded", gapId: "gap-original", matchedItemLink: "https://publisher.example/post" });
  const originalAuthority = JSON.stringify({ nonce: "original-payment-nonce", payTo: owner, capMicro: "5000", hold: "unresolved" }); // Sentinel only, not retained payment evidence.
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/connect?${new URLSearchParams({ returnTo: target })}`);
  await page.evaluate(value => sessionStorage.setItem("synthetic-original-payment-authority", value), originalAuthority);
  await page.evaluate(() => { void (window as unknown as { startGoogle(): Promise<void> }).startGoogle(); });
  await page.waitForURL("https://accounts.google.com/**");
  assert.equal(new URL(page.url()).searchParams.get("redirect_uri"), `${base}/connect`, "Vendor callback remains fixed and bare");
  // The actual SDK generated its OAuth state/nonce. Read only the synthetic continuation.
  await page.goto(`${base}/connect`);
  const flow = await page.evaluate(() => ({ state: localStorage.getItem("state"), nonce: localStorage.getItem("nonce") }));
  assert(flow.state && flow.nonce);
  const token = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nonce: flow.nonce })).toString("base64url")}.synthetic`;
  await page.goto(`${base}/connect#id_token=${token}&state=${flow.state}`);
  await page.evaluate(() => { void (window as unknown as { resumeGoogle(): Promise<void> }).resumeGoogle(); });
  await page.frameLocator("#sdkIframe").getByRole("button", { name: "Confirm wallet action" }).click();
  await page.waitForFunction(() => !!(window as unknown as { resumed: unknown }).resumed);
  needsInitialization = false;
  assert.equal(initializeChallenges, 1); assert.equal(await page.evaluate(() => (window as unknown as { walletReady(): boolean }).walletReady()), true);
  await page.locator("#auth").filter({ hasText: "authenticated" }).waitFor();
  const resume = page.getByRole("link", { name: "Resume source registration", exact: true });
  try { await resume.waitFor(); } catch (error) {
    console.error(JSON.stringify({ fixtureFailure: "initial-registration-return", facts: await page.evaluate(expected => {
      const probe = window as unknown as { resumed?: unknown; resumeError?: string; walletReady(): boolean; googleIdentity(): unknown };
      const value = new URLSearchParams(location.search).get("returnTo");
      return { returnPresent: !!value, returnEqualsExpected: value === expected, hashPresent: !!location.hash,
        authProbe: document.querySelector("#auth")?.textContent, resumed: probe.resumed ?? null, resumeError: probe.resumeError ?? null,
        walletReady: probe.walletReady(), identity: probe.googleIdentity() ?? null,
        pendingPresent: sessionStorage.getItem("keryx-circle-google-oauth-v1") !== null,
        pageText: document.body.innerText.slice(0, 2000), linkLabels: [...document.querySelectorAll("a")].map(a => a.textContent) };
    }, target) })); throw error;
  }
  assert.equal(await resume.getAttribute("href"), target);
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), target);
  // Google connector's auth branch refreshes the verified cookie without SIWE.
  await page.locator("#signin").click();
  await page.evaluate(() => { void (window as unknown as { signGoogle(): Promise<void> }).signGoogle(); });
  await page.frameLocator("#sdkIframe").getByRole("button", { name: "Confirm wallet action" }).click();
  await page.waitForFunction(() => !!(window as unknown as { signed: unknown }).signed); assert.equal(signChallenges, 1);
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
  for (const value of ["synthetic-circle-user-token", "synthetic-circle-encryption-key", "synthetic-circle-refresh-token", "synthetic-device-encryption-key"]) assert(!stored.includes(value));
  assert.equal(await page.evaluate(() => sessionStorage.getItem("keryx-circle-google-oauth-v1")), null);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-original-payment-authority")), originalAuthority);
  await page.reload(); await resume.waitFor(); assert.equal(await resume.getAttribute("href"), target);
  assert.equal(await page.evaluate(() => (window as unknown as { walletReady(): boolean }).walletReady()), false, "Reload cannot recover signing credentials");
  // Restore a same-owner public hint, then reconnect to a different exact public
  // claim target. The actual ConnectPage must refresh even though address is constant.
  await page.evaluate(() => { void (window as unknown as { restoreGoogle(): Promise<void> }).restoreGoogle(); });
  await page.waitForFunction(() => !!(window as unknown as { restored: unknown }).restored);
  const claimTarget = sourceClaimTarget({ url: "https://publisher.example/", rssUrl: "https://publisher.example/feed.xml",
    referenceId: "public:publisher", claimId: "claim_original_445", challengeId: "b".repeat(64), owner });
  await page.evaluate(value => history.replaceState(history.state, "", `/connect?${new URLSearchParams({ returnTo: value })}`), claimTarget);
  await page.evaluate(() => { void (window as unknown as { startGoogle(): Promise<void> }).startGoogle(); });
  await page.waitForURL("https://accounts.google.com/**"); await page.goto(`${base}/connect`);
  const reconnect = await page.evaluate(() => ({ state: localStorage.getItem("state"), nonce: localStorage.getItem("nonce") }));
  assert(reconnect.state && reconnect.nonce);
  const reconnectToken = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nonce: reconnect.nonce })).toString("base64url")}.synthetic`;
  await page.goto(`${base}/connect#id_token=${reconnectToken}&state=${reconnect.state}`);
  await page.evaluate(() => { void (window as unknown as { resumeGoogle(): Promise<void> }).resumeGoogle(); });
  await page.waitForFunction(() => !!(window as unknown as { resumed: unknown }).resumed);
  const claimResume = page.getByRole("link", { name: "Resume source claim", exact: true });
  await claimResume.waitFor(); assert.equal(await claimResume.getAttribute("href"), claimTarget);
  assert.equal(initializeChallenges, 1, "Context recovery/reconnect must not add initialization");
  assert.equal(signChallenges, 1, "Context recovery/reconnect must not add signing");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-original-payment-authority")), originalAuthority);
  for (const failure of ["cancelled", "expired", "mismatched-state", "cross-origin", "different-owner"]) {
    const before = [walletPreparations, walletSessions];
    await page.evaluate(value => history.replaceState(history.state, "", `/connect?${new URLSearchParams({ returnTo: value })}`), target);
    await page.evaluate(() => { void (window as unknown as { startGoogle(): Promise<void> }).startGoogle(); });
    await page.waitForURL("https://accounts.google.com/**"); await page.goto(`${base}/connect`);
    const pending = await page.evaluate(kind => {
      const raw = sessionStorage.getItem("keryx-circle-google-oauth-v1")!; const record = JSON.parse(raw);
      if (kind === "expired") record.expiresAt = Date.now() - 1;
      if (kind === "cross-origin") record.origin = "https://other.example";
      if (kind === "different-owner") {
        const url = new URL(record.publicReturn.target, location.origin); url.searchParams.set("owner", `0x${"2".repeat(40)}`);
        record.publicReturn.target = url.pathname + url.search;
      }
      sessionStorage.setItem("keryx-circle-google-oauth-v1", JSON.stringify(record));
      return { state: localStorage.getItem("state"), nonce: localStorage.getItem("nonce") };
    }, failure);
    assert(pending.state && pending.nonce);
    const failureToken = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nonce: pending.nonce })).toString("base64url")}.synthetic`;
    const hash = failure === "cancelled" ? `error=access_denied&state=${pending.state}`
      : `id_token=${failureToken}&state=${failure === "mismatched-state" ? "wrong-state" : pending.state}`;
    await page.goto(`${base}/connect#${hash}`);
    await page.evaluate(() => { void (window as unknown as { resumeGoogle(): Promise<void> }).resumeGoogle(); });
    await page.waitForFunction(() => !!(window as unknown as { resumed?: unknown; resumeError?: string }).resumed || !!(window as unknown as { resumeError?: string }).resumeError);
    assert.equal(new URL(page.url()).searchParams.get("returnTo"), null, `Cannot recover ${failure} context`);
    assert.equal(await page.getByRole("link", { name: /Resume source (registration|claim)/ }).count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("keryx-circle-google-oauth-v1")), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-original-payment-authority")), originalAuthority);
    assert.equal(initializeChallenges, 1); assert.equal(signChallenges, 1);
    if (failure !== "different-owner") assert.deepEqual([walletPreparations, walletSessions], before, "Rejected callback must not reach wallet operations");
  }
  // UNRUN nonce/vendor controls: each refusal is bracketed by successful actual
  // SDK callbacks using the identical public target, state/origin/expiry/profile.
  const operations = () => [vendorDeviceFrames, vendorVerifications, walletPreparations, walletSessions, initializeChallenges, signChallenges, walletActionFrames];
  for (const refusal of ["nonce-mismatch", "vendor-refusal"] as const) {
    for (const phase of ["control-before", "refusal", "control-after"]) {
      verificationMode = phase === "refusal" ? refusal : "success";
      authenticated = false; // Synthetic cookie only; an old successful session cannot mask refusal.
      const beforeStart = operations();
      await page.goto(`${base}/connect?${new URLSearchParams({ returnTo: target })}`);
      await page.locator("#auth").filter({ hasText: "signed out" }).waitFor();
      await page.evaluate(() => { void (window as unknown as { startGoogle(): Promise<void> }).startGoogle(); });
      await page.waitForURL("https://accounts.google.com/**");
      assert.equal(new URL(page.url()).searchParams.get("redirect_uri"), `${base}/connect`);
      await page.goto(`${base}/connect`);
      const pending = await page.evaluate(() => ({ record: JSON.parse(sessionStorage.getItem("keryx-circle-google-oauth-v1")!),
        state: localStorage.getItem("state"), nonce: localStorage.getItem("nonce"), provider: localStorage.getItem("socialLoginProvider") }));
      assert(pending.state && pending.nonce); assert.equal(pending.provider, "Google");
      assert.equal(pending.record.oauthState, pending.state); assert.equal(pending.record.oauthNonce, pending.nonce);
      assert.equal(pending.record.state, "a".repeat(64)); assert.equal(pending.record.origin, base);
      assert(pending.record.expiresAt > Date.now() && pending.record.expiresAt <= Date.now() + AUTH_CHALLENGE_TTL_MS);
      assert.deepEqual(pending.record.publicReturn, { target, network: "eip155:5042" });
      assert.deepEqual(operations().map((count, i) => count - beforeStart[i]), [1, 0, 0, 0, 0, 0, 0], "Initiating login adds only one synthetic device frame");
      const nonce = phase === "refusal" && refusal === "nonce-mismatch" ? `${pending.nonce}-mismatch` : pending.nonce;
      const callbackToken = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nonce })).toString("base64url")}.synthetic`;
      const beforeCallback = operations();
      await page.goto(`${base}/connect#id_token=${callbackToken}&state=${pending.state}`);
      await page.evaluate(() => { void (window as unknown as { resumeGoogle(): Promise<void> }).resumeGoogle(); });
      await page.waitForFunction(() => (window as unknown as { resumeFinished?: boolean }).resumeFinished === true, undefined, { timeout: 5_000 });
      await page.waitForFunction(() => {
        const probe = window as unknown as { verificationReceipts: unknown[]; vendorLoginReplies: unknown[] };
        return probe.verificationReceipts.length === 1 && probe.vendorLoginReplies.length === 1;
      }, undefined, { timeout: 5_000 });
      const outcome = await page.evaluate(() => {
        const probe = window as unknown as { resumed?: unknown; resumeError?: string; authEvents: number;
          walletReady(): boolean; googleIdentity(): unknown; verificationReceipts: { mode: string; token: string | null; provider: string | null;
            deviceToken: string; deviceEncryptionKey: string; rejectedBeforeVendorReply: boolean }[]; vendorLoginReplies: { code: number | null; hasResult: boolean }[] };
        return { resumed: probe.resumed ?? null, error: probe.resumeError ?? null, authEvents: probe.authEvents,
          canSign: probe.walletReady(), identity: probe.googleIdentity() ?? null, receipts: probe.verificationReceipts, replies: probe.vendorLoginReplies,
          publicIdentity: localStorage.getItem("keryx-circle-owner-eip155:5042") };
      });
      const receipt = outcome.receipts[0]; assert.equal(receipt.mode, verificationMode);
      assert.deepEqual(outcome.replies, [{ code: phase === "refusal" ? refusal === "nonce-mismatch" ? 155140 : 155139 : null, hasResult: phase !== "refusal" }]);
      assert.equal(receipt.deviceToken, "synthetic-device-token"); assert.equal(receipt.deviceEncryptionKey, "synthetic-device-encryption-key");
      if (phase === "refusal") {
        assert.equal(outcome.error, "Google sign-in could not be verified", "A timeout is never a successful refusal control");
        assert.equal(outcome.resumed, null); assert.equal(outcome.identity, null); assert.equal(outcome.publicIdentity, null);
        assert.equal(outcome.canSign, false); assert.equal(outcome.authEvents, 0); assert.equal(authenticated, false);
        assert.equal(new URL(page.url()).searchParams.get("returnTo"), null);
        assert.equal(await page.getByRole("link", { name: /Resume source (registration|claim)/ }).count(), 0);
        await page.locator("#auth").filter({ hasText: "signed out" }).waitFor();
        const signError = await page.evaluate(async () => {
          try { await (window as unknown as { signGoogle(): Promise<void> }).signGoogle(); return null; }
          catch (error) { return (error as Error).message; }
        });
        assert.equal(signError, "Google wallet authentication expired; sign in again");
        assert.deepEqual(operations().map((count, i) => count - beforeCallback[i]), [0, 1, 0, 0, 0, 0, 0], "Refused callbacks add no prepare/session/init/sign or challenge frame");
        if (refusal === "nonce-mismatch") {
          // SDK 1.1.11 still opens the verification iframe after its local guard
          // rejects. Do not claim zero vendor frames: it forwards no token.
          assert.equal(receipt.token, null); assert.equal(receipt.rejectedBeforeVendorReply, true);
        } else {
          assert.equal(receipt.token, callbackToken); assert.equal(receipt.provider, "Google");
          assert.equal(receipt.rejectedBeforeVendorReply, false, "Valid nonce reaches the supported vendor error boundary");
        }
      } else {
        assert.equal(outcome.error, null); assert.deepEqual(outcome.resumed, { address: owner, walletId });
        assert.deepEqual(outcome.identity, { address: owner, walletId }); assert(outcome.publicIdentity);
        assert.equal(outcome.canSign, true); assert.equal(outcome.authEvents, 1); assert.equal(authenticated, true);
        assert.equal(receipt.token, callbackToken); assert.equal(receipt.provider, "Google"); assert.equal(receipt.rejectedBeforeVendorReply, false);
        await resume.waitFor(); assert.equal(await resume.getAttribute("href"), target);
        assert.equal(new URL(page.url()).searchParams.get("returnTo"), target);
        assert.deepEqual(operations().map((count, i) => count - beforeCallback[i]), [0, 1, 1, 1, 0, 0, 0], "Valid control reaches vendor verification, prepare and session only");
      }
      assert.equal(new URL(page.url()).hash, "");
      assert.equal(await page.evaluate(() => sessionStorage.getItem("keryx-circle-google-oauth-v1")), null);
      for (const key of ["state", "nonce", "socialLoginProvider"]) assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("synthetic-original-payment-authority")), originalAuthority);
      const persisted = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
      for (const secret of ["synthetic-circle-user-token", "synthetic-circle-encryption-key", "synthetic-circle-refresh-token", "synthetic-device-encryption-key"]) assert(!persisted.includes(secret));
      assert.equal(initializeChallenges, 1); assert.equal(signChallenges, 1);
      violations.push(...await page.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors));
    }
  }
  verificationMode = "success";
  const second = await context.newPage(); second.on("pageerror", error => errors.push(error.message));
  await second.goto(`${base}/connect`); await second.evaluate(() => { void (window as unknown as { restoreGoogle(): Promise<void> }).restoreGoogle(); });
  await second.waitForFunction(() => !!(window as unknown as { restored: unknown }).restored);
  assert.equal(await second.evaluate(() => (window as unknown as { walletReady(): boolean }).walletReady()), false, "Public restored identity must not sign");
  await second.locator("#auth").filter({ hasText: "authenticated" }).waitFor();
  await second.locator("#logout").click();
  await page.locator("#auth").filter({ hasText: "signed out" }).waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { walletReady(): boolean }).walletReady()), false, "Cross-tab logout must clear original Circle credentials");
  violations.push(...await page.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors),
    ...await second.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors));
  assert.deepEqual(errors, []); assert.deepEqual(violations, []);
  assert(seen.includes("https://pw-auth.circle.com/device-id")); assert(seen.includes("https://pw-auth.circle.com/social/verify-token"));
  console.log("PASS: actual Circle Web SDK loads under production CSP, device/OAuth/confirmation callbacks work, token credentials stay in memory, new tabs restore only verified public identity, Google skips SIWE and cross-tab logout clears custody. All vendor/API transport synthetic; no real wallets or funds.");
  await context.close();

  // The configured Next build is an additional acceptance gate: click the real
  // /connect button to load its emitted SDK chunk under its own served CSP.
  const distOption = process.argv.indexOf("--next-dist");
  if (distOption >= 0) {
    assert(process.argv[distOption + 1], "--next-dist requires a configured build directory");
    const dist = resolve(process.argv[distOption + 1]), builtBase = "https://circle-built.test";
    const manifest = JSON.parse(await readFile(resolve(dist, "routes-manifest.json"), "utf8"));
    const policy = manifest.headers.find((rule: { source: string }) => rule.source === "/(.*)")?.headers
      .find((header: { key: string }) => header.key.toLowerCase() === "content-security-policy")?.value;
    assert(typeof policy === "string" && policy.includes("https://pw-auth.circle.com") && !policy.includes("'unsafe-eval'"));
    const html = await readFile(resolve(dist, "server/app/connect.html"), "utf8");
    const built = await browser.newContext(); const builtErrors: string[] = []; let deviceFrames = 0;
    await built.addInitScript(() => {
      (window as unknown as { cspErrors: string[] }).cspErrors = [];
      window.addEventListener("securitypolicyviolation", event => { (window as unknown as { cspErrors: string[] }).cspErrors.push(event.violatedDirective); });
    });
    await built.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === "https://pw-auth.circle.com") {
        assert.equal(url.pathname, "/device-id", "Built import smoke must never initialize or sign a wallet"); deviceFrames++;
        return route.fulfill({ contentType: "text/html", body: `<script>parent.postMessage({deviceId:'${walletId}'},'${builtBase}')</script>` });
      }
      if (url.origin === "https://accounts.google.com") return route.fulfill({ contentType: "text/html", body: "Synthetic Google redirect intercepted" });
      if (url.origin !== builtBase) return route.abort();
      if (url.pathname === "/api/auth/session") return route.fulfill({ json: { session: null } });
      if (url.pathname === "/api/auth/circle/config") return route.fulfill({ json: { available: true } });
      if (url.pathname === "/api/auth/circle/device") return route.fulfill({ json: { deviceToken: "synthetic-built-device", deviceEncryptionKey: "synthetic-built-device-key", state: "b".repeat(64), expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS } });
      // No application server, DB, source API or live vendor call runs in this check.
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Synthetic emitted-bundle smoke has no live API" } });
      assert.equal(route.request().method(), "GET", "Built smoke forbids application writes");
      if (url.pathname === "/connect" && !url.searchParams.has("_rsc")) return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": policy }, body: html });
      if (url.pathname.startsWith("/_next/static/")) {
        const file = resolve(dist, "static", decodeURIComponent(url.pathname.slice("/_next/static/".length)));
        assert(file.startsWith(resolve(dist, "static") + sep), "Static fixture path must remain in emitted build");
        return route.fulfill({ body: await readFile(file), contentType: file.endsWith(".js") ? "application/javascript"
          : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream" });
      }
      // Link prefetch and images are irrelevant to SDK import; all remain intercepted.
      return route.fulfill({ status: 404, contentType: "text/plain", body: "Synthetic emitted-bundle smoke" });
    });
    const emitted = await built.newPage(); emitted.on("pageerror", error => builtErrors.push(error.message));
    const response = await emitted.goto(`${builtBase}/connect`);
    assert(response?.ok()); assert.equal(response.headers()["content-security-policy"], policy);
    await emitted.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await emitted.waitForURL("https://accounts.google.com/**");
    assert.equal(deviceFrames, 1); assert.deepEqual(builtErrors, []);
    // Returning to the app origin lets us inspect only public SDK flow state.
    await emitted.goto(`${builtBase}/connect`);
    assert.deepEqual(await emitted.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors), []);
    assert(await emitted.evaluate(() => !!localStorage.getItem("state") && !!localStorage.getItem("nonce")));
    console.log("PASS: configured production Next /connect loads its actual emitted Circle SDK chunk, opens the exact allowed device iframe and generates a Google OAuth redirect without browser Node polyfills or relaxed CSP. Transport synthetic; no login or signing authority issued.");
    await built.close();
  }
} finally { await browser.close(); }
