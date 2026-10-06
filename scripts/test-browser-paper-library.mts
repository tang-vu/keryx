/** Real bibliography components with synthetic HTTP; no repository, wallet, model or payment. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { groupPaperWorks } from "../lib/papers/work-groups";
import type { PaperRecord } from "../lib/papers/types";

const paper: PaperRecord = { title: "A synthetic <paper> & its original version", authors: ["Literal Author"],
  authorCount: 1, authorsTruncated: false, publishedYear: 2024, repository: "arxiv", arxivId: "2601.12345v1",
  url: "https://arxiv.org/abs/2601.12345v1", metadataUrl: "https://export.arxiv.org/api/query?id_list=2601.12345v1",
  metadataObservedAt: "2026-10-06T00:00:00.000Z", publicationKind: "preprint", peerReview: "unknown" };
const payload = { version: 1, scope: "bibliography-only", groups: groupPaperWorks([paper]), totalWorks: 1, catalogRecords: 0,
  providers: [{ name: "arxiv", status: "available", records: 1 }, { name: "crossref", status: "unavailable", records: 0 }] };
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PaperSearchPanel}from'./components/keryx/paper-search-panel';
    createRoot(document.getElementById('root')).render(<PaperSearchPanel author="Literal Author" year="2024"/>);`, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "plain-link-fixture", setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children)}", loader: "jsx", resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let mode: "success" | "busy" | "slow" | "invalid" = "success", release: (() => void) | undefined;
    const requests: URL[] = [], errors: string[] = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, "https://paper.test", "No external provider or wallet requests");
      assert.equal(route.request().method(), "GET");
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><style>*{box-sizing:border-box}body{margin:12px}input{width:100%;max-width:100%}article,section,a{overflow-wrap:anywhere}</style><main id="root"></main>' });
      assert.equal(url.pathname, "/api/papers"); requests.push(url);
      if (mode === "slow") await new Promise<void>(resolve => { release = resolve; });
      try { await route.fulfill(mode === "busy" ? { status: 429, json: { error: "busy" } }
        : { json: mode === "invalid" ? { ...payload, groups: [{ ...payload.groups[0], record: { ...paper, url: "javascript:alert(1)" } }] } : payload }); }
      catch { /* Cancelled browser transport is expected. */ }
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://paper.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const query = page.locator('[name="query"]'), submit = page.getByRole("button", { name: "Search repositories" });
    await submit.waitFor(); assert.equal(requests.length, 0);
    await query.fill("agents"); await submit.click();
    await page.getByText(paper.title, { exact: true }).waitFor();
    assert.equal(requests.length, 1); assert.equal(requests[0].searchParams.get("search"), "1");
    assert.equal(requests[0].searchParams.get("author"), "Literal Author"); assert.equal(requests[0].searchParams.get("year"), "2024");
    await page.getByText(/Crossref: temporarily unavailable/).waitFor();
    const ask = await page.getByRole("link", { name: "Ask with this paper" }).getAttribute("href");
    assert(ask); assert.equal(new URL(ask, "https://paper.test").searchParams.has("run"), false);
    mode = "busy"; await submit.click(); await page.getByText(/Wait a minute/).waitFor();
    assert.equal(await page.getByText(paper.title, { exact: true }).count(), 0);
    mode = "success"; const longDoi = `10.1234/${"a".repeat(150)}`; await query.fill(longDoi); await submit.click();
    await page.getByText(paper.title, { exact: true }).waitFor();
    assert.equal(requests.at(-1)?.searchParams.get("doi"), longDoi); assert.equal(requests.at(-1)?.searchParams.has("q"), false);
    mode = "slow"; await query.fill("cancel this search"); await submit.click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click(); release?.();
    await submit.waitFor(); assert.equal(await page.getByText(paper.title, { exact: true }).count(), 0);
    mode = "invalid"; await submit.click(); await page.getByText("Paper search returned an unsupported response.").waitFor();
    assert.deepEqual(errors, []); await context.close();
  }
  console.log("PASS: explicit metadata admission, provider failure, long DOI, cancellation, stale-result clearing and schema refusal at 320px/1440px; no external/payment requests.");
} finally { await browser.close(); }
