import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { paidResearchAvailabilityCopy as copy } from "../../locales/en/paid-research-availability";

const server = vi.hoisted(() => ({
  config: { sellerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", funderKey: "", networkId: "eip155:5042",
    profile: { testnet: false, label: "Arc" }, defaultBudget: 0.05, a2aMaxBudget: 0.5, a2aFeeUsdc: 0.02, a2aDeepFeeUsdc: 0.04 },
  ready: vi.fn().mockRejectedValue(new Error("Synthetic capacity observation unavailable")),
}));
vi.mock("@/lib/config", () => ({ config: server.config }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/payments/mainnet-hosted-gateway", () => ({ assertMainnetHostedResearchReady: server.ready }));
vi.mock("@/lib/monthly/readiness", () => ({ monthlyAdmissionQuote: async () => null }));
vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/keryx/research-chat", () => ({ ResearchChat: () => null }));
vi.mock("@/components/keryx/research-request", () => ({ ResearchRequest: () => createElement("textarea", { id: "server-preparation" }) }));
vi.mock("@/components/keryx/research-job", () => ({ ResearchJob: () => null }));
vi.mock("@/components/keryx/research-workspace", () => ({ ResearchWorkspace: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/components/keryx/research-saved-jobs", () => ({ ResearchSavedJobs: () => null }));
vi.mock("@/components/keryx/research-account-jobs", () => ({ ResearchAccountJobs: () => null }));
vi.mock("@/components/keryx/research-private-jobs", () => ({ ResearchPrivateJobs: () => null }));
vi.mock("@/components/keryx/research-private-checkout", () => ({ ResearchPrivateCheckout: () => null }));
vi.mock("@/components/keryx/research-evidence-browser", () => ({ ResearchEvidenceBrowser: () => null }));
vi.mock("@/components/keryx/research-monthly", () => ({ ResearchMonthly: () => null }));

it("keeps configured question preparation visible when the SSR capacity observation fails", async () => {
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  try {
    const { default: ResearchPage } = await import("../../app/research/page");
    const html = renderToStaticMarkup(await ResearchPage({ searchParams: Promise.resolve({}) }));
    expect(server.ready).toHaveBeenCalledWith({}, "50000");
    expect(html).toContain('id="server-preparation"');
    expect(html).toContain(copy.observationUnknown);
  } finally { vi.unstubAllEnvs(); }
});

type QuoteFixture = { status?: number; header?: string; amount?: string; payee?: string; network?: string; pending?: boolean };
let browser: Browser, bundle: string;
beforeAll(async () => {
  // Bundle the real request wrapper, buyer transport and challenge validator. Only the
  // checkout leaf is replaced: its presence represents wallet/funding exposure.
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchRequest}from'./components/keryx/research-request';
    import{BUYER_ENDPOINT,BUYER_NETWORK,BUYER_USDC,BUYER_GATEWAY}from'./lib/buyer/protocol';
    window.props={mode:'deep',budget:0.05,version:'1.0.0',total:0.09,payee:'0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'};
    window.fixture={};window.requests=[];window.pending=[];window.aborted=0;window.checkoutMounts=0;
    window.fetch=async(url,init)=>{
      if(url!==BUYER_ENDPOINT)throw Error('Unexpected synthetic destination');
      window.requests.push({url,method:init.method,headers:init.headers,body:JSON.parse(init.body)});
      init.signal?.addEventListener('abort',()=>window.aborted++,{once:true});
      const f={...window.fixture};
      const response=()=>new Response(null,{status:f.status??402,headers:{'payment-required':f.header??btoa(JSON.stringify({
        x402Version:2,resource:{url:BUYER_ENDPOINT},accepts:[{scheme:'exact',network:f.network??BUYER_NETWORK,
        asset:BUYER_USDC,amount:f.amount??'90000',payTo:f.payee??window.props.payee,maxTimeoutSeconds:691200,
        extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:BUYER_GATEWAY}}]}))}});
      // Deliberately ignore abort for a pending response to exercise stale-result refusal.
      return f.pending?new Promise(resolve=>window.pending.push(()=>resolve(response()))):response();
    };
    const root=createRoot(document.getElementById('root'));
    window.renderRequest=changes=>{window.props={...window.props,...changes};root.render(<ResearchRequest {...window.props}/>)};
    window.unmountRequest=()=>root.unmount();window.renderRequest({});
  ` }, plugins: [{ name: "checkout-exposure-fixture", setup(builder) {
    builder.onResolve({ filter: /\/research-checkout$/ }, () => ({ path: "checkout", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `
      import React,{useEffect}from'react';export function ResearchCheckout(){
        useEffect(()=>{window.checkoutMounts++},[]);
        return <div data-testid="accepted-checkout"><button>Connect wallet</button><button>Add funds</button><button>Buy research</button></div>;
      }` }));
  } }], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
    "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arc"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
  } })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function mount(fixture: QuoteFixture = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://paid-preparation.test/");
  await page.addScriptTag({ content: bundle });
  await page.locator("#research-question").waitFor();
  await page.evaluate(value => { (window as unknown as { fixture: QuoteFixture }).fixture = value; }, fixture);
  return { context, page };
}
async function quote(page: Page, question = "Compare the original public evidence") {
  await page.locator("#research-question").fill(question);
  await page.getByRole("button", { name: copy.checkQuote, exact: true }).click();
}
async function expectNoCheckout(page: Page) {
  expect(await page.getByTestId("accepted-checkout").count()).toBe(0);
  expect(await page.getByRole("button", { name: "Add funds", exact: true }).count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { checkoutMounts: number }).checkoutMounts)).toBe(0);
}

it("does not mount wallet, funding or purchase controls before an accepted unsigned quote", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await expectNoCheckout(page);
    expect(await page.getByRole("button", { name: copy.checkQuote, exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { requests: unknown[] }).requests)).toEqual([]);
    await quote(page);
    await page.getByRole("button", { name: copy.checking, exact: true }).waitFor();
    await expectNoCheckout(page);
  } finally { await context.close(); }
});

it.each([
  ["503", { status: 503 }],
  ["malformed challenge", { header: "invalid" }],
  ["higher total", { amount: "90001" }],
  ["lower total", { amount: "89999" }],
  ["wrong payee", { payee: "0xcccccccccccccccccccccccccccccccccccccccc" }],
  ["wrong network", { network: "eip155:5042002" }],
] satisfies [string, QuoteFixture][])("keeps funding closed after %s", async (_, fixture) => {
  const { context, page } = await mount(fixture);
  try {
    await quote(page);
    await page.getByRole("status").filter({ hasText: copy.unavailable }).waitFor();
    await expectNoCheckout(page);
    expect(await page.locator("#research-question").inputValue()).toBe("Compare the original public evidence");
  } finally { await context.close(); }
});

it("mounts checkout only after exact validation and sends no payment authorization", async () => {
  const { context, page } = await mount();
  try {
    await quote(page);
    await page.getByTestId("accepted-checkout").waitFor();
    const requests = await page.evaluate(() => (window as unknown as { requests: Array<{ method: string; headers: Record<string, string>; body: unknown }> }).requests);
    expect(requests).toEqual([expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" },
      body: { question: "Compare the original public evidence", budget: 0.05, researchMode: "deep", packageVersion: "1.0.0", responseMode: "async" } })]);
    await page.locator("#research-question").fill("A changed question");
    expect(await page.getByTestId("accepted-checkout").count()).toBe(0);
    await page.locator("#research-question").fill("Compare the original public evidence");
    expect(await page.getByTestId("accepted-checkout").count()).toBe(0);
  } finally { await context.close(); }
});

it("ignores a successful stale question response even when its transport ignores abort", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await quote(page);
    await page.waitForFunction(() => (window as unknown as { pending: unknown[] }).pending.length === 1);
    await page.locator("#research-question").fill("A different current question");
    await page.evaluate(() => (window as unknown as { pending: Array<() => void> }).pending.shift()!());
    await page.getByRole("button", { name: copy.checkQuote, exact: true }).waitFor();
    await expectNoCheckout(page);
    expect(await page.evaluate(() => (window as unknown as { aborted: number }).aborted)).toBe(1);
  } finally { await context.close(); }
});

it("keeps a newer quote pending when an older response finishes, then accepts only the newer result", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await quote(page, "The first question");
    await page.waitForFunction(() => (window as unknown as { pending: unknown[] }).pending.length === 1);
    await quote(page, "The current question");
    await page.waitForFunction(() => (window as unknown as { pending: unknown[] }).pending.length === 2);
    await page.evaluate(() => (window as unknown as { pending: Array<() => void> }).pending.shift()!());
    await page.getByRole("button", { name: copy.checking, exact: true }).waitFor();
    await expectNoCheckout(page);
    await page.evaluate(() => (window as unknown as { pending: Array<() => void> }).pending.shift()!());
    await page.getByTestId("accepted-checkout").waitFor();
    expect(await page.locator("#research-question").inputValue()).toBe("The current question");
  } finally { await context.close(); }
});

it.each([
  { mode: "quick" }, { budget: 0.04 }, { version: "changed" }, { total: 0.08 },
  { payee: "0xcccccccccccccccccccccccccccccccccccccccc" },
])("discards accepted preparation when package or payee changes: %j", async changes => {
  const { context, page } = await mount();
  try {
    await quote(page);
    await page.getByTestId("accepted-checkout").waitFor();
    await page.evaluate(value => (window as unknown as { renderRequest(value: unknown): void }).renderRequest(value), changes);
    await page.waitForFunction(() => (document.querySelector("#research-question") as HTMLTextAreaElement)?.value === "");
    expect(await page.getByTestId("accepted-checkout").count()).toBe(0);
    await page.evaluate(() => (window as unknown as { renderRequest(value: unknown): void }).renderRequest({ mode: "deep", budget: 0.05, version: "1.0.0", total: 0.09, payee: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    expect(await page.getByTestId("accepted-checkout").count()).toBe(0);
  } finally { await context.close(); }
});

it("discards a pending quote across a package change, including a return to the old package", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await quote(page);
    await page.waitForFunction(() => (window as unknown as { pending: unknown[] }).pending.length === 1);
    await page.evaluate(() => (window as unknown as { renderRequest(value: unknown): void }).renderRequest({ budget: 0.04 }));
    await page.waitForFunction(() => (document.querySelector("#research-question") as HTMLTextAreaElement)?.value === "");
    await page.evaluate(() => (window as unknown as { renderRequest(value: unknown): void }).renderRequest({ budget: 0.05 }));
    await page.evaluate(() => (window as unknown as { pending: Array<() => void> }).pending.shift()!());
    await expectNoCheckout(page);
  } finally { await context.close(); }
});

it("aborts a pending quote on unmount without mounting checkout after a late response", async () => {
  const { context, page } = await mount({ pending: true });
  try {
    await quote(page);
    await page.waitForFunction(() => (window as unknown as { pending: unknown[] }).pending.length === 1);
    await page.evaluate(() => (window as unknown as { unmountRequest(): void }).unmountRequest());
    await page.waitForFunction(() => !document.querySelector("#research-question"));
    await page.evaluate(() => (window as unknown as { pending: Array<() => void> }).pending.shift()!());
    await expectNoCheckout(page);
    expect(await page.evaluate(() => (window as unknown as { aborted: number }).aborted)).toBe(1);
  } finally { await context.close(); }
});
