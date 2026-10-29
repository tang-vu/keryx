import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { createMessages, englishMessages } from "../i18n/messages";

let browser: Browser, bundle: string, css: string;
const capture = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR
  ? join(process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR, "conversation-controls") : undefined;
const parent = "11111111-2222-4333-8444-555555555555";
const question = "Original <literal> {count} 日本語 / हिन्दी — retain this parent question.";
const nextQuestion = "New original <literal> {amount} 日本語 / हिन्दी — standalone research.";
const followUp = "  How does <literal> {count} compare? 日本語 / हिन्दी  \n";
type Fixture = { asks: Array<{ body: Record<string, unknown>; aborted: boolean }>; routes: string[];
  emit(index: number, event: string, data: unknown): void; close(index: number): void };

beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';
    import{FollowUpForm}from'./components/keryx/follow-up-form';import{LanguageSwitcher}from'./components/keryx/language-switcher';
    import{LocaleProvider}from'./lib/i18n/locale-context';import{UiCopyProvider}from'./lib/i18n/ui-copy-provider';
    import{preparedLocales}from'./lib/i18n/locales';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    const originalFetch=window.fetch.bind(window),streams=[];
    const fixture=window.conversationFixture={asks:[],routes:[],emit(index,event,data){streams[index].enqueue(new TextEncoder().encode('event: '+event+'\\ndata: '+JSON.stringify(data)+'\\n\\n'))},close(index){streams[index].close()}};
    window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url??String(input),location.href);
      if(url.origin===location.origin&&url.pathname==='/api/ask'&&init?.method==='POST'){
        const row={body:JSON.parse(init.body),aborted:false};fixture.asks.push(row);init.signal.addEventListener('abort',()=>row.aborted=true,{once:true});
        // Deliberately retain a late chunk after abort to exercise the real consumer epoch guard.
        return Promise.resolve(new Response(new ReadableStream({start(controller){streams.push(controller)}}),{headers:{'content-type':'text/event-stream'}}));
      }return originalFetch(input,init);
    };
    createRoot(document.getElementById('root')).render(<LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider>
      <LanguageSwitcher/><div id="chat"><ResearchChat initialRequest={{question:${JSON.stringify(question)},budget:0,parentId:${JSON.stringify(parent)},visibility:'public',expectedWallet:null}}/></div>
      <div id="follow-up-fixture" className="mx-auto max-w-[960px] px-4"><FollowUpForm parentId=${JSON.stringify(parent)}/></div>
    </UiCopyProvider></LocaleProvider>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture(), { name: "explicit-conversation-no-funding-and-router-boundaries", setup(api) {
      api.onResolve({ filter: /^\.\/session-grant-panel$/ }, args => args.importer.replaceAll("\\", "/").endsWith("/components/keryx/research-chat.tsx") ? { path: "no-funding", namespace: "conversation-funding-fixture" } : undefined);
      api.onLoad({ filter: /^no-funding$/, namespace: "conversation-funding-fixture" }, () => ({ loader: "js", contents: "export function SessionGrantPanel(){return null}" }));
      api.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "conversation-navigation-fixture" }));
      api.onLoad({ filter: /^router$/, namespace: "conversation-navigation-fixture" }, () => ({ loader: "js", contents: "export function useRouter(){return {push:url=>window.conversationFixture.routes.push(url)}}" }));
    } }] });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-chat.tsx", "components/keryx/ask-form.tsx",
    "components/keryx/research-turn.tsx", "components/keryx/reasoning-console.tsx", "components/keryx/follow-up-form.tsx",
    "lib/hooks/use-ask-stream.ts", "lib/hooks/use-research-visibility.ts", "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx"]);
  expect(Object.keys(result.metafile!.inputs)).toContain("conversation-funding-fixture:no-funding");
  expect(Object.keys(result.metafile!.inputs)).toContain("conversation-navigation-fixture:router");
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  css += `@font-face{font-family:ConversationDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:ConversationSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:ConversationMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:ConversationDisplay;--font-spectral:ConversationSerif;--font-spline-mono:ConversationMono}`;
  if (capture) await mkdir(capture, { recursive: true }); browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each((["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru"] as const).flatMap(locale => [320, 1366].map(width => ({ locale, width }))))(
  "preserves actual $locale stop/new/follow-up handoffs and original bytes at $width", async ({ locale, width }) => {
    const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://conversation.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
        if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
        if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "deepseek", label: "Original model", note: "Original model note" }] } });
        if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
        if (url.pathname === "/conversation.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/conversation.css"></head><body><main id="root"></main></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://conversation.test/"); await page.addScriptTag({ content: bundle });
      const asks = () => page.evaluate(() => (window as unknown as { conversationFixture: Fixture }).conversationFixture.asks);
      const selector = page.locator("[data-language-switcher] select"), input = page.locator("#ask-question");
      await expect.poll(() => selector.isEnabled()).toBe(true); await expect.poll(() => input.inputValue()).toBe(question);
      await selector.selectOption(locale); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale);
      expect(await input.inputValue()).toBe(question); expect(await asks()).toEqual([]);
      const chat = page.locator("#chat"), dispatch = chat.locator('[data-tour="dispatch-btn"]');
      await expect.poll(() => dispatch.isEnabled()).toBe(true); await dispatch.click(); await expect.poll(async () => (await asks()).length).toBe(1);
      const first = (await asks())[0]; expect(first.body).toMatchObject({ question, budget: 0, mode: "quick", parentId: parent, visibility: "public" });
      for (const forbidden of ["sessionId", "paymentHeader", "signature", "renewal", "funding"]) expect(first.body).not.toHaveProperty(forbidden);
      await page.evaluate(parent => (window as unknown as { conversationFixture: Fixture }).conversationFixture.emit(0, "meta", { engine: "Synthetic browser", mode: "offline", visibility: "public", reportId: parent }), parent);
      const active = chat.getByTestId("research-turn").last();
      await active.getByText(message("researchTurn.inProgress"), { exact: true }).waitFor();
      expect(await active.getByText(message("researchTurn.findingSources"), { exact: true }).count()).toBe(1);
      expect(await active.locator(".kx-research-request p:last-child").textContent()).toBe(question);
      expect(await active.locator(".kx-research-request p:last-child").getAttribute("lang")).toBe("und");
      await active.locator("summary").click(); await active.getByText(message("decisionLog.connecting"), { exact: true }).waitFor();
      expect(await active.locator('summary [lang="en"]').count()).toBe(1);
      if (capture) await chat.screenshot({ path: join(capture, `conversation-${locale}-${width}-waiting.png`) });
      await page.evaluate(() => (window as unknown as { conversationFixture: Fixture }).conversationFixture.emit(0, "step", { phase: "discover", ts: 1, message: "New research" }));
      await expect.poll(() => active.locator('.kx-research-live [lang="und"]').textContent()).toBe("New research");
      await chat.getByRole("button", { name: message("researchChat.stopResearch"), exact: true }).click();
      await expect.poll(async () => (await asks())[0].aborted).toBe(true);
      expect(await chat.locator('[role="status"] [lang="en"]').filter({ hasText: englishMessages["researchTurn.stoppedNotice"] }).count()).toBe(1);
      await page.evaluate(() => { const f = (window as unknown as { conversationFixture: Fixture }).conversationFixture; f.emit(0, "step", { phase: "discover", ts: 2, message: "LATE OLD ORIGINAL MUST STAY HIDDEN" }); f.close(0); });
      expect(await chat.textContent()).not.toContain("LATE OLD ORIGINAL MUST STAY HIDDEN"); expect(await asks()).toHaveLength(1);
      await chat.getByRole("button", { name: message("researchChat.newResearch"), exact: true }).click(); await input.fill(nextQuestion);
      expect(await input.inputValue()).toBe(nextQuestion); expect(await chat.textContent()).toContain(question);
      expect(await chat.getByText(englishMessages["researchChat.newQuestionContext"], { exact: true }).getAttribute("lang")).toBe("en");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (capture) await chat.screenshot({ path: join(capture, `conversation-${locale}-${width}-new-research.png`) });
      await dispatch.click(); await expect.poll(async () => (await asks()).length).toBe(2);
      expect((await asks())[1].body).toMatchObject({ question: nextQuestion, budget: 0, mode: "quick", visibility: "public" });
      expect((await asks())[1].body).not.toHaveProperty("parentId");
      const form = page.locator("#follow-up-fixture"), followInput = form.locator("textarea");
      expect(await followInput.getAttribute("placeholder")).toBe(message("followUp.placeholder")); expect(await followInput.getAttribute("maxlength")).toBe("500");
      const submit = form.getByRole("button", { name: message("followUp.submit"), exact: true }); expect(await submit.isDisabled()).toBe(true);
      await followInput.fill(followUp); expect(await followInput.inputValue()).toBe(followUp); await followInput.press("Control+Enter");
      await submit.click();
      const routes = await page.evaluate(() => (window as unknown as { conversationFixture: Fixture }).conversationFixture.routes);
      expect(routes).toHaveLength(2); expect(routes[0]).toBe(routes[1]);
      const destination = new URL(routes[0], "https://conversation.test");
      expect(destination.pathname).toBe("/"); expect(destination.searchParams.get("q")).toBe(followUp.trim());
      expect(destination.searchParams.get("parent")).toBe(parent); expect(destination.searchParams.get("run")).toBe("1");
      expect([...destination.searchParams.keys()].sort()).toEqual(["parent", "q", "run"]);
      expect(await form.locator('[lang="en"]').filter({ hasText: englishMessages["followUp.paymentNotice"] }).count()).toBe(1);
      expect(await form.locator('[lang="en"]').filter({ hasText: englishMessages["followUp.contextNotice"] }).count()).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (capture) await form.screenshot({ path: join(capture, `conversation-${locale}-${width}-follow-up.png`) });
      expect(await asks()).toHaveLength(2); await page.evaluate(() => (window as unknown as { conversationFixture: Fixture }).conversationFixture.close(1));
      expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }, 20_000,
);
