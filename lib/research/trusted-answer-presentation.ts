import { presentationLanguage } from "../../shared/i18n/presentation-language";
import type { AnswerPresentation } from "./answer-presentation";

/** Trusted adapter option only; public JSON may not provide this value. Keeps
 * the original caller text and explicit output-language instruction authoritative. */
export function trustedAnswerPresentation(original: AnswerPresentation, preference: unknown): AnswerPresentation {
  const language = presentationLanguage(preference);
  if (original.requestedLanguage || !language) return original;
  return { ...original, language, requestedLanguage: language,
    requestedMaximumWords: language === "en" ? original.requestedMaximumWords : undefined,
    requestedSentenceCount: language === "es" ? original.requestedSentenceCount : undefined };
}
