import type { PresentationLanguage } from "./presentation-language";

/** Authored examples only. Never append them to an original question or a paid body. */
export const answerLanguageInstructions = Object.freeze([
  { language: "en", name: "English", instruction: "Answer in English." },
  { language: "vi", name: "Tiếng Việt", instruction: "Trả lời bằng tiếng Việt." },
  { language: "pt", name: "Português", instruction: "Responda em português." },
  { language: "es", name: "Español", instruction: "Responde en español." },
  { language: "fr", name: "Français", instruction: "Répondez en français." },
  { language: "zh-Hans", name: "简体中文", instruction: "请用简体中文回答。" },
  { language: "de", name: "Deutsch", instruction: "Antworte bitte auf Deutsch." },
  { language: "ja", name: "日本語", instruction: "日本語で回答してください。" },
  { language: "ko", name: "한국어", instruction: "한국어로 답변해 주세요." },
  { language: "hi", name: "हिन्दी", instruction: "कृपया हिंदी में उत्तर दें।" },
  { language: "id", name: "Bahasa Indonesia", instruction: "Tolong jawab dalam bahasa Indonesia." },
  { language: "ru", name: "Русский", instruction: "Ответьте по-русски." },
  { language: "ar", name: "العربية", instruction: "أجب بالعربية." },
] as const satisfies readonly { language: PresentationLanguage; name: string; instruction: string }[]);
