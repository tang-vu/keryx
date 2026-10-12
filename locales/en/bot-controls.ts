/** Ordinary bot controls only. Financial/claim authority copy is not translated here. */
export const botControlsEnglish = Object.freeze({
  introduction: "Ask a question to receive an answer with citations.",
  usage: "Usage:",
  exampleQuestion: "what is x402?",
  reviewBoundary: "Review-first is available only in the authenticated live browser; review mode flags are refused here.",
  privateQuestion: "In this private chat you can also just type the question.",
  status: "Status:",
  financialDetails: "Financial details (English):",
  languageHelp: "Use /language en|vi|pt|es|auto to set the language of help. Research replies follow the original question; request a different answer language in the question itself.",
  languageCurrent: "Help language preference: {preference}.",
  languageSaved: "Saved help language preference: {preference}.",
  languageUnavailable: "The help language preference could not be read or confirmed as saved. No successful save is claimed.",
  languageInvalid: "Supported values: en, vi, pt (also pt-BR), es, auto.",
  languagePrivate: "Set or inspect your help language in a private chat with Keryx.",
  privatePreparing: "Keryx is preparing your private research reply…",
} as const);
export type BotControlsCatalogue = { readonly [K in keyof typeof botControlsEnglish]: string };
