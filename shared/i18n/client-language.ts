import { presentationLanguage, type PresentationLanguage } from "./presentation-language";
import { researchPresentationMessages } from "../../lib/research/presentation-messages";

/** Finite presentation controls, independent of the gated web UI locale registry.
 * A system/override locale is label authority only; it never proves answer language. */
export function clientPresentationLanguage(systemLocale: unknown, override?: unknown): PresentationLanguage {
  if (override !== undefined && override !== "auto") {
    const language = presentationLanguage(override);
    if (!language) throw new Error("Unsupported presentation language");
    return language;
  }
  return typeof systemLocale === "string" ? presentationLanguage(systemLocale.split(/[-_]/u)[0].toLowerCase()) ?? "en" : "en";
}

// Invariant language autonyms for the finite client selector; no UI-locale activation.
export const clientLanguageNames = Object.freeze({
  en: "English", vi: "Tiếng Việt", pt: "Português", es: "Español",
} as const satisfies Readonly<Record<PresentationLanguage, string>>);

export const clientLanguageControls = {
  en: { language: "Presentation language", auto: "System language", answer: "Answer", savedAnswer: "Saved answer", unsavedAnswer: "Unsaved answer", citations: "Citations" },
  vi: { language: "Ngôn ngữ trình bày", auto: "Ngôn ngữ hệ thống", answer: "Câu trả lời", savedAnswer: "Câu trả lời đã lưu", unsavedAnswer: "Câu trả lời chưa lưu", citations: "Trích dẫn" },
  pt: { language: "Idioma da apresentação", auto: "Idioma do sistema", answer: "Resposta", savedAnswer: "Resposta salva", unsavedAnswer: "Resposta não salva", citations: "Citações" },
  es: { language: "Idioma de presentación", auto: "Idioma del sistema", answer: "Respuesta", savedAnswer: "Respuesta guardada", unsavedAnswer: "Respuesta sin guardar", citations: "Citas" },
} as const;

export function clientPresentationMessages(language: PresentationLanguage) {
  return { controls: clientLanguageControls[language], research: researchPresentationMessages(language) };
}
