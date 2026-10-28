/** Preference controls only. Existing payment, consent, legal and onboarding copy stays English. */
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
} as const);
export type UiPreferenceKey = keyof typeof uiPreferenceMessages;
export function uiPreferenceCopy(key: UiPreferenceKey): string { return uiPreferenceMessages[key]; }
