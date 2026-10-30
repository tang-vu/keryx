import { mkdir, readFile } from "node:fs/promises";
import { decisionReviewCopy } from "./decision-review-copy";
import { answerLanguageInstructions } from "../../shared/i18n/answer-language-instructions";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { createMessages, englishMessages } from "../i18n/messages";
import { ARC_TESTNET_PROFILE } from "../arc-network-profile";

let browser: Browser, bundle: string, researchBundle: string, nativeBundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const nativeScreenshots = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR ?? screenshots;
type GuideFixture = { dispatches: number; budgetEvents: number; context(value: boolean): void; long(value: boolean): void; mount(value: boolean): void };
const fonts = `@font-face{font-family:GuideDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:GuideSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:GuideMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:GuideDisplay;--font-spectral:GuideSerif;--font-spline-mono:GuideMono}`;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{OnboardingTour}from'./components/keryx/onboarding-tour';import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';
    const fixture=window.guideFixture={dispatches:0,budgetEvents:0};
    const targetStyle={position:'relative',marginTop:100,padding:24,background:'rgb(225,215,192)',border:'1px solid #b6a887'};
    function App(){const[contextual,setContextual]=useState(false),[long,setLong]=useState(false),[mounted,setMounted]=useState(true),[expanded,setExpanded]=useState(false);
      fixture.context=setContextual;fixture.long=setLong;fixture.mount=setMounted;
      useEffect(()=>{const expand=()=>{fixture.budgetEvents++;setExpanded(true)};document.addEventListener('keryx:tour-budget',expand);return()=>document.removeEventListener('keryx:tour-budget',expand)},[]);
      const copy={...englishUiCopy,message:(key,values)=>{const text=englishUiCopy.message(key,values);if(/^researchTour\\..*(?:Title|Body)$/.test(key))return(contextual?'[preview] ':'')+text+(long&&key.endsWith('Body')?' Additional reading detail.'.repeat(70):'');return text}};
      return <UiCopyContext.Provider value={copy}><main style={{maxWidth:900,margin:'32px auto',padding:'0 24px',paddingBottom:500}}>
        {mounted&&<OnboardingTour/>}
        <section data-tour="hero" style={{...targetStyle,height:180}}><h1 style={{fontFamily:'var(--font-bodoni)',fontSize:32}}>Research desk fixture</h1></section>
        <section data-tour="ask-form" style={{...targetStyle,height:200}}><label>Question<input aria-label="Retained question" defaultValue="An intact user question"/></label></section>
        <section data-tour="budget" hidden={!expanded} style={{...targetStyle,height:160}}><label>Budget<input aria-label="Retained budget" defaultValue="0.04"/></label></section>
        <button data-tour="dispatch-btn" onClick={()=>fixture.dispatches++} style={{...targetStyle,minHeight:48}}>Start fixture research</button>
      </main></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  expect(Object.keys(result.metafile!.inputs).some(path => path.replaceAll("\\", "/").endsWith("components/keryx/onboarding-tour.tsx"))).toBe(true);
  bundle = result.outputFiles[0].text;
  const research = await build({ stdin: { contents: "import React from'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';createRoot(document.getElementById('root')).render(<ResearchChat introduceProduct/>);", loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture(), { name: "explicit-no-funding-guide-boundary", setup(api) {
      api.onResolve({ filter: /^\.\/session-grant-panel$/ }, args => args.importer.replaceAll("\\", "/").endsWith("/components/keryx/research-chat.tsx") ? { path: "no-funding", namespace: "guide-funding-fixture" } : undefined);
      api.onLoad({ filter: /^no-funding$/, namespace: "guide-funding-fixture" }, () => ({ loader: "js", contents: "export function SessionGrantPanel(){return null}" }));
    } }] });
  assertSignedOutBrowserFixtureGraph(research.metafile, ["components/keryx/research-chat.tsx", "components/keryx/ask-form.tsx", "components/keryx/onboarding-tour.tsx", "lib/hooks/use-ask-stream.ts"]);
  researchBundle = research.outputFiles[0].text;
  const native = await build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{ResearchChat}from'./components/keryx/research-chat';
    import{LanguageSwitcher}from'./components/keryx/language-switcher';import{LocaleProvider}from'./lib/i18n/locale-context';import{UiCopyProvider}from'./lib/i18n/ui-copy-provider';import{preparedLocales}from'./lib/i18n/locales';import{loadUiPreview}from'./lib/i18n/ui-preview-catalogues';
    const fixture=window.guideFixture={dispatches:0,budgetEvents:0};document.addEventListener('keryx:tour-budget',()=>fixture.budgetEvents++);
    createRoot(document.getElementById('root')).render(<LocaleProvider network="eip155:5042002" enabledLocales={preparedLocales} prepareLocale={loadUiPreview}><UiCopyProvider><LanguageSwitcher/><ResearchChat introduceProduct/></UiCopyProvider></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) },
    plugins: [signedOutResearchAuthFixture(), { name: "explicit-native-guide-no-funding-boundary", setup(api) {
      api.onResolve({ filter: /^\.\/session-grant-panel$/ }, args => args.importer.replaceAll("\\", "/").endsWith("/components/keryx/research-chat.tsx") ? { path: "no-funding", namespace: "native-guide-funding-fixture" } : undefined);
      api.onLoad({ filter: /^no-funding$/, namespace: "native-guide-funding-fixture" }, () => ({ loader: "js", contents: "export function SessionGrantPanel(){return null}" }));
    } }] });
  assertSignedOutBrowserFixtureGraph(native.metafile, ["components/keryx/research-chat.tsx", "components/keryx/ask-form.tsx", "components/keryx/onboarding-tour.tsx",
    "components/keryx/language-switcher.tsx", "lib/i18n/locale-context.tsx", "lib/i18n/ui-copy-provider.tsx", "lib/hooks/use-ask-stream.ts"]);
  nativeBundle = native.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  if (nativeScreenshots && nativeScreenshots !== screenshots) await mkdir(nativeScreenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

it.each([...(["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const).flatMap(locale =>
  [320, 1366].map(width => ({ locale, width, font: 16 }))), { locale: "fr" as const, width: 320, font: 24 },
  { locale: "pt-BR" as const, width: 320, font: 32 },
  { locale: "ru" as const, width: 320, font: 32 }, { locale: "ru" as const, width: 1366, font: 32 },
  { locale: "ar" as const, width: 390, font: 16 },
  ...[320, 390, 1366].map(width => ({ locale: "ar" as const, width, font: 32 }))])("keeps the native $locale first-use journey and unsent originals intact at $width with $font px text", async ({ locale, width, font }) => {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
  const errors: string[] = [], requests: Array<{ path: string; method: string }> = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "https://guide.test" || request.method() !== "GET") { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      if (url.pathname.startsWith("/api/")) {
        requests.push({ path: url.pathname, method: request.method() });
        if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401 });
        if (url.pathname === "/api/research/availability") return route.fulfill({ json: { state: "not-paused" } });
        if (url.pathname === "/api/ask/visibility") return route.fulfill({ json: { wallet: null, defaultVisibility: "public", privacyActive: true } });
        if (url.pathname === "/api/models") return route.fulfill({ json: { models: [{ id: "deepseek", label: "Original model", note: "Original model note" }] } });
        if (url.pathname === "/api/sources") return route.fulfill({ json: { sources: [] } });
        unexpected.push(`Unexpected GET ${url.pathname}`); return route.abort();
      }
      if (url.pathname === "/guide.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide.css"></head><body><div id="root"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://guide.test/"); await page.addScriptTag({ content: nativeBundle });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
    const selector = page.locator("[data-language-switcher] select"), input = page.locator("#ask-question");
    await expect.poll(() => selector.isEnabled()).toBe(true); await input.waitFor();
    const original = "Unsent हिन्दी 日本語 <literal> {count} USDC", handle = await input.elementHandle();
    await input.fill(original);
    const metadataHref = await page.getByTestId("paper-metadata-handoff").getAttribute("href");
    await selector.selectOption(locale);
    await expect.poll(() => page.locator("html").getAttribute("lang")).toBe(locale);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator("#ask-keyboard-hint [lang]").textContent()).toBe(message("researchEntry.keyboardHint"));
    expect(await page.locator("#ask-keyboard-hint [lang]").getAttribute("lang")).toBe(locale);
    await page.locator("summary").filter({ hasText: message("researchEntry.moreOptions") }).click();
    const metadata = page.getByRole("link", { name: message("researchEntry.metadataLookupLabel"), exact: true });
    expect(await metadata.textContent()).toBe(message("researchEntry.metadataLookup"));
    expect(await metadata.getAttribute("lang")).toBe(locale); expect(await metadata.getAttribute("href")).toBe(metadataHref);
    expect(await page.getByRole("group", { name: message("researchEntry.examplesLabel"), exact: true }).count()).toBe(1);
    await page.getByText(message("researchEntry.quickHint"), { exact: true }).waitFor();
    await page.getByRole("radio", { name: message("researchEntry.deep"), exact: true }).check();
    await page.getByText(message("researchEntry.deepHint"), { exact: true }).waitFor();
    const guideBounds = await page.getByTestId("hero-guide").getByRole("button").boundingBox();
    expect(guideBounds).toBeTruthy();
    const kickerClear = await page.getByTestId("hero-kicker").evaluate((element, guide) => {
      const range = document.createRange(); range.selectNodeContents(element);
      return Array.from(range.getClientRects()).every(rect => rect.right <= guide!.x + 1 || rect.left >= guide!.x + guide!.width - 1 ||
        rect.bottom <= guide!.y + 1 || rect.top >= guide!.y + guide!.height - 1);
    }, guideBounds);
    expect(kickerClear, "The guide trigger must leave the complete native kicker visible").toBe(true);
    if (locale === "ar") {
      const globe = await page.getByTestId("chat-globe").locator("svg").first().boundingBox();
      expect(globe).toBeTruthy();
      const titleGeometry = await page.locator(".kx-research-title").evaluate((element, circle) => {
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects());
        return { clear: rects.every(rect => rect.right <= circle!.x + 1 || rect.left >= circle!.x + circle!.width - 1 ||
          rect.bottom <= circle!.y + 1 || rect.top >= circle!.y + circle!.height - 1),
          title: element.getBoundingClientRect().toJSON(), rects: rects.map(rect => rect.toJSON()), circle,
          direction: getComputedStyle(element).direction };
      }, globe);
      if (!titleGeometry.clear && nativeScreenshots) await page.screenshot({ path: join(nativeScreenshots, `arabic-hero-finding-${width}-font${font}.png`), fullPage: true });
      expect(titleGeometry.clear, `The painted globe must leave every Arabic headline glyph clear: ${JSON.stringify(titleGeometry)}`).toBe(true);
    }
    const submitFits = await page.locator('[data-tour="dispatch-btn"]').evaluate(button => {
      const bounds = button.getBoundingClientRect();
      return Array.from(button.querySelectorAll("[lang]")).every(span => {
        const range = document.createRange(); range.selectNodeContents(span);
        return Array.from(range.getClientRects()).every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1);
      });
    });
    expect(submitFits, "The submit button must not clip its native label").toBe(true);
    const optionsFit = await page.locator(".kx-research-depth").evaluateAll(labels => labels.every(label => {
      const bounds = label.getBoundingClientRect();
      return label.scrollWidth <= label.clientWidth && Array.from(label.querySelectorAll("span")).every(span =>
        Array.from(span.getClientRects()).every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1));
    }));
    expect(optionsFit, "Each translated depth label must fit its own option").toBe(true);
    expect(await page.getByTestId("composer-payer-notice").textContent()).toBe(englishMessages["researchEntry.freeTrialNotice"]);
    expect(await page.getByTestId("composer-payer-notice").locator('[lang="en"]').count()).toBe(1);
    expect(await input.inputValue()).toBe(original); expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const frame = `${locale}-${width}${font === 16 ? "" : `-font${font}`}`;
    if (nativeScreenshots) await page.locator("#root").screenshot({ path: join(nativeScreenshots, `guide-native-composer-${frame}.png`) });
    const trigger = page.getByRole("button", { name: message("researchTour.open"), exact: true }); await trigger.click();
    const dialog = page.getByRole("dialog", { name: message("researchTour.label"), exact: true }); await dialog.waitFor();
    await expect.poll(() => dialog.getByRole("button", { name: message("researchTour.closeLabel"), exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    for (const [index, title, body] of [
      [0, "researchTour.budgetTitle", "researchTour.budgetBody"], [1, "researchTour.questionTitle", "researchTour.questionBody"],
      [2, "researchTour.capTitle", "researchTour.capBody"], [3, "researchTour.startTitle", "researchTour.startBody"],
    ] as const) {
      const reader = dialog.getByRole("region", { name: message(title), exact: true }); await reader.waitFor();
      expect(await reader.locator("h2 [lang]").getAttribute("lang")).toBe(index === 0 || index === 2 ? "en" : locale);
      expect(await reader.locator("p [lang]").getAttribute("lang")).toBe(index === 1 ? locale : "en");
      expect(await reader.locator("p").textContent()).toBe(message(body, { network: ARC_TESTNET_PROFILE.label }));
      if (locale === "ar") {
        expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
        expect(await input.getAttribute("dir")).toBe("auto");
        expect(await reader.locator("h2 [lang]").evaluate(element => getComputedStyle(element).direction)).toBe(index === 0 || index === 2 ? "ltr" : "rtl");
        expect(await reader.locator("p [lang]").evaluate(element => getComputedStyle(element).direction)).toBe(index === 1 ? "rtl" : "ltr");
      }
      const bounds = await dialog.boundingBox(); expect(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 844).toBe(true);
      const buttons = await dialog.locator("button").evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height }; }));
      expect(buttons.every(rect => rect.height >= 44 && rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 844)).toBe(true);
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (font > 16 && index === 1) {
        const geometry = await reader.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
        expect(geometry.height).toBeGreaterThan(44);
        // Desktop fallback fonts can fit the complete Russian paragraph without scrolling.
        // Narrow enlarged-text cases must still exercise keyboard scrolling.
        if (width === 320) expect(geometry.contentHeight).toBeGreaterThan(geometry.height);
        if (geometry.contentHeight > geometry.height) {
          await reader.focus(); const top = await reader.evaluate(element => element.scrollTop);
          await page.keyboard.press("PageDown"); await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(top);
        } else {
          expect(await reader.evaluate(element => {
            const bounds = element.getBoundingClientRect(), range = document.createRange();
            range.selectNodeContents(element.querySelector("p")!);
            return Array.from(range.getClientRects()).every(rect => rect.top >= bounds.top && rect.bottom <= bounds.bottom);
          }), "A guide that needs no scrolling must show its complete paragraph").toBe(true);
        }
      }
      await expectAlignedSpotlight(page, ["hero", "ask-form", "budget", "dispatch-btn"][index]);
      if (nativeScreenshots) await page.screenshot({ path: join(nativeScreenshots, `guide-native-${frame}-step-${index + 1}.png`) });
      const action = dialog.getByRole("button", { name: message(index === 3 ? "researchTour.done" : "researchTour.next"), exact: true });
      if (locale === "ar") expect(await action.locator('[aria-hidden="true"]').evaluate(element => getComputedStyle(element, "::before").content)).toContain("←");
      await action.focus(); await page.keyboard.press("Enter");
    }
    await expect.poll(() => page.locator("[data-keryx-tour-portal]").count()).toBe(0);
    expect(await trigger.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await input.inputValue()).toBe(original); expect(await page.getByTestId("paper-metadata-handoff").getAttribute("href")).toBe(metadataHref);
    expect(await page.evaluate(() => (window as unknown as { guideFixture: GuideFixture }).guideFixture.budgetEvents)).toBe(1);
    if (locale === "ar") {
      const privacy = page.getByTestId("research-visibility").getByRole("status");
      expect(await privacy.isVisible()).toBe(true);
      expect(await privacy.locator('[lang="en"]').getAttribute("dir")).toBe("ltr");
      expect(await privacy.locator('[lang="en"]').evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
      const reviewNotice = page.getByText(decisionReviewCopy.modeNotice, { exact: true });
      expect(await reviewNotice.getAttribute("lang")).toBe("en");
      expect(await reviewNotice.evaluate(element => getComputedStyle(element).direction)).toBe("ltr");
      const help = page.locator("[data-answer-language-help]");
      await help.getByRole("button").click();
      for (const example of answerLanguageInstructions) {
        const code = help.locator(`code[lang="${example.language}"]`);
        expect(await code.textContent()).toBe(example.instruction);
        expect(await code.evaluate(element => getComputedStyle(element).direction)).toBe(example.language === "ar" ? "rtl" : "ltr");
      }
      expect(await input.inputValue()).toBe(original);
      if (nativeScreenshots) await help.screenshot({ path: join(nativeScreenshots, `guide-native-help-${frame}.png`) });
      await help.getByRole("button").click();
    }
    await selector.selectOption("en"); await expect.poll(() => page.locator("html").getAttribute("lang")).toBe("en");
    expect(await input.inputValue()).toBe(original); expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
    expect(requests.length).toBeGreaterThan(0); expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

it.each([[390, 844], [1366, 844], [320, 480], [320, 360]])("keeps actual research guide targets and controls accessible at %i/%i", async (width, height) => {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  const errors: string[] = [], reads: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      expect(url.origin).toBe("https://guide.test"); expect(request.method()).toBe("GET");
      if (url.pathname.startsWith("/api/")) {
        reads.push(url.pathname); expect(url.pathname).not.toBe("/api/ask");
        return route.fulfill({ status: 503, json: { error: "Offline guide fixture" } });
      }
      if (url.pathname === "/guide.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide.css"></head><body><header style="height:67px;position:sticky;top:0;z-index:50;background:var(--paper)"><a href="/">Fixture home</a></header><main id="root"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://guide.test/"); await page.addScriptTag({ content: researchBundle });
    await page.getByRole("button", { name: "How it works", exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    const dialog = await open(page);
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector('[data-research-intro] > header')?.getBoundingClientRect();
      const mask = document.querySelector('[data-keryx-tour-portal] mask rect[fill="black"]');
      return !!header && !!mask && Number(mask.getAttribute("height")) <= header.height + 16 && Number(mask.getAttribute("height")) > 100;
    })).toBe(true);
    if (screenshots) await page.screenshot({ path: join(screenshots, "guide-research-introduction-" + width + (height === 844 ? "" : "-" + height) + ".png"), fullPage: true });
    await page.evaluate(() => document.querySelector<HTMLElement>("header a")?.focus());
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await dialog.getByRole("button", { name: "Close tour", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Next");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Close tour");
    for (let step = 0; step < 4; step++) {
      await page.waitForTimeout(500);
      const sheet = await dialog.boundingBox();
      expect(sheet && sheet.x >= 0 && sheet.y >= 0 && sheet.x + sheet.width <= width && sheet.y + sheet.height <= height).toBe(true);
      if (width < 640) {
        const target = await page.locator('[data-tour="' + ["hero", "ask-form", "budget", "dispatch-btn"][step] + '"]').boundingBox();
        expect(target && sheet && target.y < sheet.y && target.y + target.height > 106).toBe(true);
      }
      if (step < 3) await dialog.getByRole("button", { name: "Next", exact: true }).click();
    }
    await page.keyboard.press("Escape"); expect(await page.locator('[data-keryx-tour-portal]').count()).toBe(0);
    expect(await page.getByRole("button", { name: "How it works", exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    expect(reads.length).toBeGreaterThan(0); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

async function fixture(test: (page: Page) => Promise<void>, width = 390, height = 800, motion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
  const errors: string[] = [], api: string[] = [];
  try {
    await context.route("**/*", async route => {
      const url = new URL(route.request().url()); expect(url.origin).toBe("https://guide.test"); expect(route.request().method()).toBe("GET");
      if (url.pathname.startsWith("/api/")) api.push(url.pathname);
      if (url.pathname === "/guide.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide.css"></head><body><div id="root" aria-hidden="false"></div><aside id="preserved" inert aria-hidden="true">Retained inaccessible background</aside></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://guide.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: "How it works", exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    await test(page);
    expect(await page.evaluate(() => (window as unknown as { guideFixture: GuideFixture }).guideFixture.dispatches)).toBe(0);
    expect(errors).toEqual([]); expect(api).toEqual([]);
  } finally { await context.close(); }
}
const change = (page: Page, key: "context" | "long" | "mount", value: boolean) => page.evaluate(({ key, value }) => (window as unknown as { guideFixture: GuideFixture }).guideFixture[key](value), { key, value });
const open = async (page: Page) => {
  await page.getByRole("button", { name: "How it works", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "How Keryx works", exact: true }); await dialog.waitFor();
  await expect.poll(() => dialog.getByRole("button", { name: "Close tour", exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.getAnimations().some(animation => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity))).toBe(false);
  return dialog;
};
const restored = async (page: Page) => {
  await expect.poll(() => page.locator("[data-keryx-tour-portal]").count()).toBe(0);
  expect(await page.locator("#root").getAttribute("inert")).toBeNull(); expect(await page.locator("#root").getAttribute("aria-hidden")).toBe("false");
  expect(await page.locator("#preserved").getAttribute("inert")).not.toBeNull(); expect(await page.locator("#preserved").getAttribute("aria-hidden")).toBe("true");
};
async function pixel(page: Page, x: number, y: number) {
  const bytes = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0); bitmap.close();
    return [...context.getImageData(0, 0, 1, 1).data];
  }, [...bytes]);
}

async function expectAlignedSpotlight(page: Page, targetName: string) {
  await expect.poll(() => page.evaluate(name => {
    const target = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    const mask = document.querySelector<SVGRectElement>('[data-keryx-tour-portal] mask rect[fill="black"]');
    if (!target || !mask) return false;
    const bounds = target.getBoundingClientRect();
    const left = Math.max(4, bounds.left), right = Math.min(innerWidth - 4, bounds.right);
    const top = Math.max(4, bounds.top), bottom = Math.min(innerHeight - 4, bounds.bottom);
    const x = Number(mask.getAttribute("x")), y = Number(mask.getAttribute("y"));
    const width = Number(mask.getAttribute("width")), height = Number(mask.getAttribute("height"));
    return left < right && top < bottom && x <= left + 1 && y <= top + 1 && x + width >= right - 1 && y + height >= bottom - 1;
  }, targetName)).toBe(true);
}

it.each([320, 1366])("realigns the complete guide cutout after late target text wrapping at %ipx", async width => {
  await fixture(async page => {
    const dialog = await open(page);
    for (let index = 0; index < 3; index++) {
      await dialog.getByRole("button", { name: "Next", exact: true }).click();
      await dialog.getByText(`Step ${index + 2} of 4`, { exact: true }).waitFor();
    }
    await expectAlignedSpotlight(page, "dispatch-btn");
    const target = page.locator('[data-tour="dispatch-btn"]');
    const before = await target.boundingBox(); expect(before).toBeTruthy();
    await target.evaluate(element => { element.style.width = "160px"; element.style.fontSize = "32px"; });
    await expect.poll(async () => (await target.boundingBox())!.height > before!.height + 40).toBe(true);
    await expectAlignedSpotlight(page, "dispatch-btn");
    const after = (await target.boundingBox())!;
    expect((await pixel(page, after.x + 16, after.y + after.height - 16)).slice(0, 3)).toEqual([225, 215, 192]);
    await page.keyboard.press("Escape"); await restored(page);
    expect(await page.getByLabel("Retained question").inputValue()).toBe("An intact user question");
    expect(await page.getByLabel("Retained budget").inputValue()).toBe("0.04");
  }, width);
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "shows the real guide target with native keyboard reading at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const dialog = await open(page);
      if (screenshots) await page.screenshot({ path: join(screenshots, `guide-${width}-${motion}.png`) });
      const reader = dialog.getByRole("region", { name: "Research with a budget", exact: true });
      expect(await reader.count()).toBe(1); expect(await reader.getAttribute("tabindex")).toBe("0");
      const close = dialog.getByRole("button", { name: "Close tour", exact: true });
      expect(await close.evaluate(element => document.activeElement === element)).toBe(true);
      await page.keyboard.press("Tab"); expect(await reader.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await reader.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("Tab"); expect(await dialog.getByRole("button", { name: "Next", exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
      await page.keyboard.press("Tab"); expect(await close.evaluate(element => document.activeElement === element)).toBe(true);
      await page.keyboard.press("Shift+Tab"); expect(await dialog.getByRole("button", { name: "Next", exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
      expect(await page.locator("#root").getAttribute("inert")).not.toBeNull();
      const targets = await dialog.locator("button").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(targets.every(height => height >= 44)).toBe(true);
      const bounds = await dialog.boundingBox(); expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 800).toBe(true);
      await expect.poll(() => page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').count()).toBe(1);
      const target = await page.locator('[data-tour="hero"]').boundingBox(); expect(target).toBeTruthy();
      const lit = await pixel(page, target!.x + target!.width - 16, target!.y + 16), dim = await pixel(page, 1, 1);
      expect(lit.slice(0, 3)).toEqual([225, 215, 192]); expect(dim[0]).toBeLessThan(140);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (motion === "reduce") expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
      await page.keyboard.press("Escape"); await restored(page);
      expect(await page.getByRole("button", { name: "How it works", exact: true }).evaluate(element => document.activeElement === element)).toBe(true);
    }, width, 800, motion);
  });

it("keeps desktop guide actions fixed as the highlighted target changes", async () => {
  await fixture(async page => {
    const dialog = await open(page), action = dialog.locator("footer button").last();
    const original = await action.boundingBox(); expect(original).toBeTruthy();
    for (const title of ["Ask a question", "Choose a spending cap", "Start research"]) {
      await action.click();
      await dialog.getByRole("region", { name: title, exact: true }).waitFor();
      await expect.poll(async () => {
        const current = await action.boundingBox();
        return !!current && Math.abs(current.x - original!.x) < 1 && Math.abs(current.y - original!.y) < 1;
      }).toBe(true);
    }
    await page.keyboard.press("Escape"); await restored(page);
  }, 1366);
});

it("uses current guide copy, completes four steps, and blocks dispatch through the spotlight", async () => {
  await fixture(async page => {
    await change(page, "context", true);
    const dialog = await open(page);
    await dialog.getByRole("region", { name: "[preview] Research with a budget", exact: true }).waitFor();
    expect(await dialog.getByRole("button", { name: "Back", exact: true }).isDisabled()).toBe(true);
    for (const title of ["[preview] Ask a question", "[preview] Choose a spending cap", "[preview] Start research"]) {
      await dialog.getByRole("button", { name: "Next", exact: true }).click();
      await dialog.getByRole("region", { name: title, exact: true }).waitFor();
    }
    expect(await page.evaluate(() => (window as unknown as { guideFixture: GuideFixture }).guideFixture.budgetEvents)).toBe(1);
    await dialog.getByText("Step 4 of 4", { exact: true }).waitFor();
    await change(page, "context", false); await dialog.getByRole("region", { name: "Start research", exact: true }).waitFor();
    const action = page.locator('[data-tour="dispatch-btn"]');
    await expect.poll(async () => {
      const first = await action.boundingBox();
      await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(resolve)));
      const second = await action.boundingBox();
      return !!first && !!second && first.y === second.y && second.y >= 0 && second.y + second.height <= 800;
    }).toBe(true);
    const bounds = await action.boundingBox(); if (!bounds) throw Error("Fixture dispatch target missing");
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await restored(page);
    expect(await page.getByLabel("Retained question").inputValue()).toBe("An intact user question");
    expect(await page.getByLabel("Retained budget").inputValue()).toBe("0.04");
    const complete = await open(page);
    for (let index = 0; index < 3; index++) {
      await complete.getByRole("button", { name: "Next", exact: true }).click();
      await complete.getByText(`Step ${index + 2} of 4`, { exact: true }).waitFor();
    }
    await complete.getByRole("button", { name: "Done", exact: true }).click(); await restored(page);
    expect(await page.evaluate(() => (window as unknown as { guideFixture: GuideFixture }).guideFixture.budgetEvents)).toBe(2);
    const again = await open(page); await again.getByRole("button", { name: "Next", exact: true }).click();
    await again.getByRole("button", { name: "Back", exact: true }).click(); await again.getByText("Step 1 of 4", { exact: true }).waitFor();
    await change(page, "mount", false); await restored(page);
    await page.getByLabel("Retained question").focus(); expect(await page.getByLabel("Retained question").evaluate(element => document.activeElement === element)).toBe(true);
  }, 1366);
});

it.each([{ width: 390, height: 420, font: 24 }, { width: 320, height: 568, font: 32 }])(
  "keeps long guide copy keyboard scrollable at $width/$height with $font px base text", async ({ width, height, font }) => {
    await fixture(async page => {
      await change(page, "long", true); await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
      const dialog = await open(page), reader = dialog.getByRole("region", { name: "Research with a budget", exact: true });
      await reader.focus(); const before = await reader.evaluate(element => element.scrollTop);
      expect(await reader.evaluate(element => element.clientHeight > 44 && element.scrollHeight > element.clientHeight)).toBe(true);
      await page.keyboard.press("PageDown"); await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
      const bounds = await dialog.boundingBox(); expect(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height).toBe(true);
      const buttons = await dialog.locator("button").evaluateAll(elements => elements.map(element => { const bounds = element.getBoundingClientRect(); return { y: bounds.y, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: bounds.height }; }));
      if (screenshots) await page.screenshot({ path: join(screenshots, `guide-long-${width}-${height}-${font}.png`) });
      expect(buttons.every(bounds => bounds.y >= 0 && bounds.bottom <= height && bounds.left >= 0 && bounds.right <= width && bounds.height >= 44)).toBe(true);
      await page.keyboard.press("Escape"); await restored(page);
    }, width, height);
  });

it("does not invent a spotlight for a missing target and observes live motion preference changes", async () => {
  await fixture(async page => {
    await page.locator('[data-tour="hero"]').evaluate(element => element.removeAttribute("data-tour"));
    const dialog = await open(page);
    expect(await page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').count()).toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("region", { name: "Ask a question", exact: true }).waitFor();
    await expect.poll(() => page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').count()).toBe(1);
    // Shared reduced-motion rules use 0.01ms transitions, which finish on the browser's next frame.
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
    await page.keyboard.press("Escape"); await restored(page);
  }, 768, 800, "no-preference");
});

it("tracks a resized target and viewport, then removes its cutout when the target disappears", async () => {
  await fixture(async page => {
    const dialog = await open(page), target = page.locator('[data-tour="hero"]');
    await target.evaluate(element => { element.style.height = "280px"; });
    await expect.poll(() => page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').evaluate(element => Number(element.getAttribute("height")))).toBe(296);
    await page.setViewportSize({ width: 390, height: 600 });
    await expect.poll(() => dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect(); return bounds.x === 0 && bounds.right === 390 && bounds.bottom <= 600;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await target.evaluate(element => element.remove());
    await expect.poll(() => page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').count()).toBe(0);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("region", { name: "Ask a question", exact: true }).waitFor();
    await expect.poll(() => page.locator('[data-keryx-tour-portal] mask rect[fill="black"]').count()).toBe(1);
    await page.keyboard.press("Escape"); await restored(page);
  }, 1366);
});
