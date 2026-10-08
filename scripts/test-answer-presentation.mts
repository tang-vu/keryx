/** Actual shared answer renderer with production CSS; synthetic evidence, no network or spending. */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { answerPresentation } from "../lib/research/answer-presentation";
import { buildEvidenceLedger } from "../lib/agent/evidence-ledger";
import { selectCitedStatements } from "../lib/agent/cited-statements";
import { finalizeGroundedAnswer } from "../lib/agent/answer-grounding";

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
const bundle = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AnswerMarkdown} from './components/keryx/answer-markdown';
window.citationClicks = [];
createRoot(document.getElementById('root')).render(<AnswerMarkdown text={${JSON.stringify(answer)}} citations={[{marker:'S1',sourceId:'fixture',sourceName:'Synthetic source',weight:1,reward:0,rationale:'fixture'}]} onCitationClick={(marker,button)=>window.citationClicks.push({marker,focused:document.activeElement===button})} />);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
const artifacts = path.resolve(".artifacts");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<style>${css}</style><main id="root" style="max-width:800px;margin:auto;padding:16px"></main>` }));
    await page.goto("https://answer-presentation.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("list").waitFor();
    assert.equal(await page.getByRole("list").count(), 1);
    assert.equal(await page.getByRole("listitem").count(), 3);
    for (const sentence of sentences) assert((await page.locator("main").innerText()).includes(sentence));
    for (const quote of quotes) assert((await page.locator("main").innerText()).includes(quote));
    assert.equal(await page.getByRole("button").count(), 3);
    const first = page.getByRole("button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { citationClicks: unknown[] }).citationClicks), [{ marker: "S1", focused: true }]);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Answer must fit the viewport");
    const firstText = await page.getByRole("listitem").first().innerText();
    assert(firstText.includes(sentences[0]) && firstText.includes(sentences[1]) && firstText.includes(quotes[0]));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifacts, `answer-presentation-${width}.png`), fullPage: true });
    await page.close();
  }
  console.log("PASS: ordinary four-fact/three-item delivery, semantic lists, exact paired excerpts, keyboard citations and viewport bounds at 320/1366 with production CSS. Synthetic fixture; no live usefulness or payment claim.");
} finally { await browser.close(); }
