import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, type Browser, type Page } from "playwright";
import type { QueryRun } from "../types";
import { matrixSourceIdentity } from "./evidence-matrix-inspection";
import { evidenceMatrixCsv } from "./evidence-matrix";
import { evidenceMatrixMarkdown } from "./evidence-matrix-markdown";

let browser: Browser, bundle: string, css: string;
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR;
const first = { marker: "S1", sourceId: "publisher", sourceName: "Recorded publisher", itemId: "article", itemTitle: "Nghiên cứu đám mây",
  itemUrl: "https://publisher.test/article?v=1", contentVersion: "retained-v1", weight: .3, reward: 0, rationale: "Fixture" };
const second = { ...first, itemUrl: "https://publisher.test/article?v=2" };
const versioned = { ...first, contentVersion: "retained-v2" };
const demo = { ...first, sourceId: "illustration", marker: "S2", evidenceProvenance: "synthetic-demo" as const };
const claims = ["First article target", "Second article target", "Later version target", "Unanswered latency target", "Illustrative target"];
const original: QueryRun = { id: "inspection-alpha", question: "Local synthetic inspection fixture", answer: "Fixture [S1]", budget: .01,
  citations: [first, second, versioned, demo], subClaims: claims, evidence: [first, second, versioned, demo].map((source, index) => ({
    ...source, claimIndex: index === 3 ? 4 : index, claim: claims[index === 3 ? 4 : index],
    quote: ["The ĐÁM MÂY retained excerpt.  \n\n    <img data-inspection-injection>", "Distinct second article quotation.", "Later version quotation.", "Illustration, not factual support."][index],
    support: .5, qualifiesForAnswer: index !== 3, qualifiesForReward: false,
  })), decisions: [], trace: [], engine: "offline", paymentMode: "offline", totalSpent: 0, totalToCreators: 0, createdAt: "2026-10-26T00:00:00Z" };
type Fixture = { render(id: string, mode?: "unavailable" | "long" | "removed", locale?: "en" | "vi" | "zh-Hans"): void; unchanged(): boolean };
let draftCopy: Record<string, Record<string, string>>;

beforeAll(async () => {
  draftCopy = Object.fromEntries(await Promise.all(["vi", "zh-Hans"].map(async locale => {
    const draft = JSON.parse(await readFile(`locales/${locale}/ui-drafts/evidence-matrix-export.json`, "utf8"));
    return [locale, Object.fromEntries(Object.entries(draft.entries as Record<string, { text: string }>).map(([key, value]) => [key, value.text]))];
  })));
  bundle = (await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{EvidenceMatrixExport}from'./components/keryx/evidence-matrix-export';
    import{UiCopyContext,englishUiCopy}from'./lib/i18n/ui-copy-context';import{createMessages}from'./lib/i18n/messages';
    import vi from'./locales/generated/vi-ui-preview';import zh from'./locales/generated/zh-Hans-ui-preview';
    const original=${JSON.stringify(original)},before=JSON.stringify(original),root=createRoot(document.getElementById('root')),
      drafts=${JSON.stringify(Object.fromEntries(await Promise.all(["vi", "zh-Hans"].map(async locale => {
        const draft = JSON.parse(await readFile(`locales/${locale}/ui-drafts/evidence-matrix-export.json`, "utf8"));
        return [locale, Object.fromEntries(Object.values(draft.entries as Record<string, { source: string; text: string }>).map(entry => [entry.source, entry.text]))];
      }))))};
    window.evidenceInspectionFixture={unchanged:()=>JSON.stringify(original)===before,render(id,mode,locale='en'){
      const run={...original,id,...(mode==='unavailable'?{evidence:undefined}:{}),...(mode==='removed'?{citations:original.citations.slice(1)}:{}),...(mode==='long'?{
        subClaims:original.subClaims.map(claim=>claim+' '+ 'OriginalIdentifier'.repeat(15)),
        evidence:original.evidence.map(item=>({...item,claim:item.claim+' '+ 'OriginalIdentifier'.repeat(15)})),
        citations:original.citations.map(item=>({...item,itemTitle:'OriginalTitle'.repeat(25)}))}: {})};
      const preview=locale==='en'?{}:{...(locale==='vi'?vi:zh),'evidence-matrix-export':drafts[locale]},
        ui=locale==='en'?englishUiCopy:{...englishUiCopy,locale,preview,message:createMessages(locale,preview.$messages)};
      root.render(<UiCopyContext.Provider value={ui}><EvidenceMatrixExport run={run}/></UiCopyContext.Provider>);
    }};window.evidenceInspectionFixture.render(original.id);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  browser = await (process.env.KERYX_MATRIX_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
  if (screenshots) await mkdir(screenshots, { recursive: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function fixture(test: (page: Page) => Promise<void>, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, reducedMotion: "reduce", serviceWorkers: "block" });
  const requests: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      expect(url.origin).toBe("https://evidence-inspection.test");
      expect(route.request().method()).toBe("GET"); requests.push(url.pathname);
      if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
      expect(url.pathname).toBe("/");
      const fonts = "@font-face{font-family:InspectionDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:InspectionSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:InspectionMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:InspectionDisplay;--font-spectral:InspectionSerif;--font-spline-mono:InspectionMono}";
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + fonts + '</style></head><body><main id="root" style="max-width:1080px;margin:32px auto;padding:0 16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://evidence-inspection.test/"); await page.addScriptTag({ content: bundle });
    await page.getByText("Research evidence matrix", { exact: true }).click();
    await page.getByRole("searchbox", { name: "Find a target or excerpt", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready); await test(page);
    expect(errors).toEqual([]);
    expect(requests.filter(path => path !== "/" && !path.startsWith("/fonts/"))).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.unchanged())).toBe(true);
  } finally { await context.close(); }
}
const search = (page: Page) => page.getByRole("searchbox", { name: "Find a target or excerpt", exact: true });
const article = (page: Page) => page.getByRole("combobox", { name: "Cited article with an excerpt", exact: true });
const availability = (page: Page) => page.getByRole("combobox", { name: "Excerpt availability", exact: true });
const targets = (page: Page) => page.getByRole("list", { name: "By target", exact: true }).locator(":scope > li");
const revealFilters = (page: Page) => page.getByText("Article and excerpt filters", { exact: true }).click();

it("finds eligible original text, retains literal excerpt bytes and recovers with keyboard focus", async () => {
  await fixture(async page => {
    expect(await targets(page).count()).toBe(5);
    await search(page).fill("  DAM    MAY retained excerpt  ");
    await page.getByRole("status").filter({ hasText: "1 of 5 targets shown" }).waitFor();
    const row = targets(page); expect(await row.count()).toBe(1);
    await row.getByText("Inspect cited sources", { exact: true }).click();
    await row.locator("article").first().getByText("Inspect 1 excerpt", { exact: true }).click();
    expect(await row.locator("blockquote").first().textContent()).toBe(original.evidence![0].quote);
    expect(await page.locator("[data-inspection-injection]").count()).toBe(0);
    await search(page).fill("<script>[no match");
    await page.getByText("No target matches these filters.", { exact: false }).waitFor();
    await search(page).dispatchEvent("keydown", { key: "Escape", isComposing: true });
    expect(await search(page).inputValue()).toBe("<script>[no match");
    await search(page).focus(); await page.keyboard.press("Escape");
    expect(await search(page).inputValue()).toBe("");
    await search(page).fill("no match");
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    expect(await search(page).evaluate(element => document.activeElement === element)).toBe(true);
    expect(await targets(page).count()).toBe(5);
  });
});

it.each(["vi", "zh-Hans"] as const)("fits the prepared %s namespace draft at enlarged mobile text without translating original data", async locale => {
  await fixture(async page => {
    await page.evaluate(value => {
      document.documentElement.style.fontSize = "24px";
      (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.render("draft-" + value, undefined, value);
    }, locale);
    await page.locator("main > details > summary").click();
    const copy = draftCopy[locale];
    const input = page.getByRole("searchbox", { name: copy.search, exact: true }); await input.fill("DAM MAY excerpt");
    await page.getByRole("status").filter({ hasText: copy.resultCount.replace("{shown}", "1").replace("{total}", "5") }).waitFor();
    await page.getByText(copy.advancedFilters, { exact: true }).click();
    for (const control of [input, page.getByRole("combobox", { name: copy.article, exact: true }), page.getByRole("combobox", { name: copy.inspectionState, exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator("ol > li h3").textContent()).toBe(claims[0]);
    await page.getByRole("button", { name: copy.resetFilters, exact: true }).click();
    expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
    if (screenshots) await page.screenshot({ path: join(screenshots, `matrix-inspection-draft-${locale}-320-large.png`), fullPage: true });
  }, 320);
});

it("keeps exact article URL and version filters consistent in both views", async () => {
  await fixture(async page => {
    await revealFilters(page);
    for (const [index, source] of [first, second, versioned].entries()) {
      await article(page).selectOption(matrixSourceIdentity(source));
      await page.getByRole("status").filter({ hasText: "1 of 5 targets shown" }).waitFor();
      expect(await targets(page).locator("h3").allTextContents()).toEqual([claims[index]]);
      await page.getByRole("button", { name: "Compare sources", exact: true }).click();
      expect(await page.getByRole("rowheader").allTextContents()).toEqual([claims[index]]);
      expect(await page.getByRole("columnheader").count()).toBe(6);
      await page.getByRole("button", { name: "By target", exact: true }).click();
    }
    await article(page).selectOption(matrixSourceIdentity(first));
    await search(page).fill("later version quotation");
    await page.getByRole("status").filter({ hasText: "0 of 5 targets shown" }).waitFor();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    expect(await article(page).inputValue()).toBe("");
  });
});

it("distinguishes missing excerpts, illustrative excerpts and an unavailable historical ledger", async () => {
  await fixture(async page => {
    await revealFilters(page);
    await availability(page).selectOption("without-excerpts");
    expect(await targets(page).locator("h3").allTextContents()).toEqual([claims[3]]);
    await availability(page).selectOption("with-excerpts");
    expect(await targets(page).count()).toBe(4);
    await article(page).selectOption(matrixSourceIdentity(demo));
    await targets(page).locator("header").getByText("Illustrative demo excerpt", { exact: true }).waitFor();
    await page.evaluate(() => (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.render("historical", "unavailable"));
    await page.getByText("Research evidence matrix", { exact: true }).click();
    await revealFilters(page);
    await availability(page).selectOption("without-excerpts");
    expect(await targets(page).count()).toBe(5);
    expect(await page.getByText("Evidence ledger unavailable", { exact: true }).count()).toBe(5);
  });
});

it("keeps a removed article selection explicit until the reader resets it", async () => {
  await fixture(async page => {
    await revealFilters(page);
    await article(page).selectOption(matrixSourceIdentity(first));
    await page.evaluate(() => (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.render("inspection-alpha", "removed"));
    await page.getByRole("status").filter({ hasText: "0 of 5 targets shown" }).waitFor();
    expect(await article(page).locator("option:checked").textContent()).toBe("Previously selected article (no longer cited in this report)");
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    expect(await targets(page).count()).toBe(5);
  });
});

it("exports the complete original CSV and Markdown even when every target is hidden", async () => {
  await fixture(async page => {
    await search(page).fill("no matching target");
    await page.getByRole("status").filter({ hasText: "0 of 5 targets shown" }).waitFor();
    for (const [name, expected] of [["Download evidence CSV", "\uFEFF" + evidenceMatrixCsv(original)], ["Download evidence Markdown", evidenceMatrixMarkdown(original)]]) {
      const waiting = page.waitForEvent("download"); await page.getByRole("button", { name, exact: true }).click();
      const download = await waiting, stream = await download.createReadStream(); if (!stream) throw Error("Missing native download");
      const parts: Buffer[] = []; for await (const part of stream) parts.push(Buffer.from(part));
      expect(Buffer.concat(parts).toString("utf8")).toBe(expected);
    }
  });
});

it("starts each newly opened report with its complete matrix", async () => {
  await fixture(async page => {
    await revealFilters(page);
    await search(page).fill("no match"); await article(page).selectOption(matrixSourceIdentity(first));
    await availability(page).selectOption("with-excerpts");
    await page.getByRole("button", { name: "Compare sources", exact: true }).click();
    await page.evaluate(() => (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.render("new-report"));
    await page.getByText("Research evidence matrix", { exact: true }).click();
    await revealFilters(page);
    expect(await search(page).inputValue()).toBe(""); expect(await article(page).inputValue()).toBe("");
    expect(await availability(page).inputValue()).toBe("all"); expect(await targets(page).count()).toBe(5);
    expect(await page.getByRole("button", { name: "By target", exact: true }).getAttribute("aria-pressed")).toBe("true");
  });
});

it.each([320, 390, 768, 1366])("keeps the inspection controls readable and keyboard-operable at %ipx", async width => {
  await fixture(async page => {
    await page.evaluate(() => (window as unknown as { evidenceInspectionFixture: Fixture }).evidenceInspectionFixture.render("long-report", "long"));
    await page.getByText("Research evidence matrix", { exact: true }).click();
    expect((await targets(page).first().boundingBox())!.y).toBeLessThan(900);
    if (screenshots) await page.screenshot({ path: join(screenshots, `matrix-inspection-${width}-compact.png`), fullPage: false });
    await revealFilters(page);
    for (const size of [16, 24]) {
      await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px`; }, size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      for (const control of [search(page), article(page), availability(page)]) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await control.focus();
        expect(await control.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
      }
      await search(page).focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
      expect(await article(page).evaluate(element => document.activeElement === element)).toBe(true);
      await page.keyboard.press("Tab");
      expect(await availability(page).evaluate(element => document.activeElement === element)).toBe(true);
      await search(page).fill("unanswered latency");
      await page.getByRole("status").filter({ hasText: "1 of 5 targets shown" }).waitFor();
      if (screenshots) await page.screenshot({ path: join(screenshots, `matrix-inspection-${width}-${size}.png`), fullPage: true });
      await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    }
  }, width);
});
