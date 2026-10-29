import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { loadUiPreview } from "../i18n/ui-preview-catalogues";
import { createMessages } from "../i18n/messages";
import type { UiLocale } from "../i18n/locales";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const nativeScreenshots = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR ?? screenshots;
const fonts = `@font-face{font-family:Display;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:Serif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:Mono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:Display;--font-spectral:Serif;--font-spline-mono:Mono}`;
type Fixture = { append(count: number): void; streaming(value: boolean): void; locale(value: Exclude<UiLocale, "en">): void; longText(): void; empty(): void; unchanged(): boolean };

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ReasoningConsole}from'./components/keryx/reasoning-console';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    import es from'./locales/generated/es-ui-preview';import pt from'./locales/generated/pt-BR-ui-preview';import fr from'./locales/generated/fr-ui-preview';import de from'./locales/generated/de-ui-preview';import ja from'./locales/generated/ja-ui-preview';import ko from'./locales/generated/ko-ui-preview';import hi from'./locales/generated/hi-ui-preview';import id from'./locales/generated/id-ui-preview';
    const previews={vi,'zh-Hans':zh,es,'pt-BR':pt,fr,de,ja,ko,hi,id};
    const seed=Array.from({length:30},(_,i)=>({phase:i%2?'discover':'decompose',message:'Recorded step '+i+' — a retained local fixture message.',ts:i}));
    seed[2]={phase:'decide',ts:2,message:'Recorded decision',detail:{sourceId:'source',sourceName:'Recorded publisher',action:'BUY',price:.002,expectedValue:.8,confidence:.7,rationale:'Original recorded rationale.',targets:[0]}};
    for(const[i,status,amount,conflict]of[[3,'settled',.000001,false],[4,'pending',.000002,false],[5,'simulated',.000008,false],[6,'pending',.000003,true],[7,'failed',.000004,false]])seed[i]={phase:'fetch',ts:i,message:'Recorded '+status+' payment detail.',detail:{kind:'fetch',queryId:'fixture',sourceId:'source',sourceName:'Recorded publisher',itemId:'fixture-item',payer:'fictional-payer',payee:'fictional-payee',amountUsdc:amount,network:'Arc',settled:conflict||status==='settled',settlementStatus:status,createdAt:'2026-10-26T00:00:00Z'}};
    const original=JSON.stringify(seed),fixture=window.ledgerFixture={unchanged:()=>JSON.stringify(seed)===original};
    function App(){const[steps,setSteps]=useState(seed),[streaming,setStreaming]=useState(true),[locale,setLocale]=useState('en');Object.assign(fixture,{append:count=>setSteps(previous=>[...previous,...Array.from({length:count},(_,i)=>({phase:'discover',message:'Appended step '+(previous.length+i),ts:previous.length+i}))]),streaming:setStreaming,locale:setLocale,empty:()=>setSteps([]),longText:()=>setSteps(previous=>previous.map((s,i)=>i===0?{...s,message:'https://example.invalid/'+ 'q'.repeat(320)+' literal <img data-trace-injection> text.  \\n\\n'}:s))});
      const preview=previews[locale]??{},ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}><ReasoningConsole steps={steps} streaming={streaming} budget={.01}/></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(p => p.replaceAll("\\", "/"));
  expect(inputs.some(p => p.endsWith("components/keryx/reasoning-console.tsx"))).toBe(true);
  expect(inputs.some(p => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(p))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css + fonts;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  if (nativeScreenshots && nativeScreenshots !== screenshots) await mkdir(nativeScreenshots, { recursive: true });
  browser = await (process.env.KERYX_UX_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion }), errors: string[] = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://ledger.test") { unexpected.push(request.url()); return route.abort(); }
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main style="max-width:900px;margin:32px auto;padding:0 16px"><div id="root"></div></main><div style="height:800px"></div></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    await page.goto("https://ledger.test/"); await page.addScriptTag({ content: bundle }); await page.getByLabel("Decision log", { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    await test(page); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}

it("exposes a native keyboard scroll region and44px recovery control", async () => {
  await fixture(async page => {
    const log = page.getByRole("region", { name: "Decision log", exact: true });
    await log.focus(); await expect.poll(() => log.evaluate(n => n.scrollHeight - n.scrollTop - n.clientHeight)).toBeLessThan(2);
    await page.keyboard.press("Home"); await expect.poll(() => log.evaluate(n => n.scrollTop)).toBe(0);
    const jump = page.getByRole("button", { name: "Jump to latest", exact: true }); await jump.waitFor();
    expect(await jump.evaluate(n => (n as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    const documentY = await page.evaluate(() => scrollY); await jump.click();
    expect(await log.evaluate(n => document.activeElement === n)).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBe(documentY);
  });
});

const logRegion = (page: Page) => page.getByRole("region");
const append = (page: Page, count: number) => page.evaluate(value => (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.append(value), count);
const bottomGap = (page: Page) => logRegion(page).evaluate(n => n.scrollHeight - n.scrollTop - n.clientHeight);

it("counts only steps arriving while reading earlier and keeps the reading position on append or stop", async () => {
  await fixture(async page => {
    const log = logRegion(page), first = await log.getByRole("listitem").first().elementHandle();
    await log.evaluate(n => { n.scrollTop = 120; }); await page.getByText("Reading earlier steps", { exact: true }).waitFor();
    const position = await log.evaluate(n => n.scrollTop);
    await append(page, 1); await page.getByRole("status").getByText("1 new step", { exact: true }).waitFor();
    await append(page, 2); await page.getByRole("status").getByText("3 new steps", { exact: true }).waitFor();
    expect(await log.evaluate(n => n.scrollTop)).toBe(position);
    expect(await first!.evaluate(n => n.isConnected)).toBe(true);
    await page.evaluate(() => (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.streaming(false));
    expect(await log.evaluate(n => n.scrollTop)).toBe(position);
    await log.focus(); await page.keyboard.press("End"); await page.getByText("Following latest steps", { exact: true }).waitFor();
    await expect.poll(() => bottomGap(page)).toBeLessThan(2);
    expect(await page.getByRole("status").textContent()).toBe("");
  });
});

it("retains the original decision and distinct settled/pending/simulated/conflicting amounts", async () => {
  await fixture(async page => {
    for (const value of ["$0.000001 settled", "$0.000002 confirmation pending", "$0.000008 offline simulated", "$0.000003 conflicting payment state", "Original recorded rationale.", "Recorded publisher", "BUY", "$0.002 · EV 80%"])
      await page.getByText(value, { exact: value === "BUY" }).waitFor();
    const content = await page.locator("#root").textContent();
    await logRegion(page).evaluate(n => { n.scrollTop = 0; }); await page.getByText("Reading earlier steps", { exact: true }).waitFor(); await append(page, 2);
    for (const value of ["$0.000001 settled", "$0.000002 confirmation pending", "$0.000008 offline simulated", "$0.000003 conflicting payment state", "Original recorded rationale."])
      expect(await page.locator("#root").textContent()).toContain(value);
    expect(content).not.toContain("$0.000004 settled");
    expect(await logRegion(page).getByRole("listitem").count()).toBe(32);
  });
});

it("keeps empty connection and historical rows honest without entrance motion", async () => {
  await fixture(async page => {
    await page.evaluate(() => (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.streaming(false));
    expect(await logRegion(page).getByRole("listitem").evaluateAll(nodes => nodes.map(n => getComputedStyle(n).animationName))).toEqual(Array(30).fill("none"));
    await page.evaluate(() => { const f=(window as unknown as { ledgerFixture: Fixture }).ledgerFixture; f.empty(); f.streaming(true); });
    await page.getByText("Waiting for research updates…", { exact: true }).waitFor();
    expect(await logRegion(page).getByRole("listitem").count()).toBe(0);
    expect(await page.getByRole("button", { name: "Jump to latest", exact: true }).count()).toBe(0);
  }, 390, "no-preference");
});

it.each(["vi", "zh-Hans"] as const)("fits the actual %s preview with enlarged text and unchanged recorded messages", async locale => {
  await fixture(async page => {
    await page.evaluate(value => { document.documentElement.style.fontSize="24px"; (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.locale(value); }, locale);
    await expect.poll(() => bottomGap(page)).toBeLessThan(2);
    const log=logRegion(page); await log.evaluate(n => { n.scrollTop=0; }); await page.getByRole("button").waitFor(); await append(page, 2);
    expect(await log.getByText("Original recorded rationale.", { exact: true }).textContent()).toBe("Original recorded rationale.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.getByRole("button").evaluate(n => (n as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    if(screenshots) await page.locator("#root").screenshot({path:join(screenshots,`decision-ledger-${locale}-320-large.png`)});
  }, 320);
});

it.each((["es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id"] as const).flatMap(locale =>
  [320, 1366].map(width => ({ locale, width }))))("keeps native $locale log reading controls, English payment evidence and originals at $width", async ({ locale, width }) => {
  const preview = await loadUiPreview(locale), message = createMessages(locale, preview.$messages);
  await fixture(async page => {
    await page.evaluate(value => { document.documentElement.lang = value; (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.locale(value); }, locale);
    const log = page.getByRole("region", { name: message("decisionLog.label"), exact: true });
    await log.waitFor(); await expect.poll(() => log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    expect(await page.locator('[id$="-hint"] [lang]').getAttribute("lang")).toBe(locale);
    expect(await page.locator('[id$="-hint"]').textContent()).toBe(message("decisionLog.scrollHint"));
    expect(await page.locator('[id$="-mode"] [lang]').textContent()).toBe(message("decisionLog.followingLatest"));
    await log.focus(); await page.keyboard.press("Home");
    const jump = page.getByRole("button", { name: message("decisionLog.jumpToLatest"), exact: true }); await jump.waitFor();
    expect(await jump.locator(`[lang="${locale}"]`).count()).toBe(1);
    expect(await page.locator('[id$="-mode"] [lang]').textContent()).toBe(message("decisionLog.readingEarlier"));
    await append(page, 1);
    expect(await page.getByRole("status").locator(`[lang="${locale}"]`).textContent()).toBe(message("decisionLog.newSteps.one", { count: 1 }));
    await append(page, 1);
    expect(await page.getByRole("status").locator(`[lang="${locale}"]`).textContent()).toBe(message("decisionLog.newSteps.other", { count: 2 }));
    for (const text of ["$0.000001 settled", "$0.000002 confirmation pending", "$0.000008 offline simulated", "$0.000003 conflicting payment state"])
      expect(await page.locator('[lang="en"]').filter({ hasText: text }).count()).toBeGreaterThan(0);
    expect(await log.getByText("Original recorded rationale.", { exact: true }).textContent()).toBe("Original recorded rationale.");
    expect(await log.getByText("Recorded publisher", { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await log.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await jump.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    if (nativeScreenshots) await page.locator("#root").screenshot({ path: join(nativeScreenshots, `decision-ledger-native-${locale}-${width}.png`) });
    await jump.click();
    await expect.poll(() => log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
    expect(await log.evaluate(element => document.activeElement === element)).toBe(true);
    await page.evaluate(() => { const fixture = (window as unknown as { ledgerFixture: Fixture }).ledgerFixture; fixture.empty(); fixture.streaming(true); });
    await page.getByText(message("decisionLog.connecting"), { exact: true }).waitFor();
    expect(await log.getByRole("listitem").count()).toBe(0);
  }, width);
});

it.each([320,390,768,1366].flatMap(width => (["reduce","no-preference"] as const).map(motion => ({width,motion}))))(
  "follows only the tail with finite live motion at $width/$motion", async ({width,motion}) => {
    await fixture(async page => {
      const log=logRegion(page); await append(page, 1); await log.getByText("Appended step 30",{exact:true}).waitFor(); await expect.poll(() => bottomGap(page)).toBeLessThan(2);
      const latest=log.getByRole("listitem").last(), previous=log.getByRole("listitem").nth(29);
      expect(await latest.evaluate(n => getComputedStyle(n).animationName)).toBe(motion === "reduce" ? "none" : "kxUp");
      expect(await previous.evaluate(n => getComputedStyle(n).animationName)).toBe("none");
      if(motion === "no-preference") expect(await latest.evaluate(n => getComputedStyle(n).animationIterationCount)).toBe("1");
      await page.emulateMedia({reducedMotion:"reduce"}); await expect.poll(() => latest.evaluate(n => getComputedStyle(n).animationName)).toBe("none");
      await log.focus(); await page.keyboard.press("Home"); await page.getByText("Reading earlier steps",{exact:true}).waitFor(); await append(page,1);
      expect(await log.getByRole("listitem").last().evaluate(n => getComputedStyle(n).animationName)).toBe("none");
      await page.evaluate(() => { document.documentElement.style.fontSize="24px"; (window as unknown as { ledgerFixture: Fixture }).ledgerFixture.longText(); });
      expect(await log.getByText("https://example.invalid/",{exact:false}).textContent()).toContain("q".repeat(320));
      expect(await page.locator("[data-trace-injection]").count()).toBe(0);
      expect(await log.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.getByRole("button",{name:"Jump to latest",exact:true}).evaluate(n => (n as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
      if(screenshots) await page.locator("#root").screenshot({path:join(screenshots,`decision-ledger-${width}-${motion}.png`)});
    },width,motion);
  });
