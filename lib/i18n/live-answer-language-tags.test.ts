import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { sha256, stringToHex } from "viem";
import { expect, it } from "vitest";
import { ResearchTurn } from "@/components/keryx/research-turn";
import type { AskStreamState } from "@/lib/hooks/use-ask-stream";
import type { QueryRun } from "@/lib/types";
import { recordedAnswerLanguage } from "@/lib/research/answer-language-provenance";
import { canonicalPresentationLanguages, type PresentationLanguage } from "@/shared/i18n/presentation-language";
import { UiCopyContext, englishUiCopy } from "./ui-copy-context";
import { createMessages } from "./messages";
import { createRichMessages } from "./rich-messages";
import { loadUiPreview } from "./ui-preview-catalogues";

const answers: Record<PresentationLanguage, string> = {
  ar: "هذه إجابة محفوظة باللغة العربية.",
  en: "A recorded English answer.", vi: "Đây là câu trả lời tiếng Việt đã lưu.",
  pt: "Esta é uma resposta em português.", es: "Esta es una respuesta en español.",
  fr: "Voici une réponse en français.", "zh-Hans": "这是一条已保存的中文回答。",
  de: "Dies ist eine gespeicherte Antwort auf Deutsch.", ja: "これは保存された日本語の回答です。",
  ko: "저장된 한국어 답변입니다.", hi: "यह सहेजा गया हिंदी उत्तर है।", id: "Ini jawaban bahasa Indonesia yang tersimpan.",
  ru: "Это сохранённый ответ на русском языке.",
};

// Synthetic retained transport records, never invoke the producer or its finalizer.
function retainedRun(language: PresentationLanguage = "ja"): QueryRun {
  const answer = answers[language];
  return { id: "11111111-2222-4333-8444-555555555555", createdAt: "2026-10-29T00:00:00Z", engine: "Synthetic renderer",
    question: "Ask a question <literal> {count} USDC\n日本語", answer, budget: 0.05, totalSpent: 0, totalToCreators: 0,
    subClaims: [], decisions: [], citations: [], trace: [{ phase: "done", ts: 0, message: "Synthetic retained terminal packet",
      detail: { answerLanguage: { format: "keryx-answer-language-v1", scope: "generated-prose", language,
        method: "deterministic-renderer", answerSha256: sha256(stringToHex(answer)) } } }] };
}
const packet = (run: QueryRun) => (run.trace[0].detail as { answerLanguage: Record<string, unknown> }).answerLanguage;

async function renderLive(run: QueryRun, locale: "fr" | "ja" = "fr") {
  const preview = await loadUiPreview(locale);
  const state: AskStreamState = { status: "done", meta: { engine: run.engine, mode: "offline" }, budget: run.budget,
    steps: run.trace, decisions: [], citations: run.citations, payments: [], run, error: null, errorKind: null, retryAfter: null };
  const html = renderToStaticMarkup(React.createElement(UiCopyContext.Provider, { value: { ...englishUiCopy, locale, preview,
    message: createMessages(locale, preview.$messages), richMessage: createRichMessages(locale, preview.$messages) } },
  React.createElement(ResearchTurn, { turn: { id: 1, question: run.question, payer: "Synthetic payer", state } })));
  const document = new JSDOM(`<main lang="${locale}">${html}</main>`).window.document;
  const original = Array.from(document.querySelectorAll("p")).find(element => element.textContent === run.answer);
  expect(original, "The exact original answer must remain in the actual live renderer").toBeTruthy();
  return { document, language: original!.closest("[lang]")!.getAttribute("lang") };
}

it.each(canonicalPresentationLanguages)("uses the strict recorded %s language for the completed live answer, independently of UI choice", async language => {
  const run = retainedRun(language), before = JSON.stringify(run);
  expect(recordedAnswerLanguage(run)).toBe(language);
  const rendered = await renderLive(run, language === "fr" ? "ja" : "fr");
  expect(rendered.language).toBe(language);
  expect(Array.from(rendered.document.querySelectorAll("p")).some(element => element.textContent === run.question)).toBe(true);
  expect(rendered.document.body.textContent).toContain("0 USDC settled of 0.05 cap");
  expect(JSON.stringify(run)).toBe(before);
});

it.each([
  ["absent packet", (run: QueryRun) => { run.trace = []; }],
  ["duplicate packet", (run: QueryRun) => { run.trace.push(structuredClone(run.trace[0])); }],
  ["changed answer bytes", (run: QueryRun) => { run.answer += " Changed."; }],
  ["invalid digest", (run: QueryRun) => { packet(run).answerSha256 = `0x${"0".repeat(64)}`; }],
  ["request alias", (run: QueryRun) => { packet(run).language = "pt-BR"; }],
  ["regional alias", (run: QueryRun) => { packet(run).language = "ja-JP"; }],
  ["unknown language", (run: QueryRun) => { packet(run).language = "fa"; }],
  ["future format", (run: QueryRun) => { packet(run).format = "keryx-answer-language-v2"; }],
  ["unknown method", (run: QueryRun) => { packet(run).method = "requested-language"; }],
  ["wrong scope", (run: QueryRun) => { packet(run).scope = "whole-report"; }],
  ["extra packet field", (run: QueryRun) => { packet(run).approved = true; }],
  ["nonterminal packet", (run: QueryRun) => { run.trace[0].phase = "discover"; }],
] as const)("keeps the completed live prose unknown for %s", async (_name, alter) => {
  const run = retainedRun(); alter(run); const before = JSON.stringify(run);
  expect((await renderLive(run, "ja")).language).toBe("und");
  expect(JSON.stringify(run)).toBe(before);
});

it("does not infer proof from the question or selected interface language", async () => {
  const run = retainedRun(); run.trace = []; run.question = "Answer in Japanese. 日本語で回答してください。";
  expect((await renderLive(run, "ja")).language).toBe("und");
});

it("drops the live prose language after the existing synthetic-evidence projection changes its final bytes", async () => {
  const run = retainedRun(); run.citations = [{ marker: "S1", sourceId: "synthetic-source", sourceName: "Synthetic fixture source",
    weight: 1, reward: 0, rationale: "Original rationale", evidenceProvenance: "synthetic-demo" }];
  const before = JSON.stringify(run); expect(recordedAnswerLanguage(run)).toBe("ja");
  const rendered = await renderLive(run);
  expect(rendered.language).toBe("und");
  expect(rendered.document.body.textContent).toContain("Illustrative demo content");
  expect(JSON.stringify(run)).toBe(before);
});
