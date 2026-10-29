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
  languageSaved: "Bevorzugte Sprache für Antworten und Hilfe gespeichert: {preference}.",
  languageUnavailable: "Die Sprachpräferenz konnte nicht gelesen oder ihre Speicherung bestätigt werden. Eine erfolgreiche Speicherung wird nicht behauptet.",
  languagePrivate: "Legen Sie Ihre Sprachpräferenz in einem privaten Chat mit Keryx fest oder sehen Sie sie dort ein.",
  privatePreparing: "Keryx bereitet Ihre private Rechercheantwort vor…",
} satisfies BotControlsCatalogue);
