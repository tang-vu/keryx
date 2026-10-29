import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { sha256, stringToHex } from "viem";
import { afterAll, beforeAll, expect, it } from "vitest";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";
import type { QueryRun } from "../types";

let browser: Browser, bundle: string, css: string;
const captureRoot = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR;
const screenshots = captureRoot ? join(captureRoot, "live-answer-language") : undefined;
const question = "Synthetic original question <literal> {count} USDC\n日本語 / हिन्दी";
const originalStep = { phase: "discover" as const, ts: 0, message: "Original recorded source-discovery message." };

beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ResearchTurn} from './components/keryx/research-turn';
    import {useAskStream} from './lib/hooks/use-ask-stream';import {LocaleProvider} from './lib/i18n/locale-context';
    import {UiCopyProvider} from './lib/i18n/ui-copy-provider';import {LanguageSwitcher} from './components/keryx/language-switcher';
    import {preparedLocales} from './lib/i18n/locales';import {loadUiPreview} from './lib/i18n/ui-preview-catalogues';
    const noSources=new Map();const opts={sourceIndex:noSources,getSessionWalletClient:()=>{throw Error('Signing is outside this zero-budget fixture')}};
    function Live(){const{state,ask}=useAskStream(opts);return <><LanguageSwitcher/><button type="button" id="deliver" onClick={()=>void ask(${JSON.stringify(question)},0)}>Deliver synthetic completion</button>
      <output data-testid="delivery-status">{state.status}/{state.run?.id}</output><ResearchTurn turn={{id:1,question:${JSON.stringify(question)},payer:'Synthetic zero-budget fixture',state}}/></>}
    createRoot(document.getElementById('root')).render(<LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider><Live/></UiCopyProvider></LocaleProvider>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture()] });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-turn.tsx", "components/keryx/answer-card.tsx",
    "components/keryx/answer-markdown.tsx", "lib/hooks/use-ask-stream.ts", "lib/research/answer-language-provenance.ts",
    "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx"]);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  css += `@font-face{font-family:LiveDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:LiveSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:LiveMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:LiveDisplay;--font-spectral:LiveSerif;--font-spline-mono:LiveMono}`;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

it.each((["ja", "hi"] as const).flatMap(language => [320, 1366].map(width => ({ language, width }))))(
  "keeps completed $language prose tagged independently of the UI and refuses the next stale packet at $width",
  async ({ language, width }) => {
    const answer = language === "ja" ? "これは保存された日本語の回答です。" : "यह सहेजा गया हिंदी उत्तर है।";
    const run: QueryRun = { id: "11111111-2222-4333-8444-555555555555", question, answer,
      createdAt: "2026-10-29T00:00:00Z", engine: "Synthetic renderer", budget: 0, totalSpent: 0, totalToCreators: 0,
      subClaims: [], decisions: [], citations: [], trace: [originalStep, { phase: "done", ts: 1, message: "Synthetic retained terminal packet",
        detail: { answerLanguage: { format: "keryx-answer-language-v1", scope: "generated-prose", language,
          method: "deterministic-renderer", answerSha256: sha256(stringToHex(answer)) } } }] };
    let next = structuredClone(run);
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [], posts: unknown[] = [], feedback: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://live-language.test") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (request.method() === "POST" && url.pathname === "/api/ask") {
          const body = request.postDataJSON(); posts.push(body);
          expect(body).toEqual({ question, budget: 0, mode: "quick" });
          const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          return route.fulfill({ contentType: "text/event-stream", body: frame("meta", { engine: "Synthetic renderer", mode: "offline" }) + frame("step", originalStep) + frame("done", next) });
        }
        if (request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === "/api/feedback" && [run.id, "66666666-2222-4333-8444-555555555555"].includes(url.searchParams.get("queryId") ?? "")) {
          feedback.push(url.searchParams.get("queryId")!); return route.fulfill({ json: { up: 0, down: 0 } });
        }
        if (url.pathname === "/live.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/live.css"></head><body><main id="root" class="mx-auto max-w-[960px] p-4"></main></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://live-language.test/"); await page.addScriptTag({ content: bundle });
      const selector = page.locator("[data-language-switcher] select"), deliver = page.getByRole("button", { name: "Deliver synthetic completion", exact: true });
      await expect.poll(() => selector.isEnabled()).toBe(true); await selector.selectOption("fr");
      await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("fr"); await deliver.click();
      await expect.poll(() => page.getByTestId("delivery-status").textContent()).toBe(`done/${run.id}`);
      const prose = page.locator(".kx-research-answer [lang]").filter({ has: page.getByText(answer, { exact: true }) });
      expect(await prose.getAttribute("lang")).toBe(language);
      expect(await page.getByText(question, { exact: true }).count()).toBeGreaterThan(0);
      const saved = page.locator(`a[href="/dispatch/${run.id}"]`); expect(await saved.count()).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (screenshots) await page.locator("#root").screenshot({ path: join(screenshots, `live-${language}-${width}.png`) });
      await selector.selectOption("ja"); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("ja");
      expect(await prose.getAttribute("lang")).toBe(language);
      next = structuredClone(run); next.id = "66666666-2222-4333-8444-555555555555"; next.answer += " Changed.";
      await deliver.click(); await expect.poll(() => page.getByTestId("delivery-status").textContent()).toBe(`done/${next.id}`);
      const changed = page.locator(".kx-research-answer [lang]").filter({ has: page.getByText(next.answer, { exact: true }) });
      expect(await changed.getAttribute("lang")).toBe("und");
      if (screenshots) await page.locator("#root").screenshot({ path: join(screenshots, `live-${language}-${width}-unknown.png`) });
      expect(posts).toHaveLength(2); expect(feedback).toContain(run.id); expect(feedback).toContain(next.id);
      expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }, 15_000,
);
