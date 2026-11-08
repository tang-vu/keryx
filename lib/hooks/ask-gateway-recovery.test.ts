import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { parseAskHttpError } from "./ask-error-response";
import { createMessages } from "../i18n/messages";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";

const copy = createMessages("en");
const bodies = ["", "Bad gateway", "<!doctype html><h1>Bad gateway</h1><script>RETRY_OR_SIGN_NOW()</script>",
  JSON.stringify({ error: "session_expired", message: "Sign again", retryAfter: 1 }),
  JSON.stringify({ error: "research_paused", message: "No work was admitted" }),
  JSON.stringify({ error: { code: "KERYX_PLANNED_MAINTENANCE", upstreamOutcome: "not-dispatched" } }),
  "null", "x".repeat(100_000)];
for (const status of [502, 504] as const) it.each(bodies.map((body, index) => ({ body, index })))(
  `treats HTTP ${status} body $index as unknown delivery, with no body or retry authority`, ({ body }) => {
    expect(parseAskHttpError(body, status, "1")).toEqual({
      gatewayStatus: status, retryAfter: null,
      message: `${copy("researchError.httpFallback", { status })} ${copy("researchError.unknownOutcome")}`,
    });
  });

it.each([400, 401, 403, 429, 500, 503, 520])("does not invent gateway delivery metadata for HTTP %s", status => {
  const body = JSON.stringify({ error: "ordinary", message: "Original refusal", retryAfter: 12 });
  expect(parseAskHttpError(body, status, "30")).toEqual({ code: "ordinary", message: "Original refusal", retryAfter: 12 });
});

const question = "Original <literal> {count}\n日本語 / Tiếng Việt";
const parent = "11111111-2222-4333-8444-555555555555";
const owner = "0x" + "1".repeat(40);
type Fixture = { asks: Array<{ body: Record<string, unknown>; headers: Record<string, string> }>;
  textReads: number; cancellations: number; wallet: string | null };
let browser: Browser, bundle: string;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const circleLoader = require("../../scripts/circle-sdk-browser-loader.cjs") as (this: { resourcePath: string }, source: string) => string;
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';
    import{LocaleProvider}from'./lib/i18n/locale-context';import{UiCopyProvider}from'./lib/i18n/ui-copy-provider';
    import{LanguageSwitcher}from'./components/keryx/language-switcher';import{preparedLocales}from'./lib/i18n/locales';
    import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    const config=window.gatewayConfig, original=window.fetch.bind(window);
    const fixture=window.gatewayFixture={asks:[],textReads:0,cancellations:0,wallet:config.visibility==='public'?null:${JSON.stringify(owner)}};
    window.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url??String(input),location.href);
      if(url.origin===location.origin&&url.pathname==='/api/ask/visibility')return Promise.resolve(Response.json({wallet:fixture.wallet,defaultVisibility:fixture.wallet?config.visibility:'public',privacyActive:true}));
      if(url.origin!==location.origin||url.pathname!=='/api/ask'||init?.method!=='POST')return original(input,init);
      fixture.asks.push({body:JSON.parse(init.body),headers:Object.fromEntries(new Headers(init.headers))});
      const response=new Response(new ReadableStream({start(controller){
        if(config.mode==='html'){controller.enqueue(new TextEncoder().encode(${JSON.stringify(bodies[2])}));controller.close()}
      },cancel(){fixture.cancellations++;if(config.mode==='cancel-reject')return Promise.reject(Error('Cancellation unavailable'));
        if(config.mode==='cancel-pending')return new Promise(()=>{});
      }}),{status:config.status,headers:{'Content-Type':'text/html','Retry-After':'1'}});
      const text=response.text.bind(response);response.text=()=>{fixture.textReads++;return text()};
      return Promise.resolve(response);
    };
    createRoot(document.getElementById('root')).render(<LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider><LanguageSwitcher/>
      <ResearchChat initialRequest={{question:${JSON.stringify(question)},budget:0,parentId:${JSON.stringify(parent)},visibility:config.visibility,expectedWallet:fixture.wallet}}/>
    </UiCopyProvider></LocaleProvider>);
  ` }, bundle: true, minify: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture(), { name: "explicit-no-funding-panel", setup(api) {
      // Funding UI and wallet authentication are outside this zero-budget transport
      // fixture. All changed consumers, the composer and owner guards stay real.
      api.onResolve({ filter: /^\.\/session-grant-panel$/ }, args => args.importer.replaceAll("\\", "/").endsWith("/components/keryx/research-chat.tsx") ? { path: "no-funding", namespace: "gateway-funding-fixture" } : undefined);
      api.onLoad({ filter: /^no-funding$/, namespace: "gateway-funding-fixture" }, () => ({ contents: "export function SessionGrantPanel(){return null}", loader: "js" }));
      api.onLoad({ filter: /@circle-fin[\\/]w3s-pw-web-sdk[\\/]dist[\\/]src[\\/]index\.js$/ }, args => ({ contents: circleLoader.call({ resourcePath: args.path }, readFileSync(args.path, "utf8")), loader: "js" }));
    } }] });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-chat.tsx", "components/keryx/ask-form.tsx",
    "components/keryx/research-turn.tsx", "lib/hooks/use-ask-stream.ts", "lib/hooks/ask-error-response.ts", "lib/hooks/use-research-visibility.ts"]);
  expect(Object.keys(result.metafile!.inputs)).toContain("gateway-funding-fixture:no-funding");
  bundle = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each([
  { status: 502, mode: "html", visibility: "public", locale: "en" },
  { status: 504, mode: "open", visibility: "public", locale: "vi" },
  { status: 502, mode: "cancel-reject", visibility: "unlisted", locale: "vi" },
  { status: 504, mode: "cancel-pending", visibility: "private", locale: "en" },
] as const)("recovers $status/$mode/$visibility/$locale without reading a gateway body or repeating research", async config => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const errors: string[] = [], unexpected: string[] = [], statusReads: string[] = [];
  const preview = await loadUiPreview(config.locale), message = createMessages(config.locale, preview.$messages);
  try {
    await context.addInitScript(value => { Object.assign(window, { gatewayConfig: value }); }, config);
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== "https://gateway-recovery.test" || req.method() !== "GET") { unexpected.push(`${req.method()} ${url.href}`); return route.abort(); }
      if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
      if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
      if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
      if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
      if (url.pathname === "/status") { statusReads.push(req.headers()["referer"] ?? ""); return route.fulfill({ contentType: "text/plain", body: "Synthetic read-only status" }); }
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", e => errors.push(e.message));
    await page.goto("https://gateway-recovery.test/"); await page.addScriptTag({ content: bundle });
    const input = page.locator("#ask-question"), dispatch = page.locator('[data-tour="dispatch-btn"]');
    const selector = page.locator("[data-language-switcher] select");
    await expect.poll(() => selector.isEnabled()).toBe(true); await selector.selectOption(config.locale);
    await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(config.locale);
    await expect.poll(() => input.inputValue()).toBe(question); await expect.poll(() => dispatch.isEnabled()).toBe(true);
    await dispatch.click();
    const alert = page.getByRole("alert"); await alert.waitFor();
    const text = await alert.textContent();
    expect(text).toContain(message("researchError.httpFallback", { status: config.status }));
    expect(text).toContain(message("researchError.unknownOutcome"));
    expect(text).not.toContain("RETRY_OR_SIGN_NOW"); expect(text).not.toContain("doctype");
    expect(await alert.locator("script,img,iframe").count()).toBe(0);
    expect(await input.inputValue()).toBe(""); // Recovery remains an explicit review action.
    const fixture = () => page.evaluate(() => {
      const f = (window as unknown as { gatewayFixture: Fixture }).gatewayFixture;
      return { asks: f.asks, textReads: f.textReads, cancellations: f.cancellations };
    });
    expect(await fixture()).toEqual({ asks: [{ body: { question, budget: 0, parentId: parent, mode: "quick", visibility: config.visibility },
      headers: { "content-type": "application/json", "x-keryx-expected-wallet": config.visibility === "public" ? "anonymous" : owner } }], textReads: 0, cancellations: 1 });
    expect(statusReads).toEqual([]);
    expect(await alert.locator('a[href^="/dispatch/"]').count()).toBe(0);
    expect(await alert.locator('a[href="/maintenance/status"]').count()).toBe(0);
    await page.getByRole("button", { name: "Reopen original question", exact: true }).click();
    await expect.poll(() => input.inputValue()).toBe(question);
    await input.fill("A new draft stays literal <edited> {count}");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await input.inputValue()).toBe("A new draft stays literal <edited> {count}");
    expect((await fixture()).asks).toHaveLength(1);
    if (config.visibility !== "public") {
      await page.evaluate(() => { (window as unknown as { gatewayFixture: Fixture }).gatewayFixture.wallet = null; window.dispatchEvent(new Event("focus")); });
      await expect.poll(() => input.inputValue()).toBe("");
      expect(await page.getByTestId("research-turn").count()).toBe(0);
      expect((await fixture()).asks).toHaveLength(1);
    } else {
      const popupPromise = page.waitForEvent("popup");
      await alert.getByRole("link", { name: message("researchError.serviceStatus"), exact: true }).click();
      const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded");
      expect(await popup.locator("body").textContent()).toBe("Synthetic read-only status");
      expect(statusReads).toEqual([""]); expect((await fixture()).asks).toHaveLength(1);
      expect(await input.inputValue()).toBe("A new draft stays literal <edited> {count}");
    }
    expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
}, 15_000);
