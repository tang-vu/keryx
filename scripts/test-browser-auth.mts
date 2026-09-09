/** Real React hook + wallet menu, synthetic identity/HTTP only. No signer or network. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";
const account = `0x${"1".repeat(40)}`;
const session = { address: account, role: "asker" };
const bundle = await build({ stdin: { contents: `
  import React from 'react';import{createRoot}from'react-dom/client';
  import{WalletMenu}from'./components/keryx/wallet-menu';import{useSiweAuth}from'./lib/hooks/use-siwe-auth';
  window.notices=[];window.disconnects=0;
  function Probe(){const auth=useSiweAuth();return <section><output data-testid="probe">{auth.session?'authenticated':'signed out'}</output><button onClick={()=>{void auth.refresh();}}>Refresh probe</button></section>}
  createRoot(document.getElementById('root')).render(<><WalletMenu/><Probe/></>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "synthetic-auth", setup(b) {
    b.onResolve({ filter: /^(wagmi|next\/link|next\/image|sonner)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
    b.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ loader: "jsx", resolveDir: process.cwd(), contents:
      args.path === "wagmi" ? `export const useAccount=()=>({address:'${account}',isConnected:true,status:'connected'});export const useSignMessage=()=>({signMessageAsync:()=>{throw Error('Signing forbidden')}});export const useDisconnect=()=>({disconnectAsync:async()=>{window.disconnects++}});export const useConnect=()=>({connectors:[],connect:()=>{},isPending:false});`
      : args.path === "sonner" ? `export const toast=message=>window.notices.push({kind:'info',message});toast.error=message=>window.notices.push({kind:'error',message});toast.success=toast;`
      : args.path === "next/image" ? "export default function Image(){return null}"
      : `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}` }));
  } }] });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  let failLogout = true, delayLookup = false, authenticated = true, held: Route | undefined;
  await context.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session") {
      if (delayLookup) { held = route; delayLookup = false; return; }
      return route.fulfill({ status: authenticated ? 200 : 401, json: { session: authenticated ? session : null } });
    }
    if (path === "/api/auth/signout") {
      if (failLogout) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      authenticated = false; return route.fulfill({ json: { ok: true } });
    }
    assert.equal(route.request().method(), "GET", "Unexpected write");
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const page = await context.newPage(); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://auth.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const otherTab = await context.newPage();
  otherTab.on("pageerror", error => errors.push(error.message));
  await otherTab.goto("https://auth.test/"); await otherTab.addScriptTag({ content: bundle.outputFiles[0].text });
  await otherTab.getByRole("button", { name: /asker/ }).waitFor();
  await page.getByRole("button", { name: /asker/ }).waitFor();
  await page.getByRole("button", { name: /asker/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { notices: { kind: string }[] }).notices.some(notice => notice.kind === "error"));
  assert.equal(await page.locator('[data-testid="probe"]').textContent(), "authenticated");
  assert.equal(await page.evaluate(() => (window as unknown as { disconnects: number }).disconnects), 0);
  failLogout = false; delayLookup = true;
  await page.getByRole("button", { name: "Refresh probe", exact: true }).click();
  await page.waitForTimeout(100); assert(held, "Expected a delayed session response");
  await page.getByRole("button", { name: /asker/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).waitFor();
  assert.equal(await page.locator('[data-testid="probe"]').textContent(), "signed out");
  await otherTab.waitForFunction(() => document.querySelector('[data-testid="probe"]')?.textContent === "signed out");
  await held.fulfill({ json: { session } });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-testid="probe"]').textContent(), "signed out", "A stale lookup must not resurrect the signed-out UI");
  assert.equal(await page.evaluate(() => (window as unknown as { disconnects: number }).disconnects), 1);
  assert.deepEqual(errors, []);
  console.log("PASS: real wallet-menu logout failure retains sign-in/connection, confirmed logout clears both hook instances, and a delayed lookup cannot resurrect session UI. All HTTP intercepted; no signing or payments.");
} finally { await browser.close(); }
