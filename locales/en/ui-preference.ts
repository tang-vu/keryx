/** Language controls and question help. Critical payment, consent and legal copy stays English. */
export const uiPreferenceMessages = Object.freeze({
  language: "Interface language",
  english: "English",
  vietnamesePreview: "Tiếng Việt (preview)",
  chinesePreview: "简体中文 (preview)",
  previewNotice: "Preview: machine draft, not human reviewed. Some interface text remains in English. Critical payment, consent and legal text stays in English.",
  englishOnly: "English is currently the only offered interface language.",
  checking: "Checking language preference…",
  saving: "Saving account language…",
  accountSaved: "Language saved to this account.",
  browserSaved: "Language saved in this browser.",
  unavailable: "Account language is unavailable. Your browser choice still applies.",
  memoryOnly: "Language applies here. Browser storage is unavailable; it may not survive this session.",
  loadFailed: "Translation could not load. English is shown; select the language to retry.",
  answerLanguageTitle: "Request an answer language",
  answerLanguageBody: "Include a language instruction in your question. Interface language changes menus and labels; saved answers keep their original text.",
  answerLanguageExamples: "Supported language instructions",
} as const);
export type UiPreferenceKey = keyof typeof uiPreferenceMessages;
export function uiPreferenceCopy(key: UiPreferenceKey): string { return uiPreferenceMessages[key]; }
