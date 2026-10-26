import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, type Browser, type Page } from "playwright";
import type { QueryRun } from "../types";

let browser: Browser, css: string, bundle: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const claims = ["Stored export behavior", "Recorded audit behavior", "Retention terms", "Unrecorded target"];
const citations: QueryRun["citations"] = ["A", "B", "C", "D"].map((sourceId, index) => ({ sourceId, marker: "S" + (index + 1), sourceName: "Source " + sourceId,
  itemId: sourceId + "-article", itemTitle: "Original article " + sourceId, itemUrl: "https://publisher.test/" + sourceId, contentVersion: "recorded-v1", weight: .25, reward: 0, rationale: "Fixture",
  ...(sourceId === "D" ? { evidenceProvenance: "synthetic-demo" as const } : {}) }));
const excerpt = (sourceIndex: number, claimIndex: number, quote: string) => ({ ...citations[sourceIndex], claimIndex, claim: claims[claimIndex], quote, support: .8, qualifiesForAnswer: true, qualifiesForReward: false });
const run: QueryRun = { id: "lens-alpha", question: "A local source-inspection fixture", answer: "Original report bytes. [S1]", budget: .01,
  citations, subClaims: claims, decisions: [], trace: [], engine: "fixture", createdAt: "2026-10-01T00:00:00Z", totalSpent: .000001, totalToCreators: .000001, paymentMode: "offline", pendingPayments: 1,
  evidence: [excerpt(0, 0, "Alpha exact excerpt.  \n\n"), excerpt(1, 0, "Beta retained excerpt."), excerpt(0, 1, "Alpha audit excerpt."), excerpt(2, 2, "Gamma retained excerpt."), excerpt(3, 3, "Illustrative material is excluded from this inspection."), { ...excerpt(0, 0, "WRONG_VERSION_MUST_STAY_OUT"), contentVersion: "wrong-version" }] };
type Fixture = { report(index: number): void; mode(value: "normal" | "unavailable" | "empty" | "demo"): void; quote(value: string): void;
  locale(value: "vi" | "zh-Hans"): void; longNames(value: boolean): void; unchanged(): boolean };
const fonts = `@font-face{font-family:LensDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:LensSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:LensMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:LensDisplay;--font-spectral:LensSerif;--font-spline-mono:LensMono}`;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AnswerCard}from'./components/keryx/answer-card';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const original=${JSON.stringify(run)},before=JSON.stringify(original);const fixture=window.lensFixture={unchanged:()=>JSON.stringify(original)===before};
    function App(){const[index,setIndex]=useState(0),[mode,setMode]=useState('normal'),[quote,setQuote]=useState(null),[locale,setLocale]=useState('en'),[longNames,setLongNames]=useState(false);Object.assign(fixture,{report:setIndex,mode:setMode,quote:setQuote,locale:setLocale,longNames:setLongNames});
      const value={...original,id:index?'lens-beta':original.id,answer:index?'Second report bytes. [S1]':original.answer,
        ...(mode==='unavailable'?{evidence:undefined}:mode==='empty'?{evidence:[]}:mode==='demo'?{citations:[original.citations[3]],evidence:[original.evidence[4]]}:{}),
        ...(quote!==null?{evidence:original.evidence.map((item,index)=>index===0?{...item,quote}:item)}:{}),
        ...(longNames?{citations:original.citations.map(item=>({...item,sourceName:item.sourceId==='A'?'OriginalSourceIdentifier'.repeat(15):item.sourceName})),evidence:original.evidence.map(item=>({...item,sourceName:item.sourceId==='A'?'OriginalSourceIdentifier'.repeat(15):item.sourceName}))}:{})};
      const preview=locale==='vi'?vi:locale==='zh-Hans'?zh:{},ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}><AnswerCard run={value} meta={null} showFeedback={false}/></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  for (const path of ["components/keryx/source-evidence-lens.tsx", "lib/research/source-evidence-lens.ts", "components/keryx/answer-card.tsx"])
    expect(inputs.some(input => input.endsWith(path))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  const engine = process.env.KERYX_UX_BROWSER === "webkit" ? webkit : chromium;
  browser = await engine.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });
const lens = (page: Page) => page.getByRole("combobox").locator("xpath=ancestor::details[1]");
const select = (page: Page) => page.getByRole("combobox");
async function fixture(test: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion }); const errors: string[] = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://source-lens.test") { unexpected.push(request.url()); return route.abort(); }
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" style="max-width:1080px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://source-lens.test/"); await page.addScriptTag({ content: bundle });
    await page.getByText("What if a source were missing?", { exact: true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    await page.getByText("What if a source were missing?", { exact: true }).click(); await select(page).waitFor();
    await test(page); expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { lensFixture: Fixture }).lensFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}

it("keeps native actions at44px with compact text", async () => {
  await fixture(async page => {
    await page.evaluate(() => { document.documentElement.style.fontSize = "12px"; }); await select(page).selectOption("A");
    const controls = await lens(page).locator("button,select,summary").evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => ({ text: node.textContent, height: (node as HTMLElement).offsetHeight })));
    expect(controls.filter(node => node.height < 44)).toEqual([]);
  }, 320);
});

it("compares original and remaining excerpts without changing the report, confidence or payment display", async () => {
  await fixture(async page => {
    const root = lens(page), rows = root.getByRole("list", { name: "What if a source were missing?", exact: true }).locator(":scope > li");
    const summary = page.getByRole("region", { name: "Report summary", exact: true }), recorded = await summary.textContent();
    const answer = await page.getByText("Original report bytes.", { exact: false }).first().textContent();
    expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "2"]);
    await rows.first().getByText("Inspect remaining excerpts", { exact: true }).click();
    expect(await rows.first().locator("blockquote").count()).toBe(2);
    await select(page).focus(); await select(page).selectOption("A");
    await expect.poll(() => root.getByRole("status").textContent()).toContain("1 research target loses its last recorded excerpt without Source A.");
    expect(await select(page).evaluate(node => document.activeElement === node)).toBe(true);
    expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "1"]);
    expect(await rows.nth(1).locator("dd").allTextContents()).toEqual(["1", "0"]);
    expect(await rows.nth(3).locator("dd").allTextContents()).toEqual(["0", "0"]);
    await rows.nth(1).getByText("No excerpts remain in this view.", { exact: true }).waitFor();
    await rows.nth(3).getByText("No inspectable excerpts in the original report.", { exact: true }).waitFor();
    expect(await rows.first().locator("details").getAttribute("open")).not.toBeNull();
    expect(await rows.first().locator("blockquote").count()).toBe(1);
    await rows.first().getByText("Beta retained excerpt.", { exact: false }).waitFor();
    expect(await root.getByText("WRONG_VERSION_MUST_STAY_OUT", { exact: false }).count()).toBe(0);
    expect(await root.getByRole("option", { name: "Source D", exact: true }).count()).toBe(0);
    expect(await summary.textContent()).toBe(recorded);
    expect(await page.getByText("Original report bytes.", { exact: false }).first().textContent()).toBe(answer);
    await root.getByRole("button", { name: "Restore source", exact: true }).click();
    await expect.poll(() => select(page).inputValue()).toBe("");
    expect(await select(page).evaluate(node => document.activeElement === node)).toBe(true);
    expect(await rows.first().locator("dd").allTextContents()).toEqual(["2", "2"]);
    expect(await rows.first().locator("blockquote").count()).toBe(2);
  });
});

it("keeps report identity and missing/demo ledger boundaries intact", async () => {
  await fixture(async page => {
    await select(page).selectOption("A");
    await page.evaluate(() => (window as unknown as { lensFixture: Fixture }).lensFixture.report(1));
    await page.getByText("Second report bytes.", { exact: false }).first().waitFor();
    await page.getByText("What if a source were missing?", { exact: true }).click();
    expect(await select(page).inputValue()).toBe("");
    for (const mode of ["unavailable", "empty", "demo"] as const) {
      await page.evaluate(value => (window as unknown as { lensFixture: Fixture }).lensFixture.mode(value), mode);
      await page.getByText(mode === "unavailable" ? "Source inspection unavailable: this report has no stored excerpt ledger." : "No inspectable non-demo excerpts are recorded for source inspection.", { exact: true }).waitFor();
      expect(await page.getByRole("combobox").count()).toBe(0);
    }
    await page.evaluate(() => (window as unknown as { lensFixture: Fixture }).lensFixture.mode("normal"));
    await page.getByText("What if a source were missing?", { exact: true }).click(); expect(await select(page).inputValue()).toBe("");
  });
});

it("retains literal long quotes and source whitespace in the remaining-excerpt inspector", async () => {
  await fixture(async page => {
    const root = lens(page), first = root.getByRole("list", { name: "What if a source were missing?", exact: true }).locator(":scope > li").first();
    await first.getByText("Inspect remaining excerpts", { exact: true }).click();
    for (const original of ["The reference is https://example.invalid/" + "x".repeat(190) + ".", 'Exact retained line.\n    "aaa","b""bb","ccc"\n\n    Literal <img data-lens-injection> text.  \n\n']) {
      await page.evaluate(value => (window as unknown as { lensFixture: Fixture }).lensFixture.quote(value), original);
      const quote = first.locator("blockquote > p").first();
      await expect.poll(() => quote.textContent()).toBe("“" + original + "”");
      expect(await quote.innerText()).toBe("“" + original + "”");
      expect(await quote.evaluate(node => node.clientWidth > 0 && node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.locator("[data-lens-injection]").count()).toBe(0);
    }
  }, 320);
});

it.each(["vi", "zh-Hans"] as const)("fits the actual %s preview with enlarged text and original excerpt data", async locale => {
  await fixture(async page => {
    await page.evaluate(value => { document.documentElement.style.fontSize = "24px"; (window as unknown as { lensFixture: Fixture }).lensFixture.locale(value); }, locale);
    await select(page).selectOption("A");
    const root = lens(page), first = root.locator(":scope > ol > li").first();
    await first.getByText("Stored export behavior", { exact: true }).waitFor();
    expect(await first.locator("dd").allTextContents()).toEqual(["2", "1"]);
    await root.getByText("Targets are requested topics, not verified assertions.", { exact: false }).waitFor();
    await first.locator("details > summary").click(); await first.getByText("Beta retained excerpt.", { exact: false }).waitFor();
    expect(await root.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (screenshots) await root.screenshot({ path: join(screenshots, `source-lens-${locale}-320-large.png`) });
  }, 320);
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "keeps source comparison readable with native focus at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const root = lens(page); await select(page).focus(); await select(page).selectOption("A");
      const rows = root.getByRole("list", { name: "What if a source were missing?", exact: true }).locator(":scope > li");
      const badge = rows.nth(1).locator("header > p"); await badge.getByText("No excerpts remain in this view.", { exact: true }).waitFor();
      expect(await badge.evaluate(node => getComputedStyle(node).animationName)).toBe(motion === "reduce" ? "none" : "kxSourceArrive");
      await page.emulateMedia({ reducedMotion: "reduce" }); await expect.poll(() => badge.evaluate(node => getComputedStyle(node).animationName)).toBe("none");
      expect(await select(page).evaluate(node => document.activeElement === node)).toBe(true);
      const controls = await root.locator("button,select,summary").evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => { const r = node.getBoundingClientRect(); return { height: (node as HTMLElement).offsetHeight, left: r.left, right: r.right }; }));
      expect(controls.filter(r => r.height < 44 || r.left < 0 || r.right > width)).toEqual([]);
      expect(await root.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const positions = await rows.evaluateAll(nodes => { const [a,b] = nodes.map(node => node.getBoundingClientRect()); return b.x >= a.right && b.y === a.y; });
      expect(positions).toBe(await root.evaluate(node => node.clientWidth >= 44 * parseFloat(getComputedStyle(document.documentElement).fontSize)));
      const counts = await rows.first().locator("dd").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
      expect(Math.abs(counts[0] - counts[1]) < 1).toBe(await root.evaluate(node => node.clientWidth >= 18 * parseFloat(getComputedStyle(document.documentElement).fontSize)));
      if (screenshots) await root.screenshot({ path: join(screenshots, `source-lens-${width}-${motion}.png`) });
      await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; (window as unknown as { lensFixture: Fixture }).lensFixture.longNames(true); });
      await expect.poll(() => root.getByRole("status").textContent()).toContain("OriginalSourceIdentifier");
      expect(await root.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }, width, motion);
  });
