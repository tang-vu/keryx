import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

let browser: Browser, bundle: string, css: string;
const owner = "0x1111111111111111111111111111111111111111";

beforeAll(async () => {
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import("postcss"), import("@tailwindcss/postcss")]);
  css = (await postcss([tailwind({ base: process.cwd() })]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{WalletWorkspace}from'./components/keryx/wallet-workspace';
    import{SessionGrantPanel}from'./components/keryx/session-grant-panel';
    window.actions=[];window.bindings=[];
    window.auth={address:'${owner}',isConnected:true,session:{address:'${owner}',role:'reader'},refresh:async()=>{}};
    window.grant={status:'idle',sessAddr:null,sessionId:null,cap:0,spent:0,expiresAt:null,grantEpoch:null,error:null};
    function App(){const[,render]=useState(0);window.update=(auth,grant)=>{
      if(auth)window.auth={...window.auth,...auth};if(grant)window.grant={...window.grant,...grant};render(n=>n+1)};
      return <main className='mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8'>{window.mode==='chat'?<SessionGrantPanel onBindingChange={value=>window.bindings.push(value)}/>:<WalletWorkspace/>}</main>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x4444444444444444444444444444444444444444"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [{ name: "controlled-wallet-boundary", setup(api) {
      api.onResolve({ filter: /^next\/link$|^wagmi$|use-siwe-auth$|use-session-grant$|circle-google-wallet$|faucet-panel$|arc-card-onramp-panel$|session-signer-client$|browser-session-http$|browser-session-grant-reference$|session-withdrawal-protocol$|browser-session-withdrawal-storage$|browser-session-owner-mint$/ }, args => ({ path: args.path, namespace: "fixture" }));
      api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => {
        const contents = path === "next/link" ? `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`
          : path === "wagmi" ? `export const useAccount=()=>({connector:{id:'circleGoogle'}});export const useWalletClient=()=>({data:window.auth.isConnected?{account:{address:window.auth.address}}:undefined});export const usePublicClient=()=>({});`
          : path.endsWith("use-siwe-auth") ? `export const useSiweAuth=()=>window.auth;`
          : path.endsWith("use-session-grant") ? `const call=(type)=>(...args)=>{window.actions.push({type,args});return Promise.resolve(true)};
            const api={tryRecover:call('restore'),recoverViaSignature:call('recover'),generateAndFund:call('activate'),topUp:call('topup'),extend:call('renew'),revoke:call('stop'),getSessionWalletClient:()=>null,markExpired:()=>{}};
            export const useSessionGrant=()=>({...api,state:window.grant});`
          : path.endsWith("circle-google-wallet") ? `import React from'react';export const CircleGoogleWalletButton=({reconnectOnly})=>reconnectOnly?null:<button onClick={()=>window.actions.push({type:'google'})}>Continue with Google</button>;`
          : path.endsWith("faucet-panel") ? `import React from'react';export const FaucetPanel=()=> <p>Wallet USDC balance unavailable</p>;`
          : path.endsWith("arc-card-onramp-panel") ? `import React from'react';export const ArcCardOnrampPanel=()=>null;`
          : path.endsWith("session-signer-client") ? `export const getSessionSigner=()=>({sessionAddress:'0x2222222222222222222222222222222222222222',restoreRetained:async()=>{window.actions.push({type:'withdrawRestore'})},signWithdrawal:async(id,value)=>{window.withdrawalPhase='exposed';window.actions.push({type:'withdrawSign',id,value});return{id}},reconcileWithdrawal:async()=>{},cancelUnexposedWithdrawal:async()=>{},abortWithdrawal:async()=>{}});`
          : path.endsWith("browser-session-http") ? `export const sessionJson=async(path,method,body)=>{window.actions.push({type:'withdrawHttp',path,method,body});if(path.endsWith('/submit')&&window.loseSubmit)throw Error('Response lost');const preparation={requestId:'original-1',ownerAddr:'${owner}',sessAddr:'0x2222222222222222222222222222222222222222',authorization:{consent:{origin:location.origin}},burnIntent:{spec:{value:body?.amountMicros??'10000'},maxFee:'100',maxBlockHeight:'100'}};return method==='POST'?preparation:{preparation,signingPhase:window.withdrawalPhase??'prepared',progress:{status:window.withdrawalPhase??'prepared'}}};`
          : path.endsWith("browser-session-grant-reference") ? `export const readRetainedSessionGrantReference=()=> 'retained-epoch';`
          : path.endsWith("session-withdrawal-protocol") ? `export const verifySessionWithdrawalPreparation=async value=>value;`
          : path.endsWith("browser-session-withdrawal-storage") ? `export const listBrowserSessionWithdrawalReferences=async()=>window.saved?[{requestId:'saved-original',completed:false,cancelled:false}]:[];export const readBrowserSessionWithdrawal=async()=>window.localWithdrawal??null;export const claimBrowserSessionWithdrawalDelivery=async()=>true;`
          : `export const submitBrowserSessionOwnerMint=async()=>{window.actions.push({type:'mint'});return{transactionHash:'0x'+'aa'.repeat(32)}};`;
        return { contents, loader: "tsx", resolveDir: process.cwd() };
      });
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

async function mount(mode: "wallet" | "chat" = "wallet", width = 390, saved = false) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  await context.addInitScript(value => { Object.assign(window, value); }, { mode, saved });
  const errors: string[] = [];
  await context.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>' });
    if (path === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
    if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/api/auth/session") return route.fulfill({ json: { session: { address: owner, role: "reader" } } });
    errors.push(`Unexpected request ${route.request().method()} ${path}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://wallet.test");
  await page.getByRole(mode === "wallet" ? "heading" : "link", { name: mode === "wallet" ? "Add money" : "Wallet & budget", exact: true }).waitFor();
  return { page, context, errors };
}

type Fixture = {
  actions: Array<{ type: string; args?: unknown[]; path?: string; body?: unknown; value?: unknown }>;
  bindings: Array<{ sessionId: string | null; expired: boolean; paused: boolean; grantCap?: number }>;
  update(auth: Record<string, unknown> | null, grant?: Record<string, unknown>): void;
};

it("puts receiving, budget and withdrawal together without starting a financial action", async () => {
  const { page, context, errors } = await mount();
  try {
    expect(await page.getByRole("navigation", { name: "Wallet & budget" }).getByRole("link").allTextContents()).toEqual(["Add money", "Agent budget", "Withdraw"]);
    expect(await page.getByText(owner, { exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "Review withdrawal", exact: true }).isVisible()).toBe(true);
    expect(await page.getByText("Other ways to add USDC", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).count()).toBe(0);
    expect(await page.getByLabel("Original session withdrawal request", { exact: true }).isVisible()).toBe(false);
    expect((await page.evaluate(() => (window as unknown as Fixture).actions)).every(action => action.type === "restore")).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("keeps chat compact and submits only the explicitly selected budget", async () => {
  const { page, context, errors } = await mount("chat");
  try {
    const enable = page.getByRole("button", { name: "Enable research budget", exact: true });
    expect(await enable.isVisible()).toBe(false);
    await page.getByText("Set up agent budget", { exact: true }).click();
    await page.getByLabel("Total budget (USDC)").fill("0.10");
    await page.getByLabel("Maximum per question (USDC)").fill("0.025");
    await page.getByLabel("Budget duration").selectOption("86400");
    await enable.click();
    expect((await page.evaluate(() => (window as unknown as Fixture).actions)).filter(a => a.type !== "restore")).toEqual([
      { type: "activate", args: [0.1, false, { durationSeconds: 86400, questionCapUsdc: 0.025 }] },
    ]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("preserves the retained spending identity for expired and paused budgets", async () => {
  const { page, context } = await mount("chat");
  try {
    await page.evaluate(() => (window as unknown as Fixture).update(null, { status: "active", sessAddr: "0x2222222222222222222222222222222222222222", sessionId: "retained", cap: .1, spent: .03, researchBudget: { questionCapUsdc: .02, durationSeconds: 86400 } }));
    await page.getByText("Budget ready", { exact: true }).waitFor();
    expect(await page.getByLabel("Remaining allowance").textContent()).toBe("0.070000 USDC");
    for (const status of ["expired", "paused"]) {
      await page.evaluate(status => (window as unknown as Fixture).update(null, { status }), status);
      await page.getByText(status === "expired" ? "Budget expired — review to continue" : "Budget paused — review to continue", { exact: true }).waitFor();
      expect(await page.getByLabel("Remaining allowance").count()).toBe(0);
      const binding = await page.evaluate(() => (window as unknown as Fixture).bindings.at(-1));
      expect(binding?.sessionId).toBe("retained");
      expect(binding?.grantCap).toBeUndefined();
      expect(status === "expired" ? binding?.expired : binding?.paused).toBe(true);
    }
  } finally { await context.close(); }
});

it("hides fund controls when the wallet differs or the user signs out", async () => {
  const { page, context } = await mount();
  try {
    await page.evaluate(() => (window as unknown as Fixture).update({ address: "0x3333333333333333333333333333333333333333" }));
    await page.getByRole("heading", { name: "Reconnect your account wallet" }).waitFor();
    expect(await page.getByRole("button", { name: "Review withdrawal", exact: true }).count()).toBe(0);
    await page.evaluate(() => (window as unknown as Fixture).update({ session: null }));
    await page.getByRole("button", { name: "Continue with Google" }).waitFor();
    expect(await page.getByText(owner, { exact: true }).count()).toBe(0);
  } finally { await context.close(); }
});

it("handles clipboard refusal and keeps recovery available behind its disclosure", async () => {
  const { page, context } = await mount();
  try {
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Denied"); } }, configurable: true }));
    await page.getByRole("button", { name: "Copy address", exact: true }).click();
    await page.getByText("Copy was unavailable. Select and copy the receiving address below.").waitFor();
    await page.getByText("Recovery details", { exact: true }).click();
    await page.getByLabel("Original session withdrawal request", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Keys & recovery", { exact: true }).click();
    await page.getByText(/Private-key export for the Google wallet is not available in Keryx/).waitFor();
    await page.getByText(/Signing in with Google on another device does not restore it/).waitFor();
  } finally { await context.close(); }
});

it.each([320, 768, 1440])("keeps wallet actions usable without horizontal overflow at %i px", async width => {
  const { page, context, errors } = await mount("wallet", width);
  try {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Copy address", "Enable research budget", "Review withdrawal"]) {
      const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    if (process.env.KERYX_WALLET_UX_SCREENSHOTS) {
      mkdirSync(process.env.KERYX_WALLET_UX_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.KERYX_WALLET_UX_SCREENSHOTS, `wallet-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("reviews the chosen withdrawal and never signs as a side effect of review", async () => {
  const { page, context, errors } = await mount();
  try {
    await page.getByRole("textbox", { name: "Session withdrawal amount", exact: true }).fill("0.01");
    await page.getByRole("textbox", { name: "Session withdrawal maximum fee", exact: true }).fill("0.0001");
    await page.getByRole("button", { name: "Review withdrawal", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as Fixture).actions)).filter(a => a.type === "withdrawHttp")).toEqual([
      { type: "withdrawHttp", path: "/api/session/withdraw/prepare", method: "POST", body: { sessAddr: "0x2222222222222222222222222222222222222222", grantEpoch: "retained-epoch", amountMicros: "10000" } },
    ]);
    expect((await page.evaluate(() => (window as unknown as Fixture).actions)).filter(a => a.type === "withdrawSign" || a.type === "mint")).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it.each([false,true])("keeps original recovery available after status review and submit response loss=%s", async loseSubmit => {
  const { page, context, errors } = await mount();
  try {
    await page.getByRole("textbox", { name: "Session withdrawal amount", exact: true }).fill("0.01");
    await page.getByRole("textbox", { name: "Session withdrawal maximum fee", exact: true }).fill("0.0001");
    await page.getByRole("button", { name: "Review withdrawal", exact: true }).click();
    await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).waitFor();
    await page.getByRole("button", { name: "Check withdrawal status", exact: true }).click();
    await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).waitFor();
    await page.evaluate(value => { Object.assign(window,{loseSubmit:value}); },loseSubmit);
    await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as Fixture).actions)).filter(a => a.type === "withdrawSign").length).toBe(1);
    await page.getByRole("button", { name: "Check withdrawal status", exact: true }).click();
    expect(await page.getByRole("button", { name: "Confirm withdrawal", exact: true }).count()).toBe(0);
    expect((await page.evaluate(() => (window as unknown as Fixture).actions)).filter(a => a.type === "withdrawSign")).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it("returns to review when a saved original or manual request selection is cleared", async () => {
  const { page, context } = await mount("wallet",390,true);
  try {
    const originals = page.getByRole("combobox").filter({ has: page.locator('option[value="saved-original"]') });
    await originals.selectOption("saved-original");
    expect(await page.getByRole("button",{name:"Review withdrawal",exact:true}).count()).toBe(0);
    await originals.selectOption("");
    expect(await page.getByRole("button",{name:"Review withdrawal",exact:true}).isVisible()).toBe(true);
    await page.getByText("Recovery details",{exact:true}).click();
    const id=page.getByLabel("Original session withdrawal request",{exact:true});
    await id.fill("manual-original");
    expect(await page.getByRole("button",{name:"Review withdrawal",exact:true}).count()).toBe(0);
    await id.fill("");
    expect(await page.getByRole("button",{name:"Review withdrawal",exact:true}).isVisible()).toBe(true);
  } finally { await context.close(); }
});

it("keeps signing hidden when local exposure survives a prepared server response", async () => {
  const { page, context } = await mount();
  try {
    await page.getByRole("textbox",{name:"Session withdrawal amount",exact:true}).fill("0.01");
    await page.getByRole("textbox",{name:"Session withdrawal maximum fee",exact:true}).fill("0.0001");
    await page.getByRole("button",{name:"Review withdrawal",exact:true}).click();
    await page.getByRole("button",{name:"Confirm withdrawal",exact:true}).waitFor();
    await page.evaluate(()=>Object.assign(window,{localWithdrawal:{exposed:true,submissionPossible:true}}));
    await page.getByRole("button",{name:"Check withdrawal status",exact:true}).click();
    await expect.poll(()=>page.getByRole("button",{name:"Confirm withdrawal",exact:true}).count()).toBe(0);
  } finally { await context.close(); }
});
