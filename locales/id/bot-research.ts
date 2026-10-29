import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";
/** Neutral machine draft; financial, funding, settlement and pause authority remain English. */
export const botResearchIndonesian = Object.freeze({
  ...botResearchEnglish,
  weight: "bobot {weight}",
  sourcesOne: "{count} sumber dikutip",
  sourcesOther: "{count} sumber dikutip",
  fullTrace: "Jejak lengkap: {url}",
  failure: "⚠️ Keryx tidak dapat menyelesaikan riset ini: {detail}",
  discordUsage: "Hanya `/ask question:<text>` yang tersedia di sini.",
} satisfies BotResearchCatalogue);
