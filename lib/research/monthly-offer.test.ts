import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { productGuideCopy } from "../../locales/en/product-guide";
import { createMessages } from "../i18n/messages";

const copy = createMessages("en");
const review = productGuideCopy("pricing.checkout");
let browser: Browser, bundle: string;

beforeAll(async () => {
  // Real offer, pinned Monthly GET transport, bounded JSON reader and quote
  // validation. Only the final wallet/plan UI is replaced with an exposure probe.
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';
    import{ResearchMonthlyOffer}from'./components/keryx/research-monthly-offer';
    import{BUYER_ORIGIN,BUYER_NETWORK}from'./lib/buyer/protocol';
    import{MONTHLY_PATH}from'./lib/monthly/protocol';
    window.fixture={};window.requests=[];window.pending=[];window.aborted=0;window.checkoutMounts=0;
    window.fetch=async(url,init)=>{
      if(url!==BUYER_ORIGIN+MONTHLY_PATH+'?quote=1')throw Error('Unexpected synthetic destination');
      window.requests.push({url,method:init.method??'GET',cache:init.cache,redirect:init.redirect});
      init.signal.addEventListener('abort',()=>window.aborted++,{once:true});
      const f={...window.fixture};
      const quote={plan:'research-monthly-v1',requests:4,termDays:30,researchMode:'deep',packageVersion:'1.0.0',
        creatorBudgetMicros:50000,serviceFeeMicros:124000,totalMicros:324000,separateTotalMicros:360000,
        roundingMicros:0,payee:'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',network:BUYER_NETWORK,quoteId:'a'.repeat(64)};
      if(f.invalid==='network')quote.network='eip155:1';
      if(f.invalid==='economics')quote.totalMicros++;
      if(f.invalid==='shape')quote.extra='untrusted';
      const response=()=>new Response(f.invalid==='json'?'{':JSON.stringify({quote}),{status:f.status??200,
        headers:{'content-type':'application/json'}});
      // Ignore abort deliberately: a late successful response must stay inert.
      return f.pending?new Promise(resolve=>window.pending.push(()=>resolve(response()))):response();
    };
    const root=createRoot(document.getElementById('root'));
    window.unmountOffer=()=>root.unmount();root.render(<ResearchMonthlyOffer/>);
  ` }, plugins: [{ name: "monthly-wallet-exposure", setup(builder) {
    builder.onResolve({ filter: /\/research-monthly$/ }, () => ({ path: "monthly-checkout", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `
      import React,{useEffect}from'react';export function ResearchMonthly({quote}){
        useEffect(()=>{window.checkoutMounts++},[]);return <div data-testid="monthly-wallet-ui">
        <span>{quote.totalMicros}</span><button>Connect wallet</button><button>Add funds</button></div>;}
    ` }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type Fixture = { status?: number; invalid?: "network" | "economics" | "shape" | "json"; pending?: boolean };
interface State { fixture: Fixture; requests: { url: string; method: string; cache: string; redirect: string }[];
  pending: (() => void)[]; aborted: number; checkoutMounts: number; unmountOffer(): void }

async function mount(fixture: Fixture = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("https://monthly-offer.test/");
  await page.addScriptTag({ content: bundle });
  await page.locator("#monthly-heading").waitFor();
  await page.evaluate(value => { (window as unknown as State).fixture = value; }, fixture);
  return { context, page };
}
async function expectNoWallet(page: Page) {
  expect(await page.locator('[data-testid="monthly-wallet-ui"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as State).checkoutMounts)).toBe(0);
}

it("opens with no quote request or wallet/funding UI and makes one explicit pinned GET", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await expectNoWallet(page);
    expect(await page.evaluate(() => (window as unknown as State).requests)).toEqual([]);
    await page.getByRole("button", { name: review, exact: true }).click();
    await page.getByRole("button", { name: copy("researchEntry.checking"), exact: true }).waitFor();
    await page.evaluate(() => document.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const requests = await page.evaluate(() => (window as unknown as State).requests);
    expect(requests).toEqual([{ url: "https://keryx.cc/api/research/monthly?quote=1", method: "GET", cache: "no-store", redirect: "error" }]);
    await expectNoWallet(page);
    await page.evaluate(() => (window as unknown as State).pending.shift()!());
    await page.locator('[data-testid="monthly-wallet-ui"]').waitFor();
    expect(await page.locator('[data-testid="monthly-wallet-ui"]').textContent()).toContain("324000");
  } finally { await context.close(); }
});

it.each<Fixture>([{ status: 503 }, { invalid: "json" }, { invalid: "network" }, { invalid: "economics" }, { invalid: "shape" }])
("keeps unavailable or invalid quotes away from wallet UI and permits an explicit retry: %j", async fixture => {
  const { context, page } = await mount(fixture);
  try {
    await page.getByRole("button", { name: review, exact: true }).click();
    await page.getByText(copy("researchCheckout.quoteChanged"), { exact: true }).waitFor();
    await expectNoWallet(page);
    await page.evaluate(() => { (window as unknown as State).fixture = {}; });
    await page.getByRole("button", { name: review, exact: true }).click();
    await page.locator('[data-testid="monthly-wallet-ui"]').waitFor();
    expect(await page.evaluate(() => (window as unknown as State).requests.length)).toBe(2);
  } finally { await context.close(); }
});

it("aborts on unmount and never exposes wallet UI after a late successful quote", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await page.getByRole("button", { name: review, exact: true }).click();
    await page.waitForFunction(() => (window as unknown as State).pending.length === 1);
    await page.evaluate(() => (window as unknown as State).unmountOffer());
    await page.waitForFunction(() => (window as unknown as State).aborted === 1);
    await page.evaluate(() => (window as unknown as State).pending.shift()!());
    await expectNoWallet(page);
    expect(await page.locator("#monthly-heading").count()).toBe(0);
  } finally { await context.close(); }
});
