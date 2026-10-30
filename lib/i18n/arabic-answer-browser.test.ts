import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyEvidenceReview } from "../llm/evidence-review";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { answerPresentation } from "../research/answer-presentation";
import { finalizeAnswerLanguage } from "../research/answer-language-provenance";
import { languageReviewedProposals } from "../research/answer-language-review";
import { nativeAnswerCopy } from "../research/native-answer-copy";

let browser: Browser, css: string, bundle: string;
const capture = process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR
  ? join(process.env.KERYX_NATIVE_GUIDANCE_SCREENSHOT_DIR, "arabic-answer") : undefined;
// Keep every offered segment complete and at least 8 characters; the existing
// source segmenter treats a URL query's question mark as a sentence boundary.
const quote = "The original rule requires a documented safeguard, subject to an exception. <literal> {count} USDC 0.000001 https://original.test/a?version=1.";
const statement = "يتطلب النص الأصلي إجراء حماية موثقًا مع مراعاة الاستثناء.";
const target = "Original topic <literal> {count} 日本語";
const source = { sourceId: "synthetic-ar-original", sourceName: "Original source {count}", marker: "S1", sourceKind: "public-reference" as const, text: quote };
const copy = nativeAnswerCopy("ar")!;

beforeAll(async () => {
  const presentation = answerPresentation("Answer in Arabic.");
  const proposed = [{ claimIndex: 0, marker: "S1", quote, quoteSpan: { start: 0, end: quote.length },
    statement, statementSupport: 0.9, support: 0.9 }];
  const ledger = buildEvidenceLedger({ subClaims: [target], gathered: [source], answer: "Unreviewed draft [S1]",
    declaredMarkers: ["S1"], proposedEvidence: proposed, finalAssessment: [{ claim: target, coverage: 0.9, coveredBy: ["S1"] }] });
  const reviewed = applyEvidenceReview(proposed, { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9,
    statementLanguage: "ar" }] }, new Set([0]), true);
  const statements = selectCitedStatements(languageReviewedProposals(reviewed, "ar"), ledger);
  const input = { question: "Original request", answer: "Unreviewed draft [S1]", ledger, statements, presentation };
  const answer = finalizeGroundedAnswer(input);
  const packet = finalizeAnswerLanguage({ answer, rendererLanguage: "ar", statements, proposals: reviewed });
  expect(packet?.language).toBe("ar");
  expect(ledger.evidence[0].qualifiesForAnswer).toBe(true);
  expect(ledger.evidence[0].qualifiesForReward).toBe(false);
  const excerpts = finalizeGroundedAnswer({ ...input, statements: [] });
  expect(excerpts).toContain(copy.excerptIntro);
  expect(excerpts).not.toContain(statement);
  const fixture = { answer, excerpts, quote, statement, target, source, packet,
    citation: { sourceId: source.sourceId, sourceName: source.sourceName, marker: "S1", weight: 1, reward: 0, rationale: "Synthetic offline fixture" } };
  const result = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{AnswerMarkdown}from'./components/keryx/answer-markdown';
    const fixture=${JSON.stringify(fixture)},original=JSON.stringify(fixture);window.citationClicks=[];
    function App(){const[excerpt,setExcerpt]=useState(false);window.arabicFixture={excerpt:setExcerpt,unchanged:()=>JSON.stringify(fixture)===original};
      return <main className="mx-auto max-w-[800px] px-4 py-6"><AnswerMarkdown text={excerpt?fixture.excerpts:fixture.answer}
        className={new URL(location.href).searchParams.has('large')?'text-[27px]':undefined}
        language={excerpt?undefined:fixture.packet.language} citations={[fixture.citation]}
        onCitationClick={(marker,trigger)=>window.citationClicks.push({marker,focused:document.activeElement===trigger})}/></main>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  expect(Object.keys(result.metafile!.inputs).some(path => path.replaceAll("\\", "/").endsWith("components/keryx/answer-markdown.tsx"))).toBe(true);
  bundle = result.outputFiles[0].text;
  css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8"), { from: resolve("app/globals.css") })).css;
  // Same bundled Latin faces and normal script fallback as the existing web typography.
  css += `@font-face{font-family:ArabicDisplay;src:url('/fonts/bodoni-moda-latin.woff2')}@font-face{font-family:ArabicSerif;src:url('/fonts/spectral-latin-400.woff2')}@font-face{font-family:ArabicMono;src:url('/fonts/spline-sans-mono-latin.woff2')}:root{--font-bodoni:ArabicDisplay;--font-spectral:ArabicSerif;--font-spline-mono:ArabicMono}`;
  if (capture) await mkdir(capture, { recursive: true });
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it.each([320, 390, 1366].flatMap(width => [18, 27].map(font => ({ width, font }))))(
  "renders actual Arabic answer and excerpt-only limits at $width with $font px text", async ({ width, font }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors: string[] = [], unexpected: string[] = [];
    try {
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== "https://arabic-answer.test" || request.method() !== "GET") {
          unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
        }
        if (url.pathname === "/answer.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
        if (url.pathname.startsWith("/fonts/")) return route.fulfill({ contentType: "font/woff2", body: await readFile(join("app", url.pathname)) });
        if (url.pathname !== "/") { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="fr" style="font-size:${font === 27 ? 24 : 16}px"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/answer.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>` });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`https://arabic-answer.test/${font === 27 ? "?large" : ""}`);
      await page.getByText(copy.summaryIntro, { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.locator("main [lang='ar']").count()).toBeGreaterThan(0);
      expect(await page.locator("main [lang='ar']").getAttribute("dir")).toBe("rtl");
      expect(await page.locator("main [lang='ar']").evaluate(element => getComputedStyle(element).direction)).toBe("rtl");
      expect(await page.locator("html").getAttribute("lang")).toBe("fr");
      expect(await page.locator("main p").first().evaluate(element => getComputedStyle(element).fontSize)).toBe(`${font}px`);
      const original = page.locator('bdi[lang="und"][dir="auto"]').filter({ hasText: quote });
      expect(await original.innerText()).toContain(quote);
      expect(await page.locator("main").innerText()).toContain(statement);
      expect(await page.locator("main").innerText()).toContain(target);
      expect(await page.locator("main").innerText()).toContain(copy.reviewNotice);
      expect(await page.locator("main").innerText()).toContain(copy.limitations);
      const citation = page.getByRole("button").first();
      await citation.focus(); await page.keyboard.press("Enter");
      expect(await page.evaluate(() => (window as unknown as { citationClicks: unknown[] }).citationClicks)).toEqual([{ marker: "S1", focused: true }]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (capture) await page.screenshot({ path: join(capture, `arabic-${width}-font${font}-summary.png`), fullPage: true });
      await page.evaluate(() => (window as unknown as { arabicFixture: { excerpt(value: boolean): void } }).arabicFixture.excerpt(true));
      await page.getByText(copy.excerptIntro, { exact: true }).waitFor();
      expect(await page.locator("main").innerText()).toContain(quote);
      expect(await page.locator("main").innerText()).not.toContain(statement);
      expect(await page.locator("main [lang='ar']").count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { arabicFixture: { unchanged(): boolean } }).arabicFixture.unchanged())).toBe(true);
      if (capture) await page.screenshot({ path: join(capture, `arabic-${width}-font${font}-excerpts.png`), fullPage: true });
      expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    } finally { await context.close(); }
  }, 20_000);
