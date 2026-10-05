import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {GrantSpendDialog} from './components/keryx/grant-spend-dialog';
    import {AskForm} from './components/keryx/ask-form';
    window.actions=[];
    function App(){const[state,setState]=useState({status:'idle',sessAddr:null,sessionId:null,cap:0,spent:0,expiresAt:null,grantEpoch:null,error:null});
      window.showBudget=()=>setState({status:'active',sessAddr:'0x2222222222222222222222222222222222222222',sessionId:'owner',
        cap:.05,spent:.02,expiresAt:new Date(Date.now()+604800000).toISOString(),grantEpoch:'epoch',error:null,
        researchBudget:{durationSeconds:604800,questionCapUsdc:.015}});
      return <><GrantSpendDialog grantState={state} onTryRecover={()=>{}}
        onActivate={(amount,options)=>window.actions.push({type:'activate',amount,options})}
        onTopUp={amount=>window.actions.push({type:'topup',amount})}
        onExtend={async options=>{window.actions.push({type:'renew',options});return true}}
        onRevoke={()=>window.actions.push({type:'stop'})} onRecoverViaSignature={()=>window.actions.push({type:'recover'})}/>
        <AskForm payer='session' questionCapUsdc={state.researchBudget?.questionCapUsdc}
          onAsk={(question,budget)=>window.actions.push({type:'ask',question,budget})}/></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x4444444444444444444444444444444444444444"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

async function mount() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script type="module" src="/fixture.js"></script>' });
    if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (path === "/api/models") return route.fulfill({ json: { models: [] } });
    throw new Error(`Unexpected UI fixture request: ${path}`);
  });
  const page = await context.newPage();
  await page.goto("https://budget.test");
  await page.getByRole("button", { name: "Enable research budget" }).waitFor();
  return { context, page };
}

it("requires exact amounts and a per-question maximum within the explicitly selected allowance", async () => {
  const { context, page } = await mount();
  try {
    const enable = page.getByRole("button", { name: "Enable research budget" });
    await page.getByLabel("Total budget (USDC)").fill("0.1garbage");
    expect(await enable.isDisabled()).toBe(true);
    await page.getByLabel("Total budget (USDC)").fill("0.10");
    await page.getByLabel("Maximum per question (USDC)").fill("0.11");
    expect(await enable.isDisabled()).toBe(true);
    await page.getByLabel("Maximum per question (USDC)").fill("0.025");
    await page.getByLabel("Budget duration").selectOption("86400");
    await enable.click();
    expect(await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions)).toEqual([
      { type: "activate", amount: .1, options: { durationSeconds: 86400, questionCapUsdc: .025 } },
    ]);
  } finally { await context.close(); }
});

it("shows held capacity, clamps question requests to the signed maximum and makes renewal and stop explicit", async () => {
  const { context, page } = await mount();
  try {
    await page.evaluate(() => (window as unknown as { showBudget(): void }).showBudget());
    await page.getByText("0.020000 USDC used or held").waitFor();
    expect(await page.getByText(/0\.030000 USDC remaining/).count()).toBe(1);
    expect(await page.getByText("Budget and model: $0.015000 USDC").count()).toBe(1);
    await page.getByLabel("What do you want to know?").fill("Compare two research approaches");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByRole("button", { name: "Renew duration" }).click();
    await page.getByRole("button", { name: "Stop spending" }).click();
    expect(await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions)).toEqual([
      { type: "ask", question: "Compare two research approaches", budget: .015 }, { type: "renew" }, { type: "stop" },
    ]);
  } finally { await context.close(); }
});
