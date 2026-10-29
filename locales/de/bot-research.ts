import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";
/** Neutral machine draft; financial, funding, settlement and pause authority remain English. */
export const botResearchGerman = Object.freeze({
  ...botResearchEnglish,
  weight: "Gewicht {weight}",
  sourcesOne: "{count} Quelle zitiert",
  sourcesOther: "{count} Quellen zitiert",
  fullTrace: "Vollständiger Ablauf: {url}",
  failure: "⚠️ Keryx konnte diese Recherche nicht abschließen: {detail}",
  discordUsage: "Hier ist nur `/ask question:<text>` verfügbar.",
} satisfies BotResearchCatalogue);
