/** Real hook and research turn; synthetic SSE only, all external requests blocked. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SQLITE_SELECTION_QUESTION } from "../test-support/sqlite-selection-fixture";
import type { SelectionDiagnostic } from "../lib/research/selection-diagnostic";
import type { Decision } from "../lib/types";

const diagnostic: SelectionDiagnostic = {
  protocol: "keryx-source-selection-v1", id: "c12f7f67-2208-4f9d-ab28-f136ae55e61d",
  createdAt: "2026-10-05T00:00:00.000Z", stage: "decide", outcome: "refused",
  counts: { candidateCount: 10, targetCount: 8, decisionCount: 10, matchedCandidateCount: 10,
    validActionableCount: 0, withheldCandidateCount: 10, invalidRowCount: 10 },
  reasons: [{ code: "target_out_of_range", rowIndex: 0, candidateIndex: 0 },
    { code: "missing_targets", rowIndex: 1, candidateIndex: 1 }], truncated: true,
};
const decisions: Decision[] = ["BUY", "CACHE", "SKIP"].map((action, index) => ({
  sourceId: `fixture-${index}`, sourceName: `Source ${action}`, action: action as Decision["action"],
  expectedValue: 0.8, price: 0.01, confidence: 0.7, rationale: `Reason for ${action}`, targets: action === "SKIP" ? [] : [0],
}));
const partial: SelectionDiagnostic = { ...diagnostic, outcome: "partial", counts: { ...diagnostic.counts,
  validActionableCount: 3, withheldCandidateCount: 7, invalidRowCount: 7 } };
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {useAskStream} from './lib/hooks/use-ask-stream';
    import {ResearchTurn} from './components/keryx/research-turn';
    const question = ${JSON.stringify(SQLITE_SELECTION_QUESTION)};
    function Probe() {
      const {state,ask} = useAskStream();
      return <><button onClick={()=>ask(question,0)}>Submit synthetic question</button>
        <output data-testid="decision-count">{state.decisions.length}</output>
        <ResearchTurn turn={{id:1,question,payer:'offline fixture',state}} /></>;
    }
    createRoot(document.getElementById('root')).render(<Probe/>);
  `, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_KERYX_NETWORK": '"arcTestnet"',
    "process.env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS": "undefined", "process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS": "undefined" },
});
const screenshots = process.env.KERYX_UX_SCREENSHOT_DIR ?? join(tmpdir(), "keryx-selection-failure");
await mkdir(screenshots, { recursive: true });
const cssRoot = process.env.KERYX_TRACE_CSS_DIR ?? join(process.cwd(), ".next/static");
const cssFiles = (await readdir(cssRoot, { recursive: true })).filter(file => file.endsWith(".css"));
assert(cssFiles.length > 0, "The real trace fixture requires production CSS");
const css = (await Promise.all(cssFiles.map(file => readFile(join(cssRoot, file), "utf8")))).join("\n");
const browser = await chromium.launch({ headless: true });
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
try {
  for (const width of [320, 1366]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const errors: string[] = [];
    let asks = 0;
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, "https://selection-failure.invalid", "No external service may be contacted");
      if (url.pathname === "/api/ask") {
        assert.equal(request.method(), "POST");
        assert.equal(request.postDataJSON().question, SQLITE_SELECTION_QUESTION);
        assert.equal(request.postDataJSON().budget, 0);
        asks++;
        if (asks === 3) return route.fulfill({ contentType: "text/event-stream", body:
          frame("meta", { mode: "offline", engine: "synthetic-selection" }) +
          frame("step", { phase: "decide", message: "Some proposals were withheld. Valid choices continue.", detail: partial, ts: 1 }) +
          decisions.map((detail, index) => frame("step", { phase: "decide", message: detail.rationale, detail, ts: index + 2 })).join("") +
          frame("error", { message: "Synthetic stream stops after decisions; no report or payment." }) });
        const current = asks === 1 ? { ...diagnostic, rawProviderPayload: "PRIVATE_PROVIDER_BODY" }
          : { ...diagnostic, counts: { ...diagnostic.counts, targetCount: "8" } };
        return route.fulfill({ contentType: "text/event-stream", body:
          frame("meta", { mode: "offline", engine: "synthetic-selection" }) +
          frame("step", { phase: "decide", message: "Synthetic invalid source selection", detail: current, ts: 1 }) +
          frame("error", { message: "Synthetic source selection refused; no automatic retry.", selectionDiagnostic: current }) });
      }
      assert.equal(request.method(), "GET", "No signing or payment route is permitted");
      return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://selection-failure.invalid/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "Submit synthetic question" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(asks, 1);
    await page.getByText(/Decision log and payments/).click();
    const log = page.locator("details");
    await log.getByText("Synthetic invalid source selection", { exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `selection-trace-${width}.png`), fullPage: true });
    assert(!(await log.textContent())?.includes("NaN"), "A diagnostic must not render as a source decision with NaN EV");
    assert.equal(await page.getByTestId("decision-count").textContent(), "0");
    assert.equal(await log.getByText("Source selection refused", { exact: true }).count(), 1);
    assert((await log.textContent())?.includes("10 withheld"));
    assert((await log.textContent())?.includes("target_out_of_range"));
    assert.equal(await page.getByRole("button", { name: "Download report", exact: true }).count(), 0);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download failure diagnostic", exact: true }).click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), `keryx-source-selection-failure-${diagnostic.id}.json`);
    const text = await readFile((await download.path())!, "utf8");
    const artifact = JSON.parse(text);
    assert.equal(artifact.outcome, "failed");
    assert.deepEqual(artifact.selectionDiagnostic, diagnostic);
    assert(!text.includes("PRIVATE_PROVIDER_BODY"));
    assert(!text.includes(SQLITE_SELECTION_QUESTION));
    assert(!("answer" in artifact) && !("paymentReceipt" in artifact));
    assert.equal(asks, 1, "Downloading must not resubmit or contact a provider");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(screenshots, `selection-failure-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Submit synthetic question" }).click();
    await page.getByRole("alert").waitFor();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(button => button.textContent?.includes('Download failure diagnostic')));
    assert.equal(asks, 2, "Exactly one call for each explicit synthetic submission");
    assert.equal(await page.getByTestId("decision-count").textContent(), "0");
    await page.getByRole("button", { name: "Submit synthetic question" }).click();
    await page.getByText("Synthetic stream stops after decisions; no report or payment.").waitFor();
    assert.equal(await page.getByTestId("decision-count").textContent(), "3");
    await log.getByText("Some proposals were withheld. Valid choices continue.", { exact: true }).waitFor();
    assert.equal(await log.getByText("Source selection partially withheld", { exact: true }).count(), 1);
    for (const decision of decisions) {
      assert.equal(await log.getByText(decision.sourceName, { exact: true }).count(), 1);
      assert.equal(await log.getByText(decision.rationale, { exact: true }).count(), 1);
    }
    assert(!(await log.textContent())?.includes("NaN"));
    assert.equal(await page.getByRole("button", { name: "Download failure diagnostic", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Download report", exact: true }).count(), 0);
    assert.equal(asks, 3);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log("Source-selection refusal: real hook/render/download, strict diagnostics, no automatic retry or external requests PASS");
