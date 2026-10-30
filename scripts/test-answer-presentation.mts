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
import { applyEvidenceReview } from "../lib/llm/evidence-review";
import { languageReviewedProposals } from "../lib/research/answer-language-review";
import { finalizeAnswerLanguage } from "../lib/research/answer-language-provenance";
import { nativeAnswerCopy } from "../lib/research/native-answer-copy";
import type { AdditionalAnswerLanguage } from "../lib/research/native-answer-intent";

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
const frenchSentences = ["Submit envoie les données au serveur.", "Sans type, submit est la valeur par défaut.",
  "Reset rétablit les valeurs initiales des contrôles.", "Button n'a aucun comportement par défaut."];
const frenchProposals = applyEvidenceReview(proposals.map((proposal, index) => ({ ...proposal, statement: frenchSentences[index] })),
  { reviews: proposals.map((_proposal, index) => ({ index, support: 0.9, statementSupport: 0.9, statementLanguage: "fr" })) },
  new Set(proposals.map((_proposal, index) => index)), true);
const frenchStatements = selectCitedStatements(languageReviewedProposals(frenchProposals, "fr"), ledger);
const frenchAnswer = finalizeGroundedAnswer({ question: "Répondez en français. Write three short bullets explaining the types and default.",
  answer: "Withheld draft [S1]", ledger, statements: frenchStatements,
  presentation: answerPresentation("Répondez en français. Write three short bullets explaining the types and default.") });
const frenchPacket = finalizeAnswerLanguage({ answer: frenchAnswer, rendererLanguage: "fr", statements: frenchStatements, proposals: frenchProposals });
assert(frenchPacket?.language === "fr" && frenchPacket.method === "reviewed-statements-and-renderer");
const chineseSentences = ["Submit 将表单数据发送到服务器。", "未设置 type 时，默认行为是 submit。",
  "Reset 将控件恢复为初始值。", "Button 本身没有默认行为。"];
const chineseProposals = applyEvidenceReview(proposals.map((proposal, index) => ({ ...proposal, statement: chineseSentences[index] })),
  { reviews: proposals.map((_proposal, index) => ({ index, support: 0.9, statementSupport: 0.9, statementLanguage: "zh-Hans" })) },
  new Set(proposals.map((_proposal, index) => index)), true);
const chineseStatements = selectCitedStatements(languageReviewedProposals(chineseProposals, "zh-Hans"), ledger);
const chineseQuestion = "请用简体中文回答。Write three short bullets explaining the types and default.";
const chineseAnswer = finalizeGroundedAnswer({ question: chineseQuestion, answer: "Withheld draft [S1]", ledger,
  statements: chineseStatements, presentation: answerPresentation(chineseQuestion) });
const chinesePacket = finalizeAnswerLanguage({ answer: chineseAnswer, rendererLanguage: "zh-Hans", statements: chineseStatements, proposals: chineseProposals });
assert(chinesePacket?.language === "zh-Hans" && chinesePacket.method === "reviewed-statements-and-renderer");
const nativeSentences = {
  ru: ["Submit отправляет данные формы на сервер.", "Если type не указан, по умолчанию используется submit.",
    "Reset возвращает элементам управления исходные значения.", "У Button нет поведения по умолчанию."],
  de: ["Submit sendet die Formulardaten an den Server.", "Ohne type ist submit die Voreinstellung.",
    "Reset setzt die Steuerelemente auf ihre Anfangswerte zurück.", "Button besitzt kein Standardverhalten."],
  ja: ["Submit はフォームのデータをサーバーへ送信します。", "type が未指定の場合、submit が既定値です。",
    "Reset はコントロールを初期値に戻します。", "Button 自体には既定の動作がありません。"],
  ko: ["Submit은 양식 데이터를 서버로 전송합니다.", "type을 지정하지 않으면 기본값은 submit입니다.",
    "Reset은 컨트롤을 초기값으로 되돌립니다.", "Button에는 기본 동작이 없습니다."],
  hi: ["Submit फ़ॉर्म का डेटा सर्वर को भेजता है।", "type नहीं दिए जाने पर submit डिफ़ॉल्ट होता है।",
    "Reset नियंत्रणों को उनके प्रारंभिक मानों पर लौटाता है।", "Button का कोई डिफ़ॉल्ट व्यवहार नहीं होता है।"],
  id: ["Submit mengirim data formulir ke server.", "Tanpa type, perilaku bawaan adalah submit.",
    "Reset mengembalikan kontrol ke nilai awalnya.", "Button tidak memiliki perilaku bawaan."],
} as const;
const nativeDirectives = { de: "Antworte bitte auf Deutsch.", ja: "日本語で回答してください。", ko: "한국어로 답변해 주세요.",
  hi: "कृपया हिंदी में उत्तर दें।", id: "Tolong jawab dalam bahasa Indonesia.", ru: "Ответьте по-русски." } as const;
const nativeScenarios = (["de", "ja", "ko", "hi", "id", "ru"] as const satisfies readonly AdditionalAnswerLanguage[]).map(language => {
  const statements = nativeSentences[language];
  const rows = applyEvidenceReview(proposals.map((proposal, index) => ({ ...proposal, statement: statements[index] })),
    { reviews: proposals.map((_proposal, index) => ({ index, support: 0.9, statementSupport: 0.9, statementLanguage: language })) },
    new Set(proposals.map((_proposal, index) => index)), true);
  const selected = selectCitedStatements(languageReviewedProposals(rows, language), ledger);
  const original = nativeDirectives[language] + " Write three short bullets explaining the types and default.";
  const presentation = answerPresentation(original);
  assert.equal(presentation.requestedLanguage, language); assert.equal(selected.length, 4);
  const rendered = finalizeGroundedAnswer({ question: original, answer: "Withheld draft [S1]", ledger, statements: selected, presentation });
  const packet = finalizeAnswerLanguage({ answer: rendered, rendererLanguage: language, statements: selected, proposals: rows });
  assert(packet?.language === language && packet.method === "reviewed-statements-and-renderer");
  return { name: `synthetic-${language}-reviewed`, answer: rendered, sentences: statements, quotes, citations: 3,
    language: packet.language, pairs: selected.map(row => ({ text: row.text, quote: row.quote })), sourceId: "fixture", sourceName: "Synthetic source" };
});
const chunks = path.resolve(process.env.NEXT_DIST_DIR ?? ".next", "static/chunks");
const css = readdirSync(chunks).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(chunks, file), "utf8")).join("\n");
assert(css.includes(".list-disc"), "Build current production CSS before this acceptance check");
const artifacts = path.resolve(process.env.KERYX_ARTIFACT_DIR ?? ".artifacts");
mkdirSync(artifacts, { recursive: true });
const replay = mdnModelReplay();
const scenarios = [{ name: "synthetic", answer, sentences, quotes, citations: 3, language: undefined,
  pairs: sentences.map((text, index) => ({ text, quote: quotes[Math.max(0, index - 1)] })), sourceId: "fixture", sourceName: "Synthetic source" },
  { name: "retained-mdn", ...replay, pairs: replay.statements, citations: 5, language: undefined,
    sourceId: "retained-mdn", sourceName: "mozilla.org" },
  { name: "synthetic-fr-reviewed", answer: frenchAnswer, sentences: frenchSentences, quotes, citations: 3, language: frenchPacket.language,
    pairs: frenchStatements.map(row => ({ text: row.text, quote: row.quote })), sourceId: "fixture", sourceName: "Synthetic source" },
  { name: "synthetic-zh-reviewed", answer: chineseAnswer, sentences: chineseSentences, quotes, citations: 3, language: chinesePacket.language,
    pairs: chineseStatements.map(row => ({ text: row.text, quote: row.quote })), sourceId: "fixture", sourceName: "Synthetic source" }, ...nativeScenarios];
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of scenarios) {
    const scenarioBundle = await build({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AnswerMarkdown} from './components/keryx/answer-markdown';
window.citationClicks = [];
createRoot(document.getElementById('root')).render(<AnswerMarkdown text={${JSON.stringify(scenario.answer)}} language={${JSON.stringify(scenario.language)}} citations={[{marker:'S1',sourceId:${JSON.stringify(scenario.sourceId)},sourceName:${JSON.stringify(scenario.sourceName)},weight:1,reward:0,rationale:'local acceptance fixture'}]} onCitationClick={(marker,button)=>window.citationClicks.push({marker,focused:document.activeElement===button})} />);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
  for (const width of [320, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      if (route.request().url() === "https://answer-presentation.test/")
        return route.fulfill({ contentType: "text/html", body: `<style>${css}</style><main id="root" style="max-width:800px;margin:auto;padding:16px"></main>` });
      externalRequests.push(route.request().url()); return route.abort();
    });
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
    if (scenario.language) {
      assert.equal(await page.locator(`main > div[lang="${scenario.language}"]`).count(), 1);
      assert.equal(await page.locator('main bdi[lang="und"][dir="auto"]').count(), 3);
      const originals = await page.locator('main bdi[lang="und"][dir="auto"]').allTextContents();
      assert.deepEqual(originals, quotes.map(quote => `“${quote}”`));
      const sourceLabel = nativeAnswerCopy(scenario.language)?.source ?? (scenario.language === "fr" ? "Texte de la source" : "来源原文");
      assert((await page.locator("main").innerText()).includes(sourceLabel));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    await page.screenshot({ path: path.join(artifacts, `answer-presentation-${scenario.name}-${width}.png`), fullPage: true });
    results.push({ scenario: scenario.name, width, language: scenario.language ?? "und", pairedOriginalsPreserved: true,
      keyboardCitation: true, overflow: false, pageErrors: errors, externalRequests });
    await page.close();
  }
  }
  console.log("PASS: synthetic and retained MDN model-output replay, four-target/three-item delivery, semantic lists, every paired excerpt, keyboard citations and viewport bounds at320/1366 with production CSS. No new model call, production usefulness or payment claim.");
  console.log(JSON.stringify({ synthetic: true, modelCalls: 0, paymentCalls: 0, results }));
} finally { await browser.close(); }
