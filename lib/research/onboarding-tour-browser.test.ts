import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import { signedOutResearchAuthFixture, assertSignedOutBrowserFixtureGraph } from "../../test-support/research-browser-auth-fixture";

let browser: Browser, bundle: string, researchBundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
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
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

it.each([390, 1366])("bounds the first spotlight to the actual research introduction at %i", async width => {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
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
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/guide.css"></head><body><main id="root"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://guide.test/"); await page.addScriptTag({ content: researchBundle });
    await page.getByRole("button", { name: "How it works", exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    await open(page);
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector('[data-research-intro] > header')?.getBoundingClientRect();
      const mask = document.querySelector('[data-keryx-tour-portal] mask rect[fill="black"]');
      return !!header && !!mask && Number(mask.getAttribute("height")) <= header.height + 16 && Number(mask.getAttribute("height")) > 100;
    })).toBe(true);
    if (screenshots) await page.screenshot({ path: join(screenshots, "guide-research-introduction-" + width + ".png"), fullPage: true });
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
