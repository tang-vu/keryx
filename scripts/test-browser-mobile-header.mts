/** Real header, Radix portals and wallet picker; synthetic connectors, no auth or spending. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
type FixtureWindow = Window & {
  walletSelections: string[]; signIns: number; failedConnections: number;
  successfulConnection?: boolean; connectionError?: string; googleReconnect?: boolean; googleOnly?: boolean;
  googleStarts: { reject(error: Error): void }[];
};
const mocks: Record<string, string> = {
  "next/link": `import React from 'react';export default function Link({href,onNavigate,children,...props}){return <a {...props} href={href} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();onNavigate?.({preventDefault(){}});window.pendingNavigation=href;}}>{children}</a>}`,
  "next/navigation": `export const usePathname=()=>'/';`,
  "next/image": `import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}`,
  "wagmi": `import{useSyncExternalStore}from'react';
    let account={status:'disconnected'},listeners=new Set();
    const update=value=>{account=value;for(const listener of listeners)listener();};
    const connectors=[{id:'metaMaskSDK',type:'metaMask',name:'MetaMask'},{id:'walletConnect',type:'walletConnect',name:'WalletConnect'},{id:'circleGoogle',type:'circleGoogle',name:'Google'}];
    export const useAccount=()=>useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>account);
    export const useDisconnect=()=>({disconnectAsync:async()=>{}});
    export const useConnect=()=>({isPending:useAccount().status==='connecting',connectors:window.googleOnly?connectors.filter(connector=>connector.id==='circleGoogle'):connectors,connectAsync:async({connector})=>{
      window.walletSelections.push(connector.id);update({status:'connecting'});
      if(window.successfulConnection){
        await new Promise(resolve=>{
          const modal=document.createElement('div');modal.style='position:fixed;inset:100px 20px auto;z-index:1000;background:white;padding:24px';
          const button=document.createElement('button');button.textContent='Finish wallet connection';
          button.onclick=()=>{modal.remove();setTimeout(()=>{update({status:'connected',address:'0x1111111111111111111111111111111111111111',isConnected:true});resolve();},50)};
          modal.append(button);document.body.append(modal);
        });
        return{accounts:['0x1111111111111111111111111111111111111111']};
      }
      await new Promise(resolve=>setTimeout(resolve,50));update({status:'disconnected'});window.failedConnections++;
      throw new Error(window.connectionError||'Synthetic wallet transport unavailable');
    }});`,
  "@/lib/hooks/use-siwe-auth": `import{useAccount}from'wagmi';const signIn=async()=>{window.signIns++;return{ok:true}};export const useSiweAuth=()=>({...useAccount(),session:null,authState:'idle',signIn,signOut:async()=>{}});`,
  "@/lib/circle-wallet-config": `export const CIRCLE_GOOGLE_CONNECTOR_ID='circleGoogle';export const circleWalletPublicConfigured=()=>true;`,
  "@/lib/circle-wallet-browser": `export const circleWalletIdentity=()=>window.googleReconnect?{address:'0x1111111111111111111111111111111111111111'}:null;
    export const circleWalletCanSign=()=>false;export const resumeGoogleWalletLogin=async()=>null;
    export const startGoogleWalletLogin=()=>new Promise((resolve,reject)=>window.googleStarts.push({resolve,reject}));`,
  "./dispatch-wire": `export const DispatchWire=()=>null;`,
};
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SiteHeader}from'./components/keryx/site-header';import{Toaster}from'sonner';window.walletSelections=[];window.signIns=0;window.failedConnections=0;window.googleStarts=[];createRoot(document.getElementById('root')).render(<><SiteHeader/><main><button id="outside" style={{position:'fixed',bottom:0}}>Outside the header</button></main><Toaster/></>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env.CI": '"false"',
    "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x1111111111111111111111111111111111111111"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" }, plugins: [{ name: "synthetic-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });

const engine = process.argv.includes("--webkit") ? webkit : chromium;
const browser = await engine.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const unexpectedRequests: string[] = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "https://header.test" && route.request().method() === "GET") {
      if (url.pathname === "/api/auth/circle/config") return route.fulfill({ json: { available: true } });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>` });
    }
    unexpectedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  async function ready() {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("https://header.test");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Open menu" }).tap();
  }
  async function chooseWallet(name: string, id: string) {
    await ready();
    await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
    // Real touch sequence emits mousedown before click. The portal must survive both.
    await page.getByRole("button", { name: new RegExp(name) }).tap();
    assert.deepEqual(await page.evaluate(() => (window as unknown as { walletSelections: string[] }).walletSelections), [id], `${name} selection must reach the connector exactly once`);
    await page.getByText("Synthetic wallet transport unavailable", { exact: true }).waitFor();
    assert(await page.locator("#mobile-site-menu").isVisible(), "A wallet portal interaction must not dismiss its mobile parent");
  }
  await chooseWallet("MetaMask", "metaMaskSDK");
  await chooseWallet("WalletConnect", "walletConnect");
  async function finishConnection() {
    await page.getByRole("button", { name: "Finish wallet connection" }).tap();
    await page.waitForFunction(() => (window as FixtureWindow).signIns >= 1);
    await page.getByRole("button", { name: /^Sign in/, includeHidden: true }).first().waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => (window as FixtureWindow).signIns), 1, "Only the current successful selection may auto-sign in");
  }
  async function desktopSuccess() {
    // Cross the actual lg breakpoint. This checks retained hidden instances,
    // without implying an iPhone's landscape viewport reaches desktop width.
    await page.evaluate(() => { (window as FixtureWindow).googleOnly = false; });
    await page.locator("#outside").tap();
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.evaluate(() => { (window as FixtureWindow).successfulConnection = true; });
    await page.getByRole("button", { name: "Connect Wallet", exact: true }).tap();
    await page.getByRole("button", { name: /WalletConnect/ }).tap();
    await finishConnection();
  }
  for (const failure of ["Synthetic wallet transport unavailable", "User rejected the request", "Wallet modal closed"]) {
    await ready();
    await page.evaluate(message => { (window as FixtureWindow).connectionError = message; }, failure);
    await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
    await page.getByRole("button", { name: /MetaMask/ }).tap();
    await page.waitForFunction(() => (window as FixtureWindow).failedConnections === 1);
    if (failure !== "Synthetic wallet transport unavailable") assert.equal(await page.locator("[data-sonner-toast]").count(), 0, "Cancellation stays silent");
    await desktopSuccess();
  }
  // Use the actual Google button, with only its SDK/HTTP transport synthetic.
  for (const googleOnly of [false, true]) {
    for (const googleReconnect of [false, true]) {
      await ready();
      await page.evaluate(options => { Object.assign(window, options); }, { googleOnly, googleReconnect });
      await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
      await page.getByRole("button", { name: "Continue with Google", exact: true }).tap();
      if (googleReconnect) {
        await page.waitForFunction(() => (window as FixtureWindow).googleStarts.length === 1);
        await page.evaluate(() => { (window as FixtureWindow).googleStarts[0].reject(new Error("Synthetic OAuth startup failed")); });
      } else {
        await page.waitForFunction(() => (window as FixtureWindow).failedConnections === 1);
        assert.deepEqual(await page.evaluate(() => (window as FixtureWindow).walletSelections), ["circleGoogle"]);
      }
      await page.getByText("Google wallet sign-in could not start. Please try again.", { exact: true }).waitFor();
      await desktopSuccess();
    }
  }
  // Google startup has no Wagmi connecting status: its picker can reopen while
  // the older promise is pending. That rejection must not erase the newer choice.
  await ready();
  await page.evaluate(() => { (window as FixtureWindow).googleReconnect = true; });
  await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).tap();
  await page.waitForFunction(() => (window as FixtureWindow).googleStarts.length === 1);
  await page.evaluate(() => { (window as FixtureWindow).successfulConnection = true; });
  await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
  await page.getByRole("button", { name: /WalletConnect/ }).tap();
  await page.evaluate(() => { (window as FixtureWindow).googleStarts[0].reject(new Error("Older OAuth startup failed")); });
  await page.getByText("Google wallet sign-in could not start. Please try again.", { exact: true }).waitFor();
  await finishConnection();
  await ready();
  await page.evaluate(() => { (window as unknown as { successfulConnection: boolean }).successfulConnection = true; });
  await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
  await page.getByRole("button", { name: /WalletConnect/ }).tap();
  await page.locator("#mobile-site-menu").getByRole("status").filter({ hasText: "Connecting" }).waitFor();
  // The vendor's modal has its own body portal. Its touch may close the outer
  // menu, but must not destroy the selected wallet's one-time sign-in intent.
  await page.getByRole("button", { name: "Finish wallet connection" }).tap();
  await page.waitForFunction(() => (window as unknown as { signIns: number }).signIns === 1);
  assert.equal(await page.locator("#mobile-site-menu").isVisible(), false);
  await page.getByRole("button", { name: "Open menu" }).tap();
  await page.locator("#mobile-site-menu").getByRole("button", { name: /^Sign in/ }).waitFor();
  assert.equal(await page.evaluate(() => (window as unknown as { signIns: number }).signIns), 1);
  await ready();
  await page.locator("#mobile-site-menu").getByRole("link", { name: "Activity & proof" }).tap();
  assert.equal(await page.evaluate(() => (window as unknown as { pendingNavigation: string }).pendingNavigation), "/dashboard");
  assert.equal(await page.locator("#mobile-site-menu").isVisible(), false, "Close the menu when navigation starts, before the delayed route completes");
  await ready();
  await page.locator("#mobile-site-menu").getByText("More tools", { exact: true }).tap();
  await page.locator("#mobile-site-menu").getByRole("link", { name: "Paid research", exact: true }).tap();
  assert.equal(await page.locator("#mobile-site-menu").isVisible(), false);
  await ready();
  await page.locator("#outside").tap();
  assert.equal(await page.locator("#mobile-site-menu").isVisible(), false, "Outside touch still dismisses the menu");
  await ready();
  await page.locator("#mobile-site-menu").getByRole("button", { name: "Connect Wallet" }).tap();
  await page.getByRole("button", { name: /MetaMask/ }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#mobile-site-menu").isVisible(), false);
  await page.getByRole("button", { name: /MetaMask/ }).waitFor({ state: "detached" });
  await page.waitForFunction(() => document.body.style.pointerEvents !== "none");
  assert(await page.getByRole("button", { name: "Open menu" }).evaluate(button => button === document.activeElement));
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log(`PASS (${engine.name()}): mobile wallet taps survive Radix portals; failed/cancelled choices and both Google failure paths disarm hidden intent; older Google failure preserves the newer selection; external modal preserves exactly one sign-in; navigation, outside touch and Escape work. Synthetic transport only; no real wallet, authentication or funds.`);
  await context.close();
} finally { await browser.close(); }
