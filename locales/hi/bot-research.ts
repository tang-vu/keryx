import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";
/** Neutral machine draft; financial, funding, settlement and pause authority remain English. */
export const botResearchHindi = Object.freeze({
  ...botResearchEnglish,
  weight: "वज़न {weight}",
  sourcesOne: "{count} स्रोत उद्धृत",
  sourcesOther: "{count} स्रोत उद्धृत",
  fullTrace: "पूरा ट्रेस: {url}",
  failure: "⚠️ Keryx यह शोध पूरा नहीं कर सका: {detail}",
  discordUsage: "यहाँ केवल `/ask question:<text>` उपलब्ध है।",
} satisfies BotResearchCatalogue);
