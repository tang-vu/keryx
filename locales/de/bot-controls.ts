import { botControlsEnglish, type BotControlsCatalogue } from "../en/bot-controls";
/** Neutral machine draft; browser review boundary remains English. */
export const botControlsGerman = Object.freeze({
  ...botControlsEnglish,
  introduction: "Stellen Sie eine Frage, um eine Antwort mit Quellenangaben zu erhalten.",
  usage: "Verwendung:",
  exampleQuestion: "Was ist x402?",
  privateQuestion: "In diesem privaten Chat können Sie die Frage auch direkt eingeben.",
  status: "Status:",
  financialDetails: "Finanzielle Angaben (Englisch):",
  languageCurrent: "Bevorzugte Antwortsprache: {preference}.",
  languageHelp: "Mit /language en|vi|pt|es|fr|zh-Hans|de|ja|ko|hi|id|ru|ar|auto wählen Sie die Sprache für Antworten und Hilfe. Eine ausdrückliche Sprachangabe in Ihrer Originalfrage hat Vorrang; auto folgt der Frage.",
  languageInvalid: "Unterstützte Werte: en, vi, pt (auch pt-BR), es, fr, zh-Hans, de, ja, ko, hi, id, ru, ar, auto.",
  languageSaved: "Bevorzugte Sprache für Antworten und Hilfe gespeichert: {preference}.",
  languageUnavailable: "Die Sprachpräferenz konnte nicht gelesen oder ihre Speicherung bestätigt werden. Eine erfolgreiche Speicherung wird nicht behauptet.",
  languagePrivate: "Legen Sie Ihre Sprachpräferenz in einem privaten Chat mit Keryx fest oder sehen Sie sie dort ein.",
  privatePreparing: "Keryx bereitet Ihre private Rechercheantwort vor…",
} satisfies BotControlsCatalogue);
