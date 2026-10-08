/** Shared renderer with production CSS; synthetic and retained model replay, no new calls. */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { answerPresentation } from "../lib/research/answer-presentation";
import { buildEvidenceLedger } from "../lib/agent/evidence-ledger";
import { selectCitedStatements } from "../lib/agent/cited-statements";
import { finalizeGroundedAnswer } from "../lib/agent/answer-grounding";
import { mdnModelReplay } from "../lib/agent/fixtures/mdn-model-replay";

const question = "Em português brasileiro, escreva três tópicos curtos explicando os tipos e o padrão.";
const quotes = ["submit: O botão envia os dados ao servidor. Esse é o padrão sem o atributo type.",
  "reset: O botão restaura os valores iniciais dos controles.", "button: O botão não possui comportamento padrão."];
const sentences = ["Submit envia os dados ao servidor.", "Sem type, submit é o padrão.",
  "Reset restaura os valores iniciais dos controles.", "Button não tem comportamento padrão."];
const text = quotes.join("\n");
const proposals = sentences.map((statement, claimIndex) => {
  const quote = quotes[Math.max(0, claimIndex - 1)];
  return { claimIndex, marker: "S1", quote, statement, statementSupport: 0.9, support: 0.9,
    quoteSpan: { start: text.indexOf(quote), end: text.indexOf(quote) + quote.length } };
});
const ledger = buildEvidenceLedger({ subClaims: ["Submit", "Default", "Reset", "Button"],
  gathered: [{ sourceId: "fixture", sourceName: "Synthetic source", marker: "S1", text }],
  answer: "Withheld draft [S1]", declaredMarkers: ["S1"], proposedEvidence: proposals,
  finalAssessment: ["Submit", "Default", "Reset", "Button"].map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
const answer = finalizeGroundedAnswer({ question, answer: "Withheld draft [S1]", ledger,
  statements: selectCitedStatements(proposals, ledger), presentation: answerPresentation(question) });
assert.equal(answer.match(/^- /gm)?.length, 3);
const chunks = path.resolve(process.env.NEXT_DIST_DIR ?? ".next", "static/chunks");
const css = readdirSync(chunks).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(chunks, file), "utf8")).join("\n");
assert(css.includes(".list-disc"), "Build current production CSS before this acceptance check");
const artifacts = path.resolve(".artifacts");
mkdirSync(artifacts, { recursive: true });
const replay = mdnModelReplay();
const scenarios = [{ name: "synthetic", answer, sentences, quotes, citations: 3,
  pairs: sentences.map((text, index) => ({ text, quote: quotes[Math.max(0, index - 1)] })), sourceId: "fixture", sourceName: "Synthetic source" },
  { name: "retained-mdn", ...replay, pairs: replay.statements, citations: 5,
    sourceId: "retained-mdn", sourceName: "mozilla.org" }];
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of scenarios) {
    const scenarioBundle = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AnswerMarkdown} from './components/keryx/answer-markdown';
window.citationClicks = [];
createRoot(document.getElementById('root')).render(<AnswerMarkdown text={${JSON.stringify(scenario.answer)}} citations={[{marker:'S1',sourceId:${JSON.stringify(scenario.sourceId)},sourceName:${JSON.stringify(scenario.sourceName)},weight:1,reward:0,rationale:'local acceptance fixture'}]} onCitationClick={(marker,button)=>window.citationClicks.push({marker,focused:document.activeElement===button})} />);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
  for (const width of [320, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<style>${css}</style><main id="root" style="max-width:800px;margin:auto;padding:16px"></main>` }));
    await page.goto("https://answer-presentation.test/");
    await page.addScriptTag({ content: scenarioBundle.outputFiles[0].text });
    await page.getByRole("list").waitFor();
    assert.equal(await page.getByRole("list").count(), 1);
    assert.equal(await page.getByRole("listitem").count(), 3);
    for (const sentence of scenario.sentences) assert((await page.locator("main").innerText()).includes(sentence));
    for (const quote of scenario.quotes) assert((await page.locator("main").innerText()).includes(quote));
    for (const pair of scenario.pairs) {
      const item = page.getByRole("listitem").filter({ hasText: pair.text });
      assert.equal(await item.count(), 1);
      assert((await item.innerText()).includes(pair.quote));
    }
    assert.equal(await page.getByRole("button").count(), scenario.citations);
    const first = page.getByRole("button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { citationClicks: unknown[] }).citationClicks), [{ marker: "S1", focused: true }]);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Answer must fit the viewport");
    const firstText = await page.getByRole("listitem").first().innerText();
    assert(firstText.includes(scenario.sentences[0]) && firstText.includes(scenario.quotes[0]));
    if (scenario.name === "retained-mdn") assert(firstText.includes(scenario.sentences[4]));
    else assert(firstText.includes(scenario.sentences[1]));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifacts, `answer-presentation-${scenario.name}-${width}.png`), fullPage: true });
    await page.close();
  }
  }
  console.log("PASS: synthetic and retained MDN model-output replay, four-target/three-item delivery, semantic lists, every paired excerpt, keyboard citations and viewport bounds at320/1366 with production CSS. No new model call, production usefulness or payment claim.");
} finally { await browser.close(); }
