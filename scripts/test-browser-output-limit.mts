/** Actual answer component and built CSS; intercepted synthetic GETs only. No research/payment/database. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";

const directory = join(process.cwd(), ".next", "static", "chunks");
const cssFiles = (await readdir(directory)).filter(file => file.endsWith(".css"));
assert(cssFiles.length > 0, "Build the exact candidate before browser verification");
const css = (await Promise.all(cssFiles.map(file => readFile(join(directory, file), "utf8")))).join("\n");
const screenshots = process.env.KERYX_OUTPUT_LIMIT_SCREENSHOT_DIR ?? join(process.cwd(), ".artifacts", "output-limit-ux");
await mkdir(screenshots, { recursive: true });
const fixture = { id: "synthetic-output-limit", question: "So sánh hai nguồn tài liệu với các điều kiện đồng thời.", budget: 0,
  engine: "llm:synthetic", answer: "The requested result remains incomplete. Original evidence is retained.",
  decisions: [], citations: [], totalSpent: 0, totalToCreators: 0, createdAt: "2026-10-08T00:00:00Z", paymentMode: "offline", trace: [],
  reasoningAttempts: [{ step: "synthesize", engine: "llm:synthetic", tier: 0, attempt: 1, startedAt: 1, durationMs: 0,
    outcome: "failed", error: "output_validation", outputTokenLimit: 2560 }] };
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AnswerCard}from'./components/keryx/answer-card';
  const root=createRoot(document.getElementById('root'));window.renderFixture=run=>root.render(<AnswerCard run={run} meta={null}/>);`,
  loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const errors: string[] = [], calls: string[] = [];
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url()); calls.push(url.pathname);
      assert.equal(request.method(), "GET"); assert.equal(url.origin, "https://output-limit.test");
      if (url.pathname === "/api/feedback") return route.fulfill({ contentType: "application/json", body: '{"up":0,"down":0}' });
      if (url.pathname !== "/") return route.abort();
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><main id="root" style="max-width:1100px;margin:auto;padding:16px"></main></body></html>' });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://output-limit.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    assert.deepEqual(errors, [], "Component bundle must initialize without browser errors");
    const render = (run: object) => page.evaluate(value => (window as unknown as { renderFixture(run: object): void }).renderFixture(value), run);
    await render(fixture);
    const notice = page.getByTestId("model-output-limit");
    await notice.waitFor(); assert.match(await notice.innerText(), /2,560 tokens/); assert.match(await notice.innerText(), /thu hẹp câu hỏi/);
    assert.equal(await notice.getAttribute("role"), "status");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `vi-${width}.png`), fullPage: true });
    await render({ ...fixture, question: "Compare both sources.", reasoningAttempts: undefined,
      trace: [{ phase: "synthesize", ts: 1, message: "Fixed diagnostic", detail: { reasoningOutputLimit: { stage: "review", outputTokenLimit: 4096, body: "PRIVATE" } } }] });
    await page.getByTestId("model-output-limit").filter({ hasText: "evidence review" }).waitFor();
    assert.match(await notice.innerText(), /4,096 tokens/); assert(!((await notice.innerText()).includes("PRIVATE")));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `en-review-${width}.png`), fullPage: true });
    await render({ ...fixture, question: "Historical output failure", reasoningAttempts: [{ ...fixture.reasoningAttempts[0], outputTokenLimit: undefined, status: 503 }] });
    await notice.waitFor({ state: "detached" });
    await render({ ...fixture, reasoningAttempts: undefined, trace: [{ phase: "synthesize", detail: { reasoningOutputLimit: { stage: "review", outputTokenLimit: -1 } } }] });
    await page.waitForFunction(() => !document.querySelector('[data-testid="model-output-limit"]'));
    assert.deepEqual(errors, []); assert(!calls.some(path => path.startsWith("/api/") && path !== "/api/feedback"));
    console.log(JSON.stringify({ width, englishReview: true, vietnameseGeneration: true, historicalAndMalformedSuppressed: true, onlySyntheticFeedbackGet: true }));
    await context.close();
  }
} finally { await browser.close(); }
