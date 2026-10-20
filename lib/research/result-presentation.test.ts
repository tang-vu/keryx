import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { buildAnswerContent, buildCompletion, keryxMeta } from "../openai-compat";
import { remoteResearchResult } from "../mcp/remote-server";
import { buildResearchReceipt } from "../research-receipt";
import { reasoningServingText } from "../llm/reasoning-telemetry";
import { API_SETTLEMENT_NOTICE, createStdioResearchHandler, presentationLocaleNotice, presentationReasoningText, remoteResearchText, stdioResearchText } from "./result-presentation";
import { livePresentationLocale } from "./presentation-language";
import { researchPresentationCatalogues } from "./presentation-messages";
import { presentationQuestions, presentationRun } from "./presentation.test-fixture";
import { config } from "../config";
import { finalizeAnswerLanguage } from "./answer-language-provenance";
const locales = ["en", "vi", "pt", "es"] as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

it.each(["en", "vi", "pt", "es"] as const)("%s actual stdio handler binds observed labels and discloses an override", async language => {
  const run = presentationRun(), queryId = "original-completed-query";
  const packet = { ...finalizeAnswerLanguage({ answer: run.answer, rendererLanguage: language, statements: [], proposals: [] })!, queryId };
  const result = { answer: run.answer, citations: [], totalToCreators: 0.000001, amountPaid: "0.100000",
    settlementId: "original-settlement", status: "completed", queryId, answerLanguage: packet };
  const before = hash(result), ask = vi.fn(async () => result);
  const handler = createStdioResearchHandler(ask, "https://example.invalid");
  const response = await handler({ question: presentationQuestions.en });
  const locale = livePresentationLocale({ recordedAnswerLanguage: language });
  expect(response.content[0].text).toBe(stdioResearchText(result, "https://example.invalid", locale));
  expect(response.structuredContent).toEqual(result);
  const override = language === "vi" ? "es" : "vi";
  const mismatch = await handler({ question: presentationQuestions.en, language: override });
  expect(mismatch.content[0].text).toContain(presentationLocaleNotice(livePresentationLocale({ requestedLanguage: override, recordedAnswerLanguage: language })));
  expect(mismatch.content[0].text.startsWith(run.answer)).toBe(true);
  expect(hash(result)).toBe(before);
  for (const invalid of [{ ...result, answer: result.answer + " " }, { ...result, queryId: "foreign" },
    { ...result, status: "queued" }, { ...result, answerLanguage: { ...packet, format: "future" } },
    { ...result, answerLanguage: [packet, packet] }, { ...result, answerLanguage: undefined }]) {
    const unknown = await createStdioResearchHandler(async () => invalid as typeof result, "https://example.invalid")({ question: presentationQuestions.en, language: "vi" });
    expect(unknown.structuredContent).not.toHaveProperty("answerLanguage");
    expect(unknown.content[0].text).toContain(presentationLocaleNotice(livePresentationLocale({ requestedLanguage: "vi" })));
    expect(unknown.content[0].text.startsWith(invalid.answer)).toBe(true);
  }
  expect(ask).toHaveBeenNthCalledWith(1, presentationQuestions.en, undefined);
});
afterEach(() => vi.restoreAllMocks());

it.each(locales)("%s API/remote/stdio labels preserve exact answer/excerpt, canonical money and receipt hashes", async language => {
  vi.spyOn(Date, "now").mockReturnValue(1_760_227_200_000);
  const run = presentationRun(), before = JSON.stringify(run), receipt = buildResearchReceipt(run, []), meta = keryxMeta(run);
  const result = remoteResearchResult(run), resultHash = hash(result), locale = livePresentationLocale({ requestedLanguage: language, originalQuestion: run.question });
  const completion = buildCompletion(run, "keryx", language), baseline = buildCompletion(run, "keryx");
  const withoutHumanContent = (value: typeof completion) => ({ ...value, choices: value.choices.map(choice => ({ ...choice,
    message: { ...choice.message, content: "human presentation excluded" } })) });
  expect(hash(withoutHumanContent(completion))).toBe(hash(withoutHumanContent(baseline)));
  expect(hash(completion.keryx)).toBe(hash(meta));
  expect(result.evidence[0].quote).toBe(run.evidence![0].quote);
  expect(completion.choices[0].message.content.startsWith(run.answer)).toBe(true);
  expect(completion.choices[0].message.content).toContain(researchPresentationCatalogues[language].citations);
  expect(completion.choices[0].message.content).toContain("$0.000001");
  expect(completion.choices[0].message.content).toContain(API_SETTLEMENT_NOTICE);
  expect(completion.choices[0].message.content).not.toContain("$0,000001");
  const remote = remoteResearchText(result, locale);
  expect(remote.startsWith(run.answer)).toBe(true);
  expect(remote).toContain(researchPresentationCatalogues[language].citations);
  expect(remote).toContain("$0.000001 USDC · offline payment simulation");
  expect(remote).toContain("Low"); // machine confidence enum is never translated
  const stdioResult = { ...result, totalToCreators: run.totalToCreators, amountPaid: "0.070001", settlementId: "circle-original-settlement" };
  const stdioBefore = hash(stdioResult), ask = vi.fn(async () => stdioResult);
  const response = await createStdioResearchHandler(ask, "https://example.invalid")({ question: run.question, budget: 0.000001, language });
  expect(ask).toHaveBeenCalledExactlyOnceWith(run.question, 0.000001);
  expect(response.content[0].text.startsWith(run.answer)).toBe(true);
  expect(response.content[0].text).toContain("Paid Keryx 0.070001 USDC (Circle Gateway settlement circle-origi…, batched on Arc)");
  expect(hash(response.structuredContent)).toBe(stdioBefore); expect(hash(stdioResult)).toBe(stdioBefore);
  expect(hash(result)).toBe(resultHash); expect(JSON.stringify(run)).toBe(before);
  expect(hash(buildResearchReceipt(run, []))).toBe(hash(receipt));
});
it.each(locales)("%s default question wrappers do not silently apply locale to the answer body", language => {
  const run = presentationRun(presentationQuestions[language]), locale = livePresentationLocale({ originalQuestion: run.question });
  const result = remoteResearchResult(run), api = buildAnswerContent(run), remote = remoteResearchText(result, locale);
  expect(locale.answerLanguage).toBe("UNKNOWN");
  expect(api.startsWith(run.answer)).toBe(true); expect(remote.startsWith(run.answer)).toBe(true);
  expect(api).toContain(researchPresentationCatalogues[language].citations);
  expect(remote).toContain(researchPresentationCatalogues[language].citations);
  expect(result.answer).toBe(run.answer); expect(result.evidence[0].quote).toBe(run.evidence![0].quote);
});
it("explicit unknown/mismatched context is disclosed; no translated-answer claim or hidden rewrite", () => {
  const unknown = livePresentationLocale({ requestedLanguage: "vi", originalQuestion: presentationQuestions.en });
  expect(presentationLocaleNotice(unknown)).toBe(researchPresentationCatalogues.vi.requestedUnknown.replace("{language}", "vi"));
  const mismatch = livePresentationLocale({ requestedLanguage: "vi", recordedAnswerLanguage: "es" });
  expect(presentationLocaleNotice(mismatch)).toContain("es"); expect(mismatch.agreement).toBe("MISMATCH");
  expect(presentationLocaleNotice(livePresentationLocale({ requestedLanguage: "fr" }))).toBe(researchPresentationCatalogues.en.unsupported);
  expect(presentationLocaleNotice(livePresentationLocale({ requestedLanguage: "vi", recordedAnswerLanguage: "vi" }))).toBe("");
});
it.each(locales)("%s output-limit/serving notices reuse bounded public records without exposing raw provider metadata", language => {
  const result = remoteResearchResult(presentationRun());
  result.outputLimits = [{ step: "synthesize", stage: "review", outputTokenLimit: 2560 },
    { step: "decide", outputTokenLimit: 99, stage: "review", privateBody: "PRIVATE" } as never,
    { step: "synthesize", outputTokenLimit: Infinity, privateBody: "PRIVATE" } as never];
  result.outputLimitTraceStepsOmitted = 5;
  const original = hash(result), text = presentationReasoningText(result, language);
  expect(text).toContain("2,560 tokens"); expect(text).not.toContain("99 tokens"); expect(text).not.toContain("PRIVATE");
  expect(text).toContain(language === "en" ? "Output-limit history is partial: 5" : researchPresentationCatalogues[language].limitPartial.replace("{count}", "5"));
  if (language === "en") expect(text.startsWith(reasoningServingText(result))).toBe(true);
  else expect(text).toContain(researchPresentationCatalogues[language].limitReview);
  expect(hash(result)).toBe(original);
});
it("legacy English API/stdio content keeps its exact canonical financial fragments", () => {
  const run = presentationRun(), result = remoteResearchResult(run), locale = livePresentationLocale({ originalQuestion: run.question });
  expect(buildAnswerContent(run)).toBe(run.answer + "\n\n---\n**Citations and planned creator rewards** — weighted USDC allocations:\n" +
    "- Source 日本語 & <original> — $0.000001 (weight 1.00)\n\nRecorded to creators: $0.000001 · payment mode: offline. " +
    API_SETTLEMENT_NOTICE + `dispatch: ${config.baseUrl}/dispatch/language-fixture`);
  const stdio = { ...result, totalToCreators: run.totalToCreators, amountPaid: "0.070001" };
  expect(stdioResearchText(stdio, "https://example.invalid", locale)).toBe(run.answer + "\n\n" + presentationReasoningText(stdio, "en") +
    "\n\n— Paid Keryx 0.070001 USDC\nRecorded creator total: $0.000001; citation allocations (not individual settlement proof):\n" +
    "  • Source 日本語 & <original> — $0.000001\nOn-chain proof + live feed: https://example.invalid/dashboard");
});
it.each(locales)("%s stdio failures withhold raw diagnostics and perform no retry", async language => {
  const detail = 'Original provider 日本語 <raw> & {detail}', ask = vi.fn(async () => { throw new Error(detail); });
  const response = await createStdioResearchHandler(ask, "https://example.invalid")({ question: presentationQuestions.en, language });
  expect(response).toEqual({ isError: true, content: [{ type: "text", text: researchPresentationCatalogues[language].stdioFailure.replace("{detail}", "request_failed") }] });
  expect(JSON.stringify(response)).not.toContain(detail);
  expect(ask).toHaveBeenCalledOnce();
});

it.each(locales)("%s exposes recorded open circuits and rejected fallback input without a new request", language => {
  const run = presentationRun();
  run.reasoningAttempts = [
    { step: "decide", engine: "llm:primary", tier: 0, attempt: 0, startedAt: 1, durationMs: 0,
      outcome: "circuit-open", retryAfterMs: 1800000 },
    { step: "decide", engine: "llm:alternate", tier: 1, attempt: 1, startedAt: 2, durationMs: 0,
      outcome: "input-limited", error: "input_limit", status: 413 },
    { step: "decide", engine: "heuristic", tier: 2, attempt: 1, startedAt: 3, durationMs: 0, outcome: "served" },
  ];
  const result = remoteResearchResult(run), before = hash(result), text = presentationReasoningText(result, language);
  expect(text).toContain("decide: circuit-open [recorded-retry-after-ms=1800000]");
  expect(text).toContain("decide: input_limit (HTTP 413)");
  expect(text).toContain(researchPresentationCatalogues[language].failureSummary.split("{failures}")[0]);
  expect(result.reasoning.sourceSelection).toMatchObject({ state: "heuristic", fallbackUsed: true });
  expect(hash(result)).toBe(before);
});

it("bounds displayed failure history and omits private exception fields", () => {
  const result = remoteResearchResult(presentationRun());
  result.reasoningAttempts = Array.from({ length: 12 }, (_, index) => ({
    step: "decide", engine: "llm:synthetic", tier: 0, attempt: index + 1, startedAt: index, durationMs: 0,
    outcome: "failed", error: "provider", status: 500 + index, privateBody: "PRIVATE-CREDENTIAL",
  }));
  const text = presentationReasoningText(result, "en");
  expect(text).toContain("HTTP 507"); expect(text).not.toContain("HTTP 508");
  expect(text).toContain("4 more recorded failures"); expect(text).not.toContain("PRIVATE-CREDENTIAL");
});
