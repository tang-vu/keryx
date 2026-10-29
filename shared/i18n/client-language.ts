import { presentationLanguage, systemPresentationLanguage, type PresentationLanguage } from "./presentation-language";
import { researchPresentationMessages } from "../../lib/research/presentation-messages";
import { nativeClientCatalogues } from "./native-client-copy";

/** Finite presentation controls, independent of the gated web UI locale registry.
 * A system/override locale is label authority only; it never proves answer language. */
export function clientPresentationLanguage(systemLocale: unknown, override?: unknown): PresentationLanguage {
  if (override !== undefined && override !== "auto") {
    const language = presentationLanguage(override);
    if (!language) throw new Error("Unsupported presentation language");
    return language;
  }
  return systemPresentationLanguage(systemLocale) ?? "en";
}

// Invariant language autonyms for the finite client selector; no UI-locale activation.
export const clientLanguageNames = Object.freeze({
  en: "English", vi: "Tiếng Việt", pt: "Português", es: "Español", fr: "Français", "zh-Hans": "简体中文",
  de: nativeClientCatalogues.de.name, ja: nativeClientCatalogues.ja.name, ko: nativeClientCatalogues.ko.name,
  hi: nativeClientCatalogues.hi.name, id: nativeClientCatalogues.id.name, ru: nativeClientCatalogues.ru.name,
} as const satisfies Readonly<Record<PresentationLanguage, string>>);

export const clientLanguageControls = {
  de: nativeClientCatalogues.de.controls, ja: nativeClientCatalogues.ja.controls, ko: nativeClientCatalogues.ko.controls,
  hi: nativeClientCatalogues.hi.controls, id: nativeClientCatalogues.id.controls, ru: nativeClientCatalogues.ru.controls,
  "zh-Hans": { language: "呈现语言", auto: "系统语言", answer: "答案", savedAnswer: "已保存的答案", unsavedAnswer: "未保存的答案", citations: "引用", engine: "推理引擎", sourceCap: "来源限额", question: "问题", runId: "运行编号" },
  en: { language: "Presentation language", auto: "System language", answer: "Answer", savedAnswer: "Saved answer", unsavedAnswer: "Unsaved answer", citations: "Citations", engine: "engine", sourceCap: "source cap", question: "question", runId: "run id" },
  vi: { language: "Ngôn ngữ trình bày", auto: "Ngôn ngữ hệ thống", answer: "Câu trả lời", savedAnswer: "Câu trả lời đã lưu", unsavedAnswer: "Câu trả lời chưa lưu", citations: "Trích dẫn", engine: "bộ suy luận", sourceCap: "hạn mức nguồn", question: "câu hỏi", runId: "mã lượt chạy" },
  pt: { language: "Idioma da apresentação", auto: "Idioma do sistema", answer: "Resposta", savedAnswer: "Resposta salva", unsavedAnswer: "Resposta não salva", citations: "Citações", engine: "motor", sourceCap: "limite para fontes", question: "pergunta", runId: "id da execução" },
  es: { language: "Idioma de presentación", auto: "Idioma del sistema", answer: "Respuesta", savedAnswer: "Respuesta guardada", unsavedAnswer: "Respuesta sin guardar", citations: "Citas", engine: "motor", sourceCap: "límite para fuentes", question: "pregunta", runId: "id de ejecución" },
  fr: { language: "Langue de présentation", auto: "Langue du système", answer: "Réponse", savedAnswer: "Réponse enregistrée", unsavedAnswer: "Réponse non enregistrée", citations: "Citations", engine: "moteur", sourceCap: "limite de sources", question: "question", runId: "identifiant de recherche" },
} as const;

export function clientPresentationMessages(language: PresentationLanguage) {
  return { controls: clientLanguageControls[language], research: researchPresentationMessages(language) };
}
