import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

// Real React hook/dialog and worker client. A controlled port holds lifecycle
// responses at the browser boundary; the normal journey tests use real custody.
let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {useMainnetSessionGrant} from './lib/hooks/use-mainnet-session-grant';
    import {GrantSpendDialog} from './components/keryx/grant-spend-dialog';
    window.operations=[]; window.signatures=0; window.restores=[];
    window.Worker=class {
      listeners=[];
      addEventListener(type,listener){if(type==='message')this.listeners.push(listener)}
      terminate(){}
      postMessage(request){
        window.operations.push(request);
        const reply=(result,error,code)=>queueMicrotask(()=>this.listeners.forEach(listener=>listener({data:
          error?{id:request.id,ok:false,error,code}:{id:request.id,ok:true,result}})));
        if(request.type==='initializeOwner')return reply({derivationMessage:'synthetic initial derivation',storageNamespace:'synthetic'});
        if(request.type==='lock')return reply(null);
        if(request.type==='restoreRetained')return window.restores.push((kind)=>kind==='missing'
          ?reply(null,'No custody','session_custody_missing'):kind==='saved'
          ?reply({address:'0x3333333333333333333333333333333333333333'}):reply(null,'Recovery storage unavailable'));
        if(request.type==='deriveFromSignature')return reply(null,'Synthetic stop before funding');
        return reply(null,'Unexpected signing operation');
      }
    };
    window.wallet={account:{address:'0x1111111111111111111111111111111111111111'},getChainId:async()=>5042,
      getAddresses:async()=>[window.wallet.account.address],signMessage:async()=>{window.signatures++;
        if(window.holdSignature)await new Promise(resolve=>{window.resumeSignature=resolve});return '0x'+'11'.repeat(65)}};
    function Probe(){const [,render]=useState(0);window.changeOwner=()=>{window.wallet={...window.wallet,account:{address:'0x2222222222222222222222222222222222222222'}};render(v=>v+1)};
      window.disconnect=()=>{window.wallet=undefined;render(v=>v+1)};
      const grant=useMainnetSessionGrant();window.grant=grant;return <><output id="state">{JSON.stringify(grant.state)}</output>
        <GrantSpendDialog grantState={grant.state} onActivate={(amount,options)=>grant.generateAndFund(amount,false,options)} onTopUp={grant.topUp} onExtend={grant.extend}
          onRevoke={grant.revoke} onTryRecover={grant.tryRecover} onRecoverViaSignature={grant.recoverViaSignature}/></>}
    createRoot(document.getElementById('root')).render(window.strict?<React.StrictMode><Probe/></React.StrictMode>:<Probe/>);
  ` }, bundle: true, write: false, platform: "browser", format: "esm",
    define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x4444444444444444444444444444444444444444"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
    plugins: [{ name: "synthetic-wallet", setup(builder) {
      builder.onResolve({ filter: /^wagmi$/ }, () => ({ path: "wagmi", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents:
        "export const useWalletClient=()=>({data:window.wallet});export const usePublicClient=()=>({});export const useSwitchChain=()=>({switchChainAsync:async()=>{}});" }));
    } }] })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

type Fixture = {
  restores: Array<(kind: string) => void>;
  operations: Array<{ type: string; owner?: string }>;
  signatures: number;
  holdSignature: boolean;
  resumeSignature(): void;
  changeOwner(): void;
  disconnect(): void;
  grant: { generateAndFund(amount: number): Promise<void>; tryRecover(): Promise<boolean>; recoverViaSignature(): Promise<boolean> };
};
const state = async (page: Page) => JSON.parse((await page.locator("#state").textContent())!);
const release = (page: Page, kind: string) => page.evaluate(kind => (window as unknown as Fixture).restores.shift()!(kind), kind);
async function mount(strict = false) {
  const context = await browser.newContext();
  await context.addInitScript(strict => { (window as unknown as { strict: boolean }).strict = strict; }, strict);
  await context.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/fixture.js"></script>' });
    if (path === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (path === "/api/session/grant") return route.fulfill({ json: { active: false } });
    throw new Error(`Unexpected network request: ${path}`);
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://recovery.test");
  await expect.poll(async () => ({ errors, pending: await page.evaluate(() => (window as unknown as Fixture).restores?.length) })).toEqual({ errors: [], pending: 1 });
  return { context, page };
}

it("blocks duplicate lifecycle actions and never derives on unavailable custody", async () => {
  const { page, context } = await mount();
  try {
    expect((await state(page)).status).toBe("restoring");
    expect(await page.getByRole("button", { name: "Enable research budget" }).count()).toBe(0);
    expect(await page.getByText("Restoring saved session in this browser…").count()).toBe(1);
    await page.evaluate(async () => {
      const { grant } = window as unknown as Fixture;
      await Promise.all([grant.generateAndFund(.05), grant.recoverViaSignature(), grant.tryRecover()]);
    });
    expect(await page.evaluate(() => (window as unknown as Fixture).operations.map(o => o.type))).toEqual(["initializeOwner", "restoreRetained"]);
    await release(page, "failed");
    await expect.poll(async () => (await state(page)).status).toBe("error");
    expect((await state(page)).error).toBe("Recovery storage unavailable");
    // Explicit retry still cannot reinterpret a failed read as a missing key.
    await page.getByRole("button", { name: "Enable research budget" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).restores.length)).toBe(1);
    await release(page, "failed");
    await expect.poll(async () => (await state(page)).status).toBe("error");
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(0);
    // A successful empty read permits exactly one first-creation signature.
    await page.getByRole("button", { name: "Enable research budget" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).restores.length)).toBe(1);
    await release(page, "missing");
    await expect.poll(async () => (await state(page)).status).toBe("error");
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(1);
  } finally { await context.close(); }
});

it.each(["effect replay", "owner change"])("finishes recovery after %s invalidates an in-flight read", async kind => {
  const { page, context } = await mount(kind === "effect replay");
  try {
    if (kind === "owner change") await page.evaluate(() => (window as unknown as Fixture).changeOwner());
    await release(page, "missing");
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).restores.length)).toBe(1);
    await release(page, "missing");
    await expect.poll(async () => (await state(page)).status).toBe("idle");
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(0);
    const owners = await page.evaluate(() => (window as unknown as Fixture).operations.filter(o => o.type === "initializeOwner").map(o => o.owner));
    expect(owners).toHaveLength(2);
    if (kind === "owner change") expect(owners[1]).toBe("0x2222222222222222222222222222222222222222");
  } finally { await context.close(); }
});

it("restores an expired funded key with a readable consent-renewal message", async () => {
  const { page, context } = await mount();
  try {
    await release(page, "saved");
    await expect.poll(async () => (await state(page)).status).toBe("paused");
    expect((await state(page)).error).toContain("Review a new spending consent");
    expect((await state(page)).sessAddr).toBe("0x3333333333333333333333333333333333333333");
    expect(await page.getByRole("button", { name: "Continue with saved budget" }).count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(0);
  } finally { await context.close(); }
});

it("switches owners during a wallet prompt without replaying the old funding action", async () => {
  const { page, context } = await mount();
  try {
    await release(page, "missing");
    await expect.poll(async () => (await state(page)).status).toBe("idle");
    await page.evaluate(() => { (window as unknown as Fixture).holdSignature = true; });
    await page.getByRole("button", { name: "Enable research budget" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).restores.length)).toBe(1);
    await release(page, "missing");
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(1);
    await page.evaluate(() => (window as unknown as Fixture).changeOwner());
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).grant ? (window as unknown as Fixture).operations.filter(o => o.type === "lock").length : 0)).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as Fixture).resumeSignature());
    await expect.poll(() => page.evaluate(() => (window as unknown as Fixture).restores.length)).toBe(1);
    await release(page, "missing");
    await expect.poll(async () => (await state(page)).status).toBe("idle");
    expect(await page.evaluate(() => (window as unknown as Fixture).operations.some(o => o.type === "deriveFromSignature"))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(1);
  } finally { await context.close(); }
});

it("leaves a reconnectable state when the owner disconnects during recovery", async () => {
  const { page, context } = await mount();
  try {
    await page.evaluate(() => (window as unknown as Fixture).disconnect());
    await expect.poll(async () => (await state(page)).status).toBe("paused");
    await release(page, "saved");
    expect((await state(page)).error).toContain("Connect the original owner wallet");
    expect(await page.getByText("Restoring saved session in this browser…").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as Fixture).signatures)).toBe(0);
  } finally { await context.close(); }
});
