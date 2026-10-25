/** Authored research UI + CSS in Chromium; explicit signed-out/grant boundary and synthetic GETs only. */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { assertResearchBrowserFixtureGraph, signedOutResearchAuthFixture } from "../test-support/research-browser-auth-fixture";

const output = process.env.KERYX_UX_SCREENSHOT_DIR;
if (output) await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{ResearchChat}from'./components/keryx/research-chat';
    createRoot(document.getElementById('root')).render(<ResearchChat introduceProduct/>);`,
    loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  external: ["@/lib/x402-client-sign", "@/lib/payments/browser-fetch-price-policy"],
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [signedOutResearchAuthFixture(), { name: "no-wallet-grant", setup(api) {
    api.onResolve({ filter: /session-grant-panel$/ }, () => ({ path: "grant", namespace: "desk-fixture" }));
    api.onLoad({ filter: /.*/, namespace: "desk-fixture" }, () => ({ contents: "export function SessionGrantPanel(){return null}", loader: "js" }));
  } }],
});
assertResearchBrowserFixtureGraph(bundle.metafile);
const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"),
  { from: path.resolve("app/globals.css") })).css;
const fonts = `@font-face{font-family:DeskDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:DeskSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:DeskMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
  :root{--font-bodoni:DeskDisplay;--font-spectral:DeskSerif;--font-spline-mono:DeskMono}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], requests: string[] = [];
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, "https://research-desk.test", "No outbound requests");
      assert.equal(request.method(), "GET", "Design fixture cannot submit research, funding or telemetry");
      if (url.pathname.startsWith("/api/")) {
        requests.push(url.pathname);
        if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
        if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
        if (url.pathname === "/api/models") return route.fulfill({ json: { models: [] } });
        assert.equal(url.pathname, "/api/sources");
        return route.fulfill({ json: { sources: [] } });
      }
      if (url.pathname === "/desk.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(path.join("app", url.pathname)) });
      assert.equal(url.pathname, "/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/desk.css"></head><body class="bg-paper-2"><div id="root"></div></body></html>' });
    });
    try {
      await page.goto("https://research-desk.test/");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const question = page.getByRole("textbox", { name: "What do you want to know?" });
      await question.waitFor();
      await page.getByTestId("composer-publication-notice").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        const headline = document.createRange(); headline.selectNodeContents(document.querySelector("h1"));
        return { width: innerWidth, docWidth: document.documentElement.scrollWidth,
          question: rect("textarea"), action: rect('[data-tour="dispatch-btn"]'),
          guide: rect('[data-testid="hero-guide"]'), headline: headline.getBoundingClientRect().toJSON() };
      })()`);
      console.log(JSON.stringify(geometry));
      assert.equal(geometry.docWidth, width, "No horizontal overflow");
      assert(geometry.headline.right <= geometry.guide.left || geometry.headline.top >= geometry.guide.bottom || geometry.headline.bottom <= geometry.guide.top,
        "Guide and actual headline text must not intersect");
      assert(geometry.question.bottom < geometry.action.top);
      if (width < 640) assert(geometry.action.bottom + 107 <= 640, "Primary action fits a 640px mobile viewport including navigation and settlement strip");
      if (output) await page.screenshot({ path: path.join(output, `desk-${width}.png`), fullPage: true });
      const examples = page.locator('[aria-label="Example questions"] button');
      assert.equal(await examples.count(), 2);
      await examples.first().click();
      assert.match(await question.inputValue(), /SQLite WAL/);
      assert.equal(await question.evaluate(element => element === document.activeElement), true, "Example returns focus to the editable question");
      await question.fill("Edited draft only; never submit");
      const quick = page.locator('input[name="research-depth"][value="quick"]');
      await quick.focus(); await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator('input[name="research-depth"][value="deep"]').isChecked(), true);
      assert.equal(await question.inputValue(), "Edited draft only; never submit");
      const options = page.locator("summary").filter({ hasText: "More options" });
      await options.focus(); await page.keyboard.press("Enter");
      assert.equal(await page.getByLabel("Maximum budget in USDC").isVisible(), true);
      assert.equal(await page.getByTestId("composer-payer-notice").isVisible(), true);
      if (output) await page.screenshot({ path: path.join(output, `desk-${width}-options.png`), fullPage: true });
      assert.deepEqual(errors, []);
      assert(requests.includes("/api/ask/visibility") && requests.includes("/api/research/availability"));
    } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
  }
  console.log("PASS: styled real research desk at 320/390/768/1440px, local fonts, non-overlapping hero, primary action, example focus, native radio/disclosure keyboard controls; GET-only fixture.");
} finally { await browser.close(); }
