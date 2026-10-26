import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import type { QueryRun } from "../types";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const originalLink = "https://keryx.test/dispatch/report%2Falpha?original=a%2Bb&language=vi#record";
const run: QueryRun = { id: "summary-alpha", question: "Recorded research fixture", answer: "The recorded answer remains unchanged.",
  budget: .01, citations: [], subClaims: [], decisions: [], trace: [], engine: "fixture", createdAt: "2026-10-01T00:00:00Z",
  totalSpent: .000001, totalToCreators: .000001, paymentMode: "offline", pendingPayments: 1 };
const observed: QueryRun = { ...run, id: "summary-beta", totalSpent: 0, totalToCreators: 0, pendingPayments: 0,
  decisions: ["public", "cache", "unavailable", "public-missing", "cache-missing"].map(sourceId => ({ sourceId, sourceName: sourceId,
    action: "CACHE", expectedValue: .5, price: 0, confidence: .5, rationale: "Recorded fixture", targets: [],
    ...(sourceId.startsWith("public") ? { sourceKind: "public-reference" as const } : {}) })),
  trace: ["public", "cache", "unavailable"].map(assetId => ({ phase: "fetch", message: "Recorded fixture", ts: 1,
    detail: { sourceRead: { protocol: "keryx-source-read-v1", assetId, kind: assetId === "public" ? "public" : "cache", status: assetId === "unavailable" ? "failed" : "succeeded" } } })) };
type Fixture = { mode(value: "defer" | "throw" | "missing"): void; settle(index: number, success: boolean): void;
  link(value: string | undefined): void; report(index: number): void; mount(value: boolean): void;
  recorded(value: "real" | "offline" | "unknown" | "historical"): void; locale(value: "vi" | "zh-Hans"): void; writes: string[]; unchanged(): boolean };
const fonts = `@font-face{font-family:SummaryDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:SummarySerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:SummaryMono;src:url('/fonts/spline-sans-mono-latin.woff2')}
:root{--font-bodoni:SummaryDisplay;--font-spectral:SummarySerif;--font-spline-mono:SummaryMono}`;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{StrictMode,useState}from'react';import{createRoot}from'react-dom/client';import{AnswerCard}from'./components/keryx/answer-card';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';
    import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const originals=${JSON.stringify([run, observed])},before=JSON.stringify(originals),pending=[];let mode='defer';
    const fixture=window.summaryFixture={writes:[],unchanged:()=>JSON.stringify(originals)===before,
      mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,value:value==='missing'?undefined:{writeText(text){fixture.writes.push(text);if(mode==='throw')throw Error('PRIVATE_CLIPBOARD_DETAIL');return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}})},
      settle(index,success){const request=pending[index];if(!request)throw Error('No pending clipboard fixture');success?request.resolve():request.reject(Error('PRIVATE_PERMISSION_DETAIL'))}};
    fixture.mode('defer');
    function App(){const[index,setIndex]=useState(0),[link,setLink]=useState(${JSON.stringify(originalLink)}),[mounted,setMounted]=useState(true),[recorded,setRecorded]=useState('offline'),[locale,setLocale]=useState('en');
      Object.assign(fixture,{report:setIndex,link:setLink,mount:setMounted,recorded:setRecorded,locale:setLocale});
      const value={...originals[index],paymentMode:recorded==='unknown'||recorded==='historical'?undefined:recorded},preview=locale==='vi'?vi:locale==='zh-Hans'?zh:{};
      const ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}>{mounted?<AnswerCard run={value} meta={null} permalink={link} historicalNetwork={recorded==='historical'?'eip155:5042002':undefined} showFeedback={false}/>:<p>Unmounted fixture</p>}</UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  expect(inputs.some(path => path.endsWith("components/keryx/answer-card.tsx"))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
  const errors: string[] = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://report-summary.test") unexpected.push(request.method() + " " + request.url());
      if (url.pathname === "/reading.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") unexpected.push(url.pathname);
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/reading.css"></head><body><main id="root" style="max-width:1080px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://report-summary.test/"); await page.addScriptTag({ content: bundle });
    await page.getByRole("button", { name: /^(Share|Copy link)$/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await test(page);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}
const settle = (page: Page, index: number, success: boolean) => page.evaluate(({ index, success }) => (window as unknown as { summaryFixture: Fixture }).summaryFixture.settle(index, success), { index, success });
const writes = (page: Page) => page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.writes);

it("provides a usable mobile touch target for the report link", async () => {
  await fixture(async page => {
    const box = await page.getByRole("button", { name: /^(Share|Copy link)$/ }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44); expect(box?.width).toBeGreaterThanOrEqual(44);
  }, 320);
});

it("keeps clipboard outcomes truthful and allows manual selection and retry", async () => {
  await fixture(async page => {
    const summary = page.getByRole("region", { name: "Report summary", exact: true });
    const copy = summary.getByRole("button", { name: "Copy link", exact: true }), status = summary.getByRole("status");
    const link = summary.getByRole("textbox", { name: "Report link", exact: true });
    await copy.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => copy.getAttribute("aria-busy")).toBe("true");
    await page.keyboard.press("Enter");
    expect(await writes(page)).toEqual([originalLink]);
    expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
    await settle(page, 0, true);
    await expect.poll(() => status.textContent()).toBe("✓ Copied");
    expect(await copy.getAttribute("aria-busy")).toBe("false");
    for (const mode of ["defer", "throw", "missing"] as const) {
      await page.evaluate(value => (window as unknown as { summaryFixture: Fixture }).summaryFixture.mode(value), mode);
      await copy.click(); if (mode === "defer") await settle(page, 1, false);
      await expect.poll(() => status.textContent()).toBe("Copy unavailable. Select the link and copy it manually.");
      expect(await copy.getAttribute("aria-busy")).toBe("false");
      expect(await copy.getAttribute("aria-disabled")).toBe("false");
      expect(await copy.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await status.textContent()).not.toContain("PRIVATE");
    }
    await link.focus();
    expect(await link.evaluate(element => { const input = element as HTMLInputElement; return input.value.slice(input.selectionStart!, input.selectionEnd!); })).toBe(originalLink);
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.mode("defer"));
    await copy.click(); await settle(page, 2, true);
    await expect.poll(() => status.textContent()).toBe("✓ Copied");
    expect((await writes(page)).at(-1)).toBe(originalLink);
  });
});

it("isolates pending outcomes when the link, report or mounted identity changes", async () => {
  await fixture(async page => {
    const summary = page.getByRole("region", { name: "Report summary", exact: true });
    const copy = summary.getByRole("button", { name: "Copy link", exact: true }), status = summary.getByRole("status");
    await copy.click();
    const nextLink = "https://keryx.test/dispatch/second?literal=%2F%26";
    await page.evaluate(value => (window as unknown as { summaryFixture: Fixture }).summaryFixture.link(value), nextLink);
    await expect.poll(() => summary.getByRole("textbox").inputValue()).toBe(nextLink);
    expect(await copy.getAttribute("aria-busy")).toBe("false");
    await copy.click(); await settle(page, 0, false);
    expect(await copy.getAttribute("aria-busy")).toBe("true");
    await settle(page, 1, true); await expect.poll(() => status.textContent()).toBe("✓ Copied");
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.report(1));
    await expect.poll(() => status.textContent()).toBe("");
    await copy.click();
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.mount(false));
    await page.getByText("Unmounted fixture", { exact: true }).waitFor(); await settle(page, 2, true);
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.mount(true));
    await copy.waitFor(); expect(await status.textContent()).toBe("");
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.link(undefined));
    await copy.waitFor({ state: "detached" }); expect(await summary.getByRole("textbox").count()).toBe(0);
    expect(await writes(page)).toEqual([originalLink, nextLink, nextLink]);
  });
});

it("keeps recorded read outcomes separate from selections and absent payment proof", async () => {
  await fixture(async page => {
    await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.report(1));
    const summary = page.getByRole("region", { name: "Report summary", exact: true });
    await summary.getByText("$0", { exact: true }).waitFor();
    await summary.getByText("—", { exact: true }).waitFor();
    await summary.getByText("0 bought · 0 skipped", { exact: true }).waitFor();
    await summary.getByText("1 public read · 1 cache hit · 1 unavailable read · 1 public read selection (outcome not recorded) · 1 cache selection (outcome not recorded)", { exact: true }).waitFor();
    expect(await summary.getByText("Pending proof", { exact: true }).count()).toBe(0);
  });
});

it.each(["vi", "zh-Hans"] as const)("fits the actual %s preview at enlarged mobile text while keeping critical copy English", async locale => {
  await fixture(async page => {
    await page.evaluate(value => { document.documentElement.style.fontSize = "24px"; (window as unknown as { summaryFixture: Fixture }).summaryFixture.locale(value); }, locale);
    const summary = page.getByRole("region", { name: locale === "vi" ? "Tóm tắt báo cáo" : "报告摘要", exact: true });
    const copy = summary.getByRole("button", { name: locale === "vi" ? "Sao chép liên kết" : "复制链接", exact: true });
    await copy.waitFor();
    await summary.getByText("Simulated spend", { exact: true }).waitFor();
    const money = summary.getByText("$0.000001", { exact: true });
    expect(await money.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length; })).toBe(1);
    expect(await summary.getByRole("textbox").inputValue()).toBe(originalLink);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const box = await copy.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    if (screenshots) await summary.screenshot({ path: join(screenshots, `report-summary-${locale}-320-large.png`) });
  }, 320);
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "keeps summary controls legible and within the report at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const summary = page.getByRole("region", { name: "Report summary", exact: true });
      await summary.getByText("$0.000001", { exact: true }).waitFor();
      await summary.getByText("100%", { exact: true }).waitFor();
      await summary.getByText("Simulated spend", { exact: true }).waitFor();
      await summary.getByText("Pending proof", { exact: true }).waitFor();
      await summary.getByText("No recorded public/cache read outcomes", { exact: true }).waitFor();
      const controls = summary.locator("button,input");
      const bounds = await controls.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { height: rect.height, left: rect.left, right: rect.right }; }));
      expect(bounds.every(box => box.height >= 44 && box.left >= 0 && box.right <= width)).toBe(true);
      const copy = summary.getByRole("button", { name: "Copy link", exact: true });
      await copy.focus(); expect(await copy.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      await copy.hover();
      await expect.poll(() => copy.evaluate(element => getComputedStyle(element).translate)).toBe(motion === "reduce" ? "none" : "0px -2px");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => copy.evaluate(element => getComputedStyle(element).translate)).toBe("none");
      if (screenshots) await summary.screenshot({ path: join(screenshots, `report-summary-${width}-${motion}.png`) });
      await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; (window as unknown as { summaryFixture: Fixture }).summaryFixture.link("https://keryx.test/dispatch/" + "LongOriginalIdentifier".repeat(30)); });
      await expect.poll(() => summary.getByRole("textbox").inputValue()).toContain("LongOriginalIdentifier");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.recorded("real"));
      await summary.getByText("Spent", { exact: true }).waitFor(); await summary.getByText("To creators", { exact: true }).waitFor();
      await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.recorded("unknown"));
      await summary.getByText("Recorded spend", { exact: true }).waitFor(); await summary.getByText("Recorded creator share", { exact: true }).waitFor();
      await page.evaluate(() => (window as unknown as { summaryFixture: Fixture }).summaryFixture.recorded("historical"));
      await summary.getByText("Arc Testnet · historical", { exact: true }).waitFor();
    }, width, motion);
  });
