import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR
  ? join(process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR, "interrupted-research") : undefined;
const reportId = "11111111-2222-4333-8444-555555555555";
const question = "Synthetic original question <literal> {count}\n日本語 / हिन्दी";
const originalStep = { phase: "discover", ts: 0, message: "Original recorded discovery message." };

beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ResearchTurn} from './components/keryx/research-turn';
    import {useAskStream} from './lib/hooks/use-ask-stream';import {LocaleProvider} from './lib/i18n/locale-context';
    import {UiCopyProvider} from './lib/i18n/ui-copy-provider';import {LanguageSwitcher} from './components/keryx/language-switcher';
    import {preparedLocales} from './lib/i18n/locales';import {loadUiPreview} from './lib/i18n/ui-preview-catalogues';
    const opts={sourceIndex:new Map(),getSessionWalletClient:()=>{throw Error('No signing in this zero-budget fixture')}};
    function Live(){const{state,ask}=useAskStream(opts);return <><LanguageSwitcher/><button type="button" onClick={()=>void ask(${JSON.stringify(question)},0)}>Deliver synthetic interrupted stream</button>
      <output data-testid="delivery-status">{state.status}</output><ResearchTurn turn={{id:1,question:${JSON.stringify(question)},payer:'Synthetic zero-budget fixture',state}}/></>}
    createRoot(document.getElementById('root')).render(<LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider><Live/></UiCopyProvider></LocaleProvider>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture()] });
  assertSignedOutBrowserFixtureGraph(result.metafile, ["components/keryx/research-turn.tsx", "lib/hooks/use-ask-stream.ts",
    "lib/research/ask-stream-lifecycle.ts", "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx"]);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  css += `@font-face{font-family:RecoveryDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:RecoverySerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:RecoveryMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:RecoveryDisplay;--font-spectral:RecoverySerif;--font-spline-mono:RecoveryMono}`;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each((["en", "ja"] as const).flatMap(language => [320, 1366].map(width => ({ language, width }))))(
  "keeps original GET recovery manual and renders the uncertain EOF guidance under $language UI at $width", async ({ language, width }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [], posts: unknown[] = [], originalReads: string[] = [];
    let manualRead = false;
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://interrupted-research.test") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (request.method() === "POST" && url.pathname === "/api/ask") {
          const body = request.postDataJSON(); posts.push(body); expect(body).toEqual({ question, budget: 0, mode: "quick" });
          const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          return route.fulfill({ contentType: "text/event-stream", body: frame("meta", { engine: "synthetic", mode: "offline", visibility: "unlisted", reportId }) + frame("step", originalStep) });
        }
        if (request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === `/dispatch/${reportId}` && manualRead) {
          originalReads.push(url.pathname); return route.fulfill({ contentType: "text/plain", body: `Synthetic original report ${reportId}` });
        }
        if (url.pathname === "/recovery.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/recovery.css"></head><body><main id="root" class="mx-auto max-w-[960px] p-4"></main></body></html>' });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
      await page.goto("https://interrupted-research.test/"); await page.addScriptTag({ content: bundle });
      const selector = page.locator("[data-language-switcher] select"); await expect.poll(() => selector.isEnabled()).toBe(true);
      await selector.selectOption(language); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(language);
      await page.getByRole("button", { name: "Deliver synthetic interrupted stream", exact: true }).click();
      await expect.poll(() => page.getByTestId("delivery-status").textContent()).toBe("error");
      const alert = page.getByRole("alert"), text = await alert.textContent();
      expect(text).toContain("does not confirm that research or payments stopped");
      expect(text).toContain("do not submit or sign again automatically"); expect(text).not.toContain("please try again");
      expect(await page.getByText(question, { exact: true }).count()).toBeGreaterThan(0);
      const saved = alert.locator(`a[href="/dispatch/${reportId}"]`); expect(await saved.getAttribute("target")).toBe("_blank");
      expect(await saved.getAttribute("rel")).toBe("noopener noreferrer"); expect(await saved.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(posts).toHaveLength(1); expect(originalReads).toEqual([]);
      if (screenshots) await page.locator("#root").screenshot({ path: join(screenshots, `interrupted-${language}-${width}.png`) });
      manualRead = true;
      const popupPromise = page.waitForEvent("popup"); await saved.click(); const popup = await popupPromise; await popup.waitForLoadState("domcontentloaded");
      expect(await popup.locator("body").textContent()).toBe(`Synthetic original report ${reportId}`);
      expect(originalReads).toEqual([`/dispatch/${reportId}`]); expect(posts).toHaveLength(1); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }, 15_000,
);
