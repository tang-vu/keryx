import type { PresentationLanguage } from "./presentation-language";

/** Authored examples only. Never append them to an original question or a paid body. */
export const answerLanguageInstructions = Object.freeze([
  { language: "en", name: "English", instruction: "Answer in English." },
  { language: "vi", name: "Tiếng Việt", instruction: "Trả lời bằng tiếng Việt." },
  { language: "pt", name: "Português", instruction: "Responda em português." },
  { language: "es", name: "Español", instruction: "Responde en español." },
  { language: "fr", name: "Français", instruction: "Répondez en français." },
] as const satisfies readonly { language: PresentationLanguage; name: string; instruction: string }[]);
