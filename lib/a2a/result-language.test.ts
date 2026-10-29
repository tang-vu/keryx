import { expect, it } from "vitest";
import { a2aResponseFromRun } from "./result";
import { quoteA2aResearch } from "./pricing";
import { presentationRun } from "../research/presentation.test-fixture";
import { finalizeAnswerLanguage, readCompletedAnswerLanguage } from "../research/answer-language-provenance";
import { createStdioResearchHandler } from "../research/result-presentation";
import { researchPresentationCatalogues } from "../research/presentation-messages";

it.each(["en", "vi", "pt", "es", "fr", "zh-Hans", "de", "ja", "ko", "hi", "id"] as const)("completed %s server/handler preserves answer, quotation, evidence and economics", async language => {
  // Synthetic closed contract; no producer execution, provider, network or payment.
  const run = { ...presentationRun(), paymentMode: "real" as const };
  const quote = quoteA2aResearch(0.05, "deep"), timing = { acceptedAt: "2026-10-11T23:59:58.000Z", startedAt: "2026-10-11T23:59:59.000Z" };
  const baseline = a2aResponseFromRun(run, quote, timing);
  const packet = finalizeAnswerLanguage({ answer: run.answer, rendererLanguage: language, statements: [], proposals: [] })!;
  run.trace = [{ phase: "done", ts: 0, message: "PRIVATE TRACE", detail: { answerLanguage: packet, privateMarker: "PRIVATE TRACE" } }];
  const response = a2aResponseFromRun(run, quote, timing);
  const { answerLanguage, ...unchanged } = response;
  expect(unchanged).toEqual(baseline);
  expect(response).toHaveProperty("serviceReceipt");
  expect(response.serviceReceipt).toEqual(baseline.serviceReceipt);
  expect(readCompletedAnswerLanguage(answerLanguage, response.queryId, response.answer)?.language).toBe(language);
  expect(response.answer).toBe(run.answer);
  expect(response.evidence?.[0].quote).toBe(run.evidence![0].quote);
  expect(JSON.stringify(response)).not.toContain("PRIVATE TRACE");
  const result = { ...response, amountPaid: "0.100000", settlementId: "original-settlement" };
  const rendered = await createStdioResearchHandler(async () => result, "https://example.invalid")({ question: "Answer in English. Explain sources." });
  expect(rendered.content[0].text.startsWith(run.answer)).toBe(true);
  if (language !== "en") expect(rendered.content[0].text).toContain(researchPresentationCatalogues[language].financialDetails);
  expect(rendered.content[0].text).toContain("Paid Keryx 0.100000 USDC");
  expect(rendered.structuredContent).toEqual(result);
  for (const changed of [{ ...run, answer: run.answer + " " }, { ...run, trace: [] },
    { ...run, trace: [...run.trace, ...run.trace] },
    { ...run, trace: [{ ...run.trace[0], detail: { answerLanguage: { ...packet, format: "future" } } }] }]) {
    expect(a2aResponseFromRun(changed, quoteA2aResearch(0.05, "deep"))).not.toHaveProperty("answerLanguage");
  }
});
