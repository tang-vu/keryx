import { describe, expect, it } from "vitest";
import { livePresentationLocale, presentationLanguage, recordedPresentationLocale } from "./presentation-language";
import { recordedReportPresentation } from "./result-presentation";
import { researchPresentationCatalogues, researchPresentationMessages } from "./presentation-messages";

const cases = [["en", "Answer in English. Explain x402."], ["vi", "Trả lời bằng tiếng Việt. Giải thích x402."],
  ["pt", "Responda em português. Explique x402."], ["es", "En español, explique x402."]] as const;
describe("human presentation language authority", () => {
  it.each(cases)("%s question defaults to labels without inventing actual answer language", (language, originalQuestion) => {
    expect(livePresentationLocale({ originalQuestion })).toEqual({ language, source: "question", answerLanguage: "UNKNOWN",
      agreement: "UNKNOWN", unsupportedRequestedLanguage: false });
  });
  it("resolves explicit labels, trusted recorded answer, then question, retaining actual disagreement", () => {
    expect(livePresentationLocale({ requestedLanguage: "pt-BR", recordedAnswerLanguage: "vi", originalQuestion: cases[3][1] }))
      .toEqual({ language: "pt", source: "requested", answerLanguage: "vi", agreement: "MISMATCH", unsupportedRequestedLanguage: false });
    expect(livePresentationLocale({ recordedAnswerLanguage: "vi", originalQuestion: cases[3][1] }))
      .toMatchObject({ language: "vi", source: "recorded-answer", agreement: "MATCHED" });
    expect(livePresentationLocale({ requestedLanguage: "es", recordedAnswerLanguage: "es" })).toMatchObject({ language: "es", agreement: "MATCHED" });
  });
  it.each(["fr", "zh-Hans", "de", "auto", "ES", "es-ES", {}, null])("unsupported requested labels %j do not enable a locale or claim model translation", requestedLanguage => {
    expect(presentationLanguage(requestedLanguage)).toBeUndefined();
    expect(livePresentationLocale({ requestedLanguage, originalQuestion: cases[1][1] }))
      .toEqual({ language: "en", source: "fallback", answerLanguage: "UNKNOWN", agreement: "UNKNOWN", unsupportedRequestedLanguage: true });
  });
  it("missing context is UNKNOWN rather than a detected English answer", () => {
    expect(livePresentationLocale({})).toMatchObject({ language: "en", source: "fallback", answerLanguage: "UNKNOWN", agreement: "UNKNOWN" });
  });
  it.each(cases)("%s stored labels require explicit recorded language, not inferred answer/question text", language => {
    const report = recordedReportPresentation(language);
    expect(report.locale).toEqual(recordedPresentationLocale(language));
    expect(report.locale.source).toBe("recorded-answer"); expect(report.notice).toBe("");
    expect(report.labels.title).toBe(researchPresentationCatalogues[language].reportTitle);
  });
  it.each([undefined, "fr", "", { question: cases[1][1], answer: "Vietnamese-looking text", language: "vi" }])
    ("stored unknown %j cannot use a historical question or arbitrary object property", input => {
      const report = recordedReportPresentation(input);
      expect(report.locale).toMatchObject({ language: "en", source: "fallback", answerLanguage: "UNKNOWN" });
      expect(report.notice).toBe(researchPresentationCatalogues.en.recordedUnknown);
    });
});
describe("shared four-locale catalogue contract", () => {
  it.each(Object.entries(researchPresentationCatalogues))("%s keeps exact keys and typed placeholders", (_, catalogue) => {
    expect(Object.isFrozen(catalogue)).toBe(true);
    expect(Object.keys(catalogue).sort()).toEqual(Object.keys(researchPresentationCatalogues.en).sort());
    for (const key of Object.keys(catalogue) as (keyof typeof catalogue)[]) {
      expect(catalogue[key].trim()).not.toBe("");
      const names = (value: string) => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
      expect(names(catalogue[key])).toEqual(names(researchPresentationCatalogues.en[key]));
    }
  });
  it("refuses unknown/missing copy parameters instead of emitting broken labels", () => {
    // @ts-expect-error Untyped boundary also refuses unknown keys.
    expect(() => researchPresentationMessages("en")("unknown")).toThrow("Unknown research presentation message");
    // @ts-expect-error Required named parameters are checked at runtime too.
    expect(() => researchPresentationMessages("en")("apiTotal")).toThrow("Missing research presentation parameter");
  });
});
