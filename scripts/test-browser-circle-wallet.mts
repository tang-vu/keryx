/** Actual pinned Circle Web SDK, real browser/CSP and auth hook; every external/API
 * request intercepted with synthetic identities. No real OAuth, wallets or funds. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { contentSecurityPolicy } from "../lib/security-headers";
import { circleSdkBrowserPlugin } from "./circle-sdk-browser-plugin.mts";

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
  import{startGoogleWalletLogin,resumeGoogleWalletLogin,restoreCircleWalletIdentity,circleWalletCanSign,signCircleWallet}from'./lib/circle-wallet-browser';
  import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
  window.walletReady=()=>circleWalletCanSign();window.startGoogle=startGoogleWalletLogin;
  window.resumeGoogle=async()=>{window.resumed=await resumeGoogleWalletLogin()};
  window.restoreGoogle=async()=>{window.restored=await restoreCircleWalletIdentity()};
  window.signGoogle=async()=>{window.signed=await signCircleWallet('message','0x1234')};
  function Probe(){const auth=useSiweAuth();return <section><output id="auth">{auth.session?'authenticated':'signed out'}</output><button id="logout" onClick={()=>void auth.signOut()}>Sign out</button><button id="signin" onClick={()=>void auth.signIn()}>Sign in</button></section>}
  createRoot(document.getElementById('root')).render(<Probe/>);
`, loader: "tsx", resolveDir: process.cwd() }, write: false, bundle: true, format: "iife", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x1111111111111111111111111111111111111111"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_CIRCLE_APP_ID": '"synthetic-circle-app"',
    "process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID": '"synthetic-google-client"' },
  plugins: [circleSdkBrowserPlugin(), { name: "synthetic-wagmi-only", setup(builder) {
    builder.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ loader: "js", contents: `
      export const useAccount=()=>({address:'${owner}',isConnected:true,connector:{id:'circleGoogle'}});
      export const useSignMessage=()=>({signMessageAsync:()=>{throw Error('Redundant SIWE forbidden')}});
    ` }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext(); let authenticated = false, signChallenges = 0, initializeChallenges = 0;
  const seen: string[] = [], errors: string[] = [], violations: string[] = [];
  await context.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", event => { (window as unknown as { cspErrors: string[] }).cspErrors.push(event.violatedDirective); });
    (window as unknown as { cspErrors: string[] }).cspErrors = [];
  });
  await context.route("**/*", async route => {
    const url = new URL(route.request().url()); seen.push(`${url.origin}${url.pathname}`);
    if (url.origin === "https://pw-auth.circle.com") {
      const payload = url.pathname === "/device-id"
        ? `{deviceId:'${walletId}'}`
        : url.pathname === "/social/verify-token"
          ? `{onSocialLoginVerified:{result:{userToken:'synthetic-circle-user-token',encryptionKey:'synthetic-circle-encryption-key',refreshToken:'synthetic-circle-refresh-token'}}}`
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
    if (url.pathname === "/api/auth/circle/device") return route.fulfill({ json: { deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-encryption-key", state: "a".repeat(64), expiresAt: Date.now() + 600_000 } });
    if (url.pathname === "/api/auth/circle/prepare") { initializeChallenges++; return route.fulfill({ json: { ready: false, challengeId: initializeId } }); }
    if (url.pathname === "/api/auth/circle/session") { authenticated = true; return route.fulfill({ json: { ok: true, address: owner, walletId } }); }
    if (url.pathname === "/api/auth/circle/sign") { signChallenges++; return route.fulfill({ json: { challengeId: signingId } }); }
    assert(["/connect", "/"].includes(url.pathname), `Unexpected application request: ${url.pathname}`);
    return route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body: '<div id="root"></div><script src="/app.js"></script>' });
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/connect`);
  await page.evaluate(() => { void (window as unknown as { startGoogle(): Promise<void> }).startGoogle(); });
  await page.waitForURL("https://accounts.google.com/**");
  // The actual SDK generated its OAuth state/nonce. Read only the synthetic continuation.
  await page.goto(`${base}/connect`);
  const flow = await page.evaluate(() => ({ state: localStorage.getItem("state"), nonce: localStorage.getItem("nonce") }));
  assert(flow.state && flow.nonce);
  const token = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ nonce: flow.nonce })).toString("base64url")}.synthetic`;
  await page.goto(`${base}/connect#id_token=${token}&state=${flow.state}`);
  await page.evaluate(() => { void (window as unknown as { resumeGoogle(): Promise<void> }).resumeGoogle(); });
  await page.frameLocator("#sdkIframe").getByRole("button", { name: "Confirm wallet action" }).click();
  await page.waitForFunction(() => !!(window as unknown as { resumed: unknown }).resumed);
  assert.equal(initializeChallenges, 1); assert.equal(await page.evaluate(() => (window as unknown as { walletReady(): boolean }).walletReady()), true);
  await page.locator("#auth").filter({ hasText: "authenticated" }).waitFor();
  // Google connector's auth branch refreshes the verified cookie without SIWE.
  await page.locator("#signin").click();
  await page.evaluate(() => { void (window as unknown as { signGoogle(): Promise<void> }).signGoogle(); });
  await page.frameLocator("#sdkIframe").getByRole("button", { name: "Confirm wallet action" }).click();
  await page.waitForFunction(() => !!(window as unknown as { signed: unknown }).signed); assert.equal(signChallenges, 1);
  const stored = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "));
  for (const value of ["synthetic-circle-user-token", "synthetic-circle-encryption-key", "synthetic-circle-refresh-token", "synthetic-device-encryption-key"]) assert(!stored.includes(value));
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
      if (url.pathname === "/api/auth/circle/device") return route.fulfill({ json: { deviceToken: "synthetic-built-device", deviceEncryptionKey: "synthetic-built-device-key", state: "b".repeat(64), expiresAt: Date.now() + 600_000 } });
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
