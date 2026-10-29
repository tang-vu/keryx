import { answerPresentation } from "./answer-presentation";

import { isPresentationLanguage, presentationLanguage, type PresentationLanguage } from "../../shared/i18n/presentation-language";
export { presentationLanguage, presentationLanguages, type RequestedPresentationLanguage, type PresentationLanguage } from "../../shared/i18n/presentation-language";
export interface PresentationLocale {
  language: PresentationLanguage;
  source: "requested" | "recorded-answer" | "question" | "fallback";
  answerLanguage: PresentationLanguage | "UNKNOWN";
  agreement: "MATCHED" | "MISMATCH" | "UNKNOWN";
  unsupportedRequestedLanguage: boolean;
}

/** Request-local labels only. recordedAnswerLanguage must come from a trusted producer,
 * never request JSON, source text, excerpts, a model guess or an arbitrary result property. */
export function livePresentationLocale(input: { requestedLanguage?: unknown; recordedAnswerLanguage?: unknown; originalQuestion?: string }): PresentationLocale {
  const requested = presentationLanguage(input.requestedLanguage);
  const recorded = isPresentationLanguage(input.recordedAnswerLanguage) ? input.recordedAnswerLanguage : undefined;
  const unsupported = input.requestedLanguage !== undefined && requested === undefined;
  const question = input.originalQuestion?.trim() ? answerPresentation(input.originalQuestion, "ordinary").language : undefined;
  const language = unsupported ? "en" : requested ?? recorded ?? question ?? "en";
  return { language, source: unsupported ? "fallback" : requested ? "requested" : recorded ? "recorded-answer" : question ? "question" : "fallback",
    answerLanguage: recorded ?? "UNKNOWN", agreement: recorded ? recorded === language ? "MATCHED" : "MISMATCH" : "UNKNOWN",
    unsupportedRequestedLanguage: unsupported };
}

/** Stored report labels have no live question/request authority. Missing/future metadata
 * is UNKNOWN with English labels, not a retrospective language detection or migration. */
export function recordedPresentationLocale(recordedAnswerLanguage: unknown): PresentationLocale {
  const language = isPresentationLanguage(recordedAnswerLanguage) ? recordedAnswerLanguage : undefined;
  return { language: language ?? "en", source: language ? "recorded-answer" : "fallback",
    answerLanguage: language ?? "UNKNOWN", agreement: language ? "MATCHED" : "UNKNOWN", unsupportedRequestedLanguage: false };
}
