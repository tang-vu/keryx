import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "playwright";
import type { QueryRun } from "../types";
import { evidenceMatrixCsv } from "./evidence-matrix";
import { evidenceMatrixMarkdown } from "./evidence-matrix-markdown";

let browser: Browser, css: string, bundle: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const first = { marker: "S1", sourceId: "publisher", sourceName: "Recorded publisher", itemId: "article", itemTitle: "The same article title", itemUrl: "https://publisher.test/article?v=1", contentVersion: "recorded-v1", weight: .4, reward: 0, rationale: "Fixture" };
const second = { ...first, itemUrl: "https://publisher.test/article?v=2" };
const versioned = { ...first, contentVersion: "recorded-v2" };
const illustrative = { ...first, marker: "S3", sourceId: "illustration", sourceName: "Illustrative source", itemTitle: "Illustrative article", itemUrl: "https://illustration.test/example", evidenceProvenance: "synthetic-demo" as const };
const legacy = { marker: "S4", sourceId: "legacy", sourceName: "Legacy source", weight: .2, reward: 0, rationale: "Fixture" };
const claim = "Which measured result was recorded?";
const run: QueryRun = { id: "matrix-alpha", question: "Synthetic local evidence reading fixture", answer: "Recorded fixture body. [S1]", budget: .01,
  citations: [first, second, versioned, illustrative, legacy], subClaims: [claim, "Missing evidence target", "An unverified target with no excerpt"], decisions: [], trace: [], engine: "fixture", createdAt: "2026-10-01T00:00:00Z", totalSpent: 0, totalToCreators: 0, paymentMode: "offline",
  evidence: [{ ...first, claimIndex: 0, claim, quote: "Exact first article passage.  \n\n", support: .8, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...second, claimIndex: 0, claim, quote: "Exact second article passage.", support: .7, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...versioned, claimIndex: 0, claim, quote: "Exact later version passage.", support: .7, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...first, contentVersion: "wrong-version", claimIndex: 0, claim, quote: "WRONG_VERSION_MUST_STAY_OUT", support: .9, qualifiesForAnswer: true, qualifiesForReward: false },
    { ...illustrative, claimIndex: 0, claim, quote: "Illustrative measurement, not factual support.", support: .5, qualifiesForAnswer: false, qualifiesForReward: false }] };
type Fixture = { report(index: number): void; stress(value: boolean): void; locale(value: "vi" | "zh-Hans"): void;
  quote(value: string): void; mode(value: "ok" | "throw" | "missing" | "clickThrow"): void; created: string[]; revoked: string[]; unchanged(): boolean };
const fonts = `@font-face{font-family:MatrixDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:MatrixSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:MatrixMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:MatrixDisplay;--font-spectral:MatrixSerif;--font-spline-mono:MatrixMono}`;

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AnswerCard}from'./components/keryx/answer-card';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const original=${JSON.stringify(run)},before=JSON.stringify(original),nativeCreate=URL.createObjectURL.bind(URL),nativeRevoke=URL.revokeObjectURL.bind(URL),nativeClick=HTMLAnchorElement.prototype.click;
    const fixture=window.matrixFixture={created:[],revoked:[],unchanged:()=>JSON.stringify(original)===before,mode(mode){Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:mode==='missing'?undefined:blob=>{if(mode==='throw')throw Error('PRIVATE_EXPORT_DETAIL');const url=nativeCreate(blob);fixture.created.push(url);return url}});URL.revokeObjectURL=url=>{fixture.revoked.push(url);nativeRevoke(url)};HTMLAnchorElement.prototype.click=mode==='clickThrow'?function(){throw Error('PRIVATE_CLICK_DETAIL')}:nativeClick}};fixture.mode('ok');
    function App(){const[index,setIndex]=useState(0),[stress,setStress]=useState(false),[locale,setLocale]=useState('en'),[quote,setQuote]=useState(null);Object.assign(fixture,{report:setIndex,stress:setStress,locale:setLocale,quote:setQuote});
      const value={...original,id:index?'matrix-'+index:original.id,...(index===1?{evidence:undefined}:index===2?{citations:[],evidence:[]}:index===3?{citations:[],subClaims:[],evidence:[]}:{}),...(quote!==null?{evidence:original.evidence.map((item,index)=>index===0?{...item,quote}:item)}:{}),...(stress?{subClaims:[...original.subClaims,...Array.from({length:12},(_,index)=>'Unverified target '+index+' '+ 'OriginalIdentifier'.repeat(8))]}:{})},preview=locale==='vi'?vi:locale==='zh-Hans'?zh:{};
      const ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      return <UiCopyContext.Provider value={ui}><AnswerCard run={value} meta={null} showFeedback={false}/></UiCopyContext.Provider>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  const inputs = Object.keys(result.metafile!.inputs).map(path => path.replaceAll("\\", "/"));
  expect(inputs.some(path => path.endsWith("components/keryx/evidence-matrix-export.tsx"))).toBe(true);
  expect(inputs.some(path => /(?:^|\/)node_modules\/(?:jsonwebtoken|jwa|jws)\//.test(path))).toBe(false);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

const matrix = (page: Page) => page.locator("details").filter({ has: page.getByText("Research evidence matrix", { exact: true }) });
async function fixture(test: (page: Page) => Promise<void>, width = 390, reducedMotion: "reduce" | "no-preference" = "reduce") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion, acceptDownloads: true });
  const errors: string[] = [], unexpected: string[] = [];
  try {
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET" || url.origin !== "https://matrix-reading.test") { unexpected.push(request.url()); return route.abort(); }
      if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: css + fonts });
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" style="max-width:1080px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://matrix-reading.test/"); await page.addScriptTag({ content: bundle });
    await matrix(page).waitFor(); await page.evaluate(() => document.fonts.ready); await test(page);
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}

it("provides a usable mobile touch target for opening evidence inspection", async () => {
  await fixture(async page => {
    const box = await matrix(page).locator(":scope > summary").boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }, 320);
});

it("keeps exact article identities and excerpt boundaries in both evidence views", async () => {
  await fixture(async page => {
    const root = matrix(page); await root.locator(":scope > summary").click();
    const targets = root.getByRole("list", { name: "By target", exact: true });
    expect(await targets.locator(":scope > li").count()).toBe(3);
    const target = targets.locator(":scope > li").first();
    await target.getByText("Inspect cited sources", { exact: true }).click();
    expect(await target.getByText("The same article title", { exact: true }).count()).toBe(3);
    const source = target.locator("article").first();
    await source.getByText(first.itemUrl, { exact: true }).waitFor(); await source.getByText("Recorded version: recorded-v1", { exact: true }).waitFor();
    await target.getByText("Inspect 1 excerpt", { exact: true }).first().click();
    expect(await target.locator("blockquote").first().textContent()).toBe(run.evidence![0].quote);
    if (screenshots) await source.screenshot({ path: join(screenshots, "evidence-source-390.png") });
    const compare = root.getByRole("button", { name: "Compare sources", exact: true });
    await compare.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => compare.getAttribute("aria-pressed")).toBe("true");
    expect(await compare.evaluate(element => document.activeElement === element)).toBe(true);
    const headers = root.locator("thead th"); expect(await headers.count()).toBe(7);
    const cells = root.locator("tbody tr").first().locator("td");
    expect(await cells.nth(1).locator("blockquote").allTextContents()).toEqual([run.evidence![0].quote]);
    expect(await cells.nth(2).locator("blockquote").allTextContents()).toEqual([run.evidence![1].quote]);
    expect(await cells.nth(3).locator("blockquote").allTextContents()).toEqual([run.evidence![2].quote]);
    expect(await cells.nth(4).getByText("Illustrative demo excerpt", { exact: true }).count()).toBe(1);
    expect(await cells.nth(5).textContent()).toBe("No excerpt recorded");
    expect(await root.getByText("WRONG_VERSION_MUST_STAY_OUT", { exact: true }).count()).toBe(0);
    await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.report(1));
    await root.getByText("Evidence ledger unavailable", { exact: true }).first().waitFor({ state: "attached" });
    await root.locator(":scope > summary").click();
    await expect.poll(() => root.getByRole("button", { name: "By target", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(await root.getByText("Evidence ledger unavailable", { exact: true }).count()).toBe(3);
    expect(await root.locator("blockquote").count()).toBe(0);
  });
});

it.each(["vi", "zh-Hans"] as const)("keeps original source data readable in the actual %s preview at enlarged mobile text", async locale => {
  await fixture(async page => {
    await matrix(page).locator(":scope > summary").click();
    await page.evaluate(value => { document.documentElement.style.fontSize = "24px"; (window as unknown as { matrixFixture: Fixture }).matrixFixture.locale(value); }, locale);
    const byTarget = page.getByRole("button", { name: locale === "vi" ? "Theo câu hỏi" : "按研究问题查看", exact: true });
    await byTarget.waitFor();
    const root = byTarget.locator("xpath=ancestor::details[1]");
    expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const target = root.locator("ol > li").first(); await target.locator(":scope > details > summary").click();
    const source = target.locator("article").first();
    await source.getByText("The same article title", { exact: true }).waitFor();
    await source.getByText(first.itemUrl, { exact: true }).waitFor();
    expect(await source.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (screenshots) await source.screenshot({ path: join(screenshots, `evidence-source-${locale}-320-large.png`) });
  }, 320);
});

it("keeps missing sources and missing targets explicit without empty source actions", async () => {
  await fixture(async page => {
    await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.report(2));
    const root = matrix(page);
    await root.getByText("No inspectable excerpt recorded", { exact: true }).first().waitFor({ state: "attached" });
    await root.locator(":scope > summary").click();
    expect(await root.getByText("No inspectable excerpt recorded", { exact: true }).count()).toBe(3);
    expect(await root.getByText("Inspect cited sources", { exact: true }).count()).toBe(0);
    await root.getByRole("button", { name: "Compare sources", exact: true }).click();
    expect(await root.getByRole("columnheader").count()).toBe(2);
    expect(await root.locator("blockquote").count()).toBe(0);
    await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.report(3));
    await root.getByText("Research claims were not recorded for this dispatch. No evidence matrix is available.", { exact: true }).waitFor({ state: "attached" });
    await root.locator(":scope > summary").click();
    expect(await root.getByRole("button").count()).toBe(0);
    expect(await root.getByRole("list").count()).toBe(0);
    expect(await root.getByRole("table").count()).toBe(0);
  });
});

it("preserves long unbroken quotes, indentation, blank lines and literal markup in target cards", async () => {
  await fixture(async page => {
    const root = matrix(page); await root.locator(":scope > summary").click();
    const target = root.getByRole("list", { name: "By target", exact: true }).locator(":scope > li").first();
    await target.getByText("Inspect cited sources", { exact: true }).click();
    const source = target.locator("article").first(); await source.getByText("Inspect 1 excerpt", { exact: true }).click();
    for (const original of ["The reference is https://example.invalid/" + "x".repeat(190) + ".", 'A retained quoted line.\n    "aaa","b""bb","ccc"\n\n    Literal <img data-fixture-injection> text.  \n\n']) {
      await page.evaluate(value => (window as unknown as { matrixFixture: Fixture }).matrixFixture.quote(value), original);
      const quote = source.locator("blockquote");
      await expect.poll(() => quote.textContent()).toBe(original);
      expect(await quote.innerText()).toBe(original);
      expect(await quote.evaluate(element => element.clientWidth > 0 && element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.locator("[data-fixture-injection]").count()).toBe(0);
    }
  }, 320);
});

it("preserves actual CSV/Markdown download bytes and recovers from export failures", async () => {
  await fixture(async page => {
    const root = matrix(page); await root.locator(":scope > summary").click();
    for (const [name, filename, expected] of [["Download evidence CSV", "keryx-evidence-matrix.csv", "\uFEFF" + evidenceMatrixCsv(run)], ["Download evidence Markdown", "keryx-evidence-matrix.md", evidenceMatrixMarkdown(run)]]) {
      const waiting = page.waitForEvent("download"); await root.getByRole("button", { name, exact: true }).click();
      const download = await waiting; expect(download.suggestedFilename()).toBe(filename);
      const stream = await download.createReadStream(); if (!stream) throw Error("Native evidence download missing");
      const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
      expect(Buffer.concat(parts).toString("utf8")).toBe(expected);
    }
    const download = root.getByRole("button", { name: "Download evidence CSV", exact: true });
    for (const mode of ["throw", "missing", "clickThrow"] as const) {
      await page.evaluate(value => (window as unknown as { matrixFixture: Fixture }).matrixFixture.mode(value), mode);
      await download.click(); await root.getByRole("alert").waitFor();
      expect(await root.getByRole("alert").textContent()).toBe("Download unavailable. Try again.");
      expect(await page.locator('a[download^="keryx-evidence-matrix"]').count()).toBe(0);
    }
    await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.mode("ok"));
    const waiting = page.waitForEvent("download"); await download.click(); await waiting;
    expect(await root.getByRole("alert").count()).toBe(0);
    await expect.poll(() => page.evaluate(() => { const f = (window as unknown as { matrixFixture: Fixture }).matrixFixture; return f.created.length === f.revoked.length; })).toBe(true);
  });
});

it.each([320, 390, 768, 1366].flatMap(width => (["reduce", "no-preference"] as const).map(motion => ({ width, motion }))))(
  "keeps target reading and keyboard comparison usable at $width/$motion", async ({ width, motion }) => {
    await fixture(async page => {
      const root = matrix(page); await root.locator(":scope > summary").click();
      const cards = root.getByRole("list", { name: "By target", exact: true }); await cards.waitFor();
      const target = cards.locator(":scope > li").first();
      await target.getByText("Inspect cited sources", { exact: true }).click();
      const sources = target.locator("article");
      const columns = await sources.evaluateAll(elements => { const [a, b] = elements.map(element => element.getBoundingClientRect()); return { sameRow: a.y === b.y, separateColumn: b.x >= a.right }; });
      const wide = await root.evaluate(element => element.clientWidth >= 38 * parseFloat(getComputedStyle(document.documentElement).fontSize));
      expect(columns.sameRow && columns.separateColumn).toBe(wide);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const controls = await root.locator("button,summary").evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => { const r = element.getBoundingClientRect(); return { text: element.textContent, height: r.height, right: r.right, left: r.left, nativeHeight: (element as HTMLElement).offsetHeight }; }));
      // A CSS translation can introduce sub-pixel subtraction noise in the DOMRect.
      // Keep the native 44px requirement and reject actual scaling/clipping.
      expect(controls.filter(box => box.nativeHeight < 44 || box.height < 44 - 1e-6 || box.left < 0 || box.right > width)).toEqual([]);
      if (screenshots) await root.screenshot({ path: join(screenshots, `evidence-targets-${width}-${motion}.png`) });
      await page.evaluate(() => (window as unknown as { matrixFixture: Fixture }).matrixFixture.stress(true));
      const compare = root.getByRole("button", { name: "Compare sources", exact: true }); await compare.focus(); await page.keyboard.press("Enter");
      const region = root.getByRole("region", { name: "Research target by cited source evidence matrix", exact: true }); await region.waitFor();
      const view = region.locator("..");
      expect(await view.evaluate(element => getComputedStyle(element).animationName)).toBe(motion === "reduce" ? "none" : "kxSourceArrive");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => view.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
      await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
      expect(await region.evaluate(element => document.activeElement === element)).toBe(true);
      expect(await region.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      const firstHeader = region.getByRole("columnheader", { name: "Research target (unverified)", exact: true }), before = await firstHeader.boundingBox();
      await page.keyboard.press("ArrowRight"); await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      expect(Math.abs((await firstHeader.boundingBox())!.x - before!.x)).toBeLessThanOrEqual(1);
      await page.keyboard.press("PageDown"); await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(Math.abs((await firstHeader.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(1);
      if (screenshots) await region.screenshot({ path: join(screenshots, `evidence-comparison-${width}-${motion}.png`) });
      await root.getByRole("button", { name: "By target", exact: true }).click();
      await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
      expect(await root.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }, width, motion);
  });

it("retains native touch geometry throughout the finite view arrival", async () => {
  await fixture(async page => {
    const root = matrix(page); await root.locator(":scope > summary").click();
    const frames = await root.evaluate(async element => {
      const values: { height: number; nativeHeight: number; visible: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const control of element.querySelectorAll<HTMLElement>("button,summary")) {
          if (control.checkVisibility()) values.push({ height: control.getBoundingClientRect().height, nativeHeight: control.offsetHeight, visible: true });
        }
      }
      return values;
    });
    expect(frames.length).toBeGreaterThan(100);
    expect(frames.every(frame => frame.nativeHeight >= 44 && frame.height >= 44 - 1e-6)).toBe(true);
    if (screenshots) await writeFile(join(screenshots, "arrival-geometry.json"), JSON.stringify({ samples: frames.length, fractionalSamples: frames.filter(frame => frame.height !== frame.nativeHeight), invalid: frames.filter(frame => frame.nativeHeight < 44 || frame.height < 44 - 1e-6) }, null, 2));
  }, 390, "no-preference");
});
