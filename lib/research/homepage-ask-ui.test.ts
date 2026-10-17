import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const wallet = `0x${"a".repeat(40)}`;
let browser: Browser;
const bundles: Record<string, string> = {};

beforeAll(async () => {
  for (const network of ["arc", "arcTestnet"]) {
    bundles[network] = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import AskPage from './app/page';import{AskForm}from'./components/keryx/ask-form';
      window.actions=[];const p=new URLSearchParams(location.search);
      createRoot(document.getElementById('root')).render(location.pathname==='/form'
        ?<AskForm payer={p.get('payer')??'treasury'} onAsk={(...args)=>window.actions.push(args)}/>:<AskPage/>);
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": JSON.stringify(network),
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": '"0x3333333333333333333333333333333333333333"',
      "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined",
    }, plugins: [{ name: "unrelated-browser-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onResolve({ filter: /\/(wallet-menu|dispatch-wire|session-grant-panel|landing-visit|research-turn)$/ }, args => ({ path: args.path.split("/").at(-1)!, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "link" ? "export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,onNavigate,...props}){return <a {...props}/>}"
          : args.path === "navigation" ? "export const usePathname=()=>location.pathname;"
            : args.path === "research-turn" ? "export function ResearchTurn({turn}){return <article>{turn.question} {turn.state.run?.answer}</article>}"
              : `export function ${({ "wallet-menu": "WalletMenu", "dispatch-wire": "DispatchWire", "session-grant-panel": "SessionGrantPanel", "landing-visit": "LandingVisit" } as Record<string, string>)[args.path]}(){return null;}`,
      }));
    } }] })).outputFiles[0].text;
  }
  if (process.env.KERYX_UI_PREVIEW_DIR) {
    mkdirSync(process.env.KERYX_UI_PREVIEW_DIR, { recursive: true });
    writeFileSync(join(process.env.KERYX_UI_PREVIEW_DIR, "homepage.js"), bundles.arc);
  }
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function mount(path = "/form", network = "arc", signedIn = false, failedVisibility = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  let visibilityFails = failedVisibility;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/ask/visibility") {
      const fails = visibilityFails; visibilityFails = false;
      return route.fulfill(fails ? { status: 503, json: {} } : { json: { wallet: signedIn ? wallet : null, defaultVisibility: "public", privacyActive: true } });
    }
    if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "fixture-model", label: "Fixture model", note: "Synthetic model" }, { id: "other", label: "Other model", note: "Synthetic alternative" }] } });
    if (url.pathname === "/api/research/availability") return route.fulfill(path.includes("availability=failed")
      ? { status: 503, json: {} } : { json: { state: "not-paused" } });
    if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
    if (url.pathname === "/api/metrics") return route.fulfill({ json: { metrics: {}, recentPayments: [] } });
    if (url.pathname === "/api/ask") return route.fulfill({ contentType: "text/event-stream", body:
      `event: meta\ndata: {"mode":"offline","engine":"synthetic","visibility":"public"}\n\nevent: done\ndata: {"id":"11111111-1111-4111-8111-111111111111","answer":"Synthetic browser answer"}\n\n` });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`https://homepage.test${path}`);
  await page.addScriptTag({ content: bundles[network] });
  try { await page.getByLabel("What do you want to know?").waitFor(); }
  catch (error) { const body = await page.locator("body").innerText(); await context.close(); throw new Error(`${String(error)}; browser errors: ${errors.join("; ")}; body: ${body.slice(0, 500)}`); }
  await page.getByRole("status").filter({ hasText: failedVisibility ? "Visibility settings are unavailable" : "Trial reports have public links" }).first().waitFor();
  return { context, page };
}

it("shows the short trial ask path and reveals all retained controls together, with no mainnet manuscript option", async () => {
  const { context, page } = await mount();
  try {
    for (const text of ["quick", "deep", "Ask Keryx", "Compare SQLite WAL and rollback journals", "Research children's educational video ideas", "Free trial. Keryx pays. No wallet."])
      expect(await page.getByText(text, { exact: true }).isVisible()).toBe(true);
    const advanced = page.locator("details");
    for (const control of [page.getByLabel("Search scholarly papers (Crossref and arXiv)"), page.getByTestId("research-visibility").locator("select"), page.locator('input[type="checkbox"]').last(), page.getByLabel("Maximum budget in USDC"), page.getByTestId("paper-metadata-handoff")])
      expect(await control.isVisible()).toBe(false);
    expect(await page.locator('button[data-tour="dispatch-btn"]').evaluate(button => button.parentElement!.innerText)).not.toMatch(/Source cap:|\d+\.\d{6}|USDC on/);
    expect(await page.getByRole("button", { name: "Check availability" }).count()).toBe(0);
    await advanced.locator("summary").click();
    for (const control of [page.getByLabel("Search scholarly papers (Crossref and arXiv)"), page.getByTestId("research-visibility").locator("select"), page.getByLabel("Maximum budget in USDC"), page.getByTestId("paper-metadata-handoff")])
      expect(await control.isVisible()).toBe(true);
    expect(await page.getByText(/Include reviewed paid manuscripts/).count()).toBe(0);
    expect(await page.getByText(/Paid manuscript rights are not yet/).count()).toBe(0);
    expect(await page.getByText(/Requires your funded browser session/).count()).toBe(0);
  } finally { await context.close(); }
});

it("keeps question, depth, budget, model, visibility, scholarly and review-first choices across toggles and submits them", async () => {
  const { context, page } = await mount("/form?payer=session", "arc", true);
  try {
    await page.getByLabel("What do you want to know?").fill("Compare source evidence");
    await page.getByRole("radio", { name: "deep", exact: true }).check();
    await page.locator("summary").click();
    await page.getByLabel("Maximum budget in USDC").fill("0.025");
    await page.getByLabel("AI model").selectOption("other");
    await page.getByTestId("research-visibility").locator("select").selectOption("private");
    await page.getByLabel("Search scholarly papers (Crossref and arXiv)").check();
    await page.locator('input[type="checkbox"]').last().check();
    await page.locator("summary").click();
    expect(await page.getByText("Trial reports have public links.", { exact: false }).isVisible()).toBe(false);
    expect(await page.getByText(/Only your signed-in account can open/).first().isVisible()).toBe(true);
    expect(await page.getByText("Free trial. Keryx pays. No wallet.").count()).toBe(0);
    expect(await page.locator('[data-tour="dispatch-btn"]').evaluate(button => button.parentElement!.innerText)).not.toMatch(/\d+\.\d{6}/);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("keryx:tour-budget")));
    expect(await page.getByLabel("Maximum budget in USDC").isVisible()).toBe(true);
    expect(await page.getByLabel("AI model").inputValue()).toBe("other");
    await page.locator("summary").click();
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions)).toEqual([
      ["Compare source evidence", 0.025, undefined, "other", "deep", true, false, true, { visibility: "private", expectedWallet: wallet }],
    ]);
  } finally { await context.close(); }
});

it("retains testnet paid manuscripts inside More options and sends the explicit funded choice", async () => {
  const { context, page } = await mount("/form?payer=session", "arcTestnet", true);
  try {
    const paid = page.getByLabel(/Include reviewed paid manuscripts/);
    expect(await paid.isVisible()).toBe(false); await page.locator("summary").click();
    expect(await paid.isVisible()).toBe(true); await paid.check();
    await page.getByLabel("What do you want to know?").fill("Review this exact manuscript version");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { actions: unknown[][] }).actions[0][6])).toBe(true);
  } finally { await context.close(); }
});

it("explains a visibility failure beside the disabled ask and keeps its existing retry inside More options", async () => {
  const { context, page } = await mount("/form", "arc", false, true);
  try {
    await page.getByLabel("What do you want to know?").fill("Keep my draft through retry");
    expect(await page.getByRole("button", { name: "Ask Keryx", exact: true }).isDisabled()).toBe(true);
    const retry = page.getByRole("button", { name: "Retry visibility settings", includeHidden: true });
    expect(await retry.isVisible()).toBe(false);
    await page.locator('p[role="status"]').filter({ hasText: "Visibility settings are unavailable" }).getByRole("button", { name: "More options" }).click();
    expect(await retry.isVisible()).toBe(true); await retry.click();
    await page.waitForFunction(() => !(document.querySelector('[data-tour="dispatch-btn"]') as HTMLButtonElement).disabled);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("Keep my draft through retry");
  } finally { await context.close(); }
});

it("shows the existing availability recovery panel after a failed check and does not auto-submit a shared question", async () => {
  const { context, page } = await mount("/form?availability=failed&run=1&q=Inspect%20public%20evidence&budget=0");
  try {
    expect(await page.getByRole("status").filter({ hasText: "Research availability could not be checked" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Check availability", exact: true }).isVisible()).toBe(true);
    expect(await page.getByRole("link", { name: "My saved reports", exact: true }).isVisible()).toBe(true);
    expect(await page.getByLabel("What do you want to know?").inputValue()).toBe("Inspect public evidence");
    expect(await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions)).toEqual([]);
  } finally { await context.close(); }
});

it("keeps the homepage sections and all navigation destinations, then supports a submitted question and new research", async () => {
  const { context, page } = await mount("/");
  try {
    const main = page.locator("main");
    expect(await main.locator('[data-tour="hero"]').count()).toBe(1);
    expect(await main.locator('#how-it-works a[href="/walkthrough"]').count()).toBe(1);
    expect(await main.locator('[aria-label="Research tools"]').count()).toBe(0);
    expect(await main.getByText("Cited research. This trial is free, with no wallet required.").isVisible()).toBe(true);
    const nav = page.locator("header nav").first();
    expect(await nav.locator(":scope > a").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(["/", "/answers", "/sources", "/register"]);
    const more = nav.locator("details"); await more.locator("summary").click();
    const tools = await more.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href")));
    expect(tools).toEqual(["/pricing", "/about", "/get-started", "/dashboard", "/operator", "/literature", "/market", "/integrations/mcp", "/wanted", "/me/sources", "/me/asks", "/playground", "/research", "/dev", "/download", "/integrations"]);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const mobile = page.locator("#mobile-site-menu nav");
    expect(await mobile.locator(":scope > a").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(["/", "/answers", "/sources", "/register"]);
    expect(await mobile.locator("details a").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual(tools);
    expect(await page.locator('footer a[href="/research/private"]').count()).toBe(1);
    await page.getByLabel("What do you want to know?").fill("A synthetic browser question");
    await page.getByRole("button", { name: "Ask Keryx", exact: true }).click();
    await page.getByText("Synthetic browser answer", { exact: false }).waitFor();
    expect(await page.getByRole("button", { name: "New research", exact: true }).isVisible()).toBe(true);
    await page.getByRole("button", { name: "New research", exact: true }).click();
    expect(await page.getByLabel("What do you want to know?").isEnabled()).toBe(true);
  } finally { await context.close(); }
});
