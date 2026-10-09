/** Stored quote fidelity and geometry in actual components with built CSS. No service calls. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { privateWorkspaceResultSchema } from "../lib/a2a/private-workspace";
import { assertSignedOutBrowserFixtureGraph, signedOutResearchAuthFixture } from "../test-support/research-browser-auth-fixture";

const directory = join(resolve(process.env.NEXT_DIST_DIR ?? ".next"), "static", "chunks");
const cssFiles = (await readdir(directory)).filter(file => file.endsWith(".css"));
assert(cssFiles.length, "Build the exact candidate before browser verification");
const css = (await Promise.all(cssFiles.map(file => readFile(join(directory, file), "utf8")))).join("\n");
const output = process.env.KERYX_EVIDENCE_SCREENSHOT_DIR ?? join(process.cwd(), ".artifacts", "evidence-readability");
await mkdir(output, { recursive: true });

const longQuote = `The reference is https://example.invalid/${"x".repeat(190)}.`;
const wrappedQuote = 'If the field contains a quotation mark,\n    escape it with another quotation mark.\n\n    "aaa","b""bb","ccc"\n    Literal <img data-fixture-injection> text.';
const citation = { sourceId: "ui-fixture", sourceName: "Synthetic UI fixture", marker: "S1", weight: 1, reward: 0,
  sourceKind: "public-reference", itemId: "ui-article", itemTitle: "Synthetic original", itemUrl: "https://example.invalid/original", contentVersion: "a".repeat(64) };
const evidence = [longQuote, wrappedQuote].map((quote, claimIndex) => ({ ...citation, quote, claimIndex,
  claim: `Synthetic formatting target ${claimIndex}`, support: 0.9, qualifiesForAnswer: true, qualifiesForReward: false }));
const claimCoverage = evidence.map(item => ({ claimIndex: item.claimIndex, claim: item.claim, coverage: 0.9, coveredBy: ["S1"] }));
const run = { id: "synthetic-evidence-ui", question: "Synthetic citation inspection", budget: 0, createdAt: "2026-10-08T00:00:00Z",
  answer: "A synthetic fixture for inspecting the evidence. [S1]", subClaims: evidence.map(item => item.claim), citations: [citation],
  evidence, claimCoverage, decisions: [], trace: [], totalSpent: 0, totalToCreators: 0, engine: "synthetic-ui-fixture", researchMode: "quick" };
const publicJob = { status: "completed", queryId: run.id, answer: run.answer, claimCoverage, evidence };
const privateJob = privateWorkspaceResultSchema.parse({ wallet: `0x${"1".repeat(40)}`, format: "private-result-v1", status: "completed",
  request: { question: run.question, researchMode: "quick", model: null, packageVersion: "synthetic", creatorBudgetMicros: "0" },
  spend: { format: "private-spend-v1", chainFinalityVerified: false, incoming: { status: "not-submitted", priceMicros: "0" },
    creator: { budgetMicros: "0", committedMicros: "0", unresolvedMicros: "0", processingMicros: "0", confirmedMicros: "0", uncommittedMicros: "0", payments: [] } },
  result: { answer: run.answer, engine: run.engine, savedAt: run.createdAt, subClaims: run.subClaims, decisions: [], citations: [], evidence, claimCoverage } });
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{AnswerCard}from'./components/keryx/answer-card';
import{ResearchJobDetails}from'./components/keryx/research-job-details';
import{ResearchPrivateResult}from'./components/keryx/research-private-result';
window.syntheticRequests=[];
window.fetch=async(input,init={})=>{window.syntheticRequests.push({url:String(input),method:init.method||'GET'});return new Response(JSON.stringify({up:0,down:0}),{status:String(input).includes('/receipt')?404:200,headers:{'content-type':'application/json'}});};
createRoot(document.getElementById('root')).render(<>
<section data-view="answer"><AnswerCard run={${JSON.stringify(run)}} meta={null}/></section>
<section data-view="public-job"><ResearchJobDetails job={${JSON.stringify(publicJob)}}/></section>
<section data-view="private-job"><ResearchPrivateResult job={${JSON.stringify(privateJob)}}/></section>
</>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) }, plugins: [signedOutResearchAuthFixture()] });
assertSignedOutBrowserFixtureGraph(bundle.metafile, ["components/keryx/answer-card.tsx", "components/keryx/research-job-details.tsx", "components/keryx/research-private-result.tsx", "components/keryx/deliverable-acceptance.tsx"]);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [320, 360, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    const errors: string[] = [], attemptedExternalRequests: string[] = [];
    await context.route("**/*", route => {
      if (route.request().url() === "https://evidence.test/") return route.fulfill({ contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><main id="root" style="max-width:800px;margin:auto"></main></body></html>' });
      attemptedExternalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto("https://evidence.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const trigger = page.getByRole("button", { name: "Inspect evidence for citation S1", exact: true });
      await trigger.waitFor();
      // Native details inspection exposes the matrix and source-omission excerpt views.
      await page.locator("details").evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
      const quotes = page.locator("blockquote");
      assert.equal(await quotes.count(), 10, "Ledger, matrix, source lens and both job views retain both stored excerpts");
      const displayed = await quotes.evaluateAll(nodes => nodes.map(node => {
        const container = node.closest("[data-view]")?.getAttribute("data-view");
        const view = container === "answer" ? node.closest("table") ? "matrix" : node.closest("details") ? "source-lens" : "inline-ledger" : container;
        return { view, text: node.textContent, rendered: (node as HTMLElement).innerText,
          width: node.clientWidth, overflow: node.scrollWidth - node.clientWidth };
      }));
      for (const view of ["inline-ledger", "matrix", "source-lens", "public-job", "private-job"]) {
        const pair = displayed.filter(quote => quote.view === view);
        assert.equal(pair.length, 2, `${view} retains its own stored excerpt pair`);
        for (const original of [longQuote, wrappedQuote]) assert.equal(pair.filter(quote => quote.text?.includes(original) && quote.rendered.includes(original)).length, 1, `${view} preserves each distinct excerpt`);
      }
      for (const quote of displayed) {
        assert(quote.width > 0); assert(quote.overflow <= 1, `Stored excerpt overflows at ${width}px`);
        assert([longQuote, wrappedQuote].some(original => quote.text?.includes(original) && quote.rendered.includes(original)), "Stored whitespace and literal text must survive rendering");
      }
      assert.equal(await page.locator("[data-fixture-injection]").count(), 0, "Quotes remain escaped text");
      const target = await trigger.boundingBox(); assert(target && target.height >= 44 && target.width >= 44);
      await trigger.focus(); await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Synthetic original" }); await dialog.waitFor();
      const panelQuotes = dialog.locator("blockquote"); assert.equal(await panelQuotes.count(), 2);
      assert.equal(await panelQuotes.first().innerText(), `“${longQuote}”`);
      assert.equal(await panelQuotes.nth(1).innerText(), `“${wrappedQuote}”`);
      const panel = await dialog.evaluate(node => ({ width: node.clientWidth, overflow: node.scrollWidth - node.clientWidth }));
      assert(panel.overflow <= 1, `Evidence dialog overflows at ${width}px`);
      await panelQuotes.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `dialog-${width}.png`) });
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Inspect evidence for citation S1");
      assert.deepEqual(errors, []); assert.deepEqual(attemptedExternalRequests, []);
      const requests = await page.evaluate(() => (window as unknown as { syntheticRequests: { url: string; method: string }[] }).syntheticRequests);
      assert(requests.every(request => request.method === "GET"), "Excerpt inspection submits no research, payment or feedback mutation");
      results.push({ width, quoteViews: 6, storedExcerptInstances: displayed.length + 2, target, panel, pageErrors: errors, externalRequests: attemptedExternalRequests });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(join(output, "validation.json"), JSON.stringify({ synthetic: true, modelCalls: 0, paymentCalls: 0, results }, null, 2));
console.log(`PASS: stored excerpts in six views at ${results.length} widths, no horizontal quote overflow, exact whitespace/literal text, 44px target and keyboard focus return.`);
