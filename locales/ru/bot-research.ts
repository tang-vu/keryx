import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const botResearchRussian = Object.freeze({
  ...botResearchEnglish,
  "weight": "Вес {weight}",
  "sourcesOne": "Число цитируемых источников: {count}",
  "sourcesOther": "Число цитируемых источников: {count}",
  "fullTrace": "Полная запись исследования: {url}",
  "failure": "⚠️ Keryx не удалось завершить это исследование: {detail}",
  "discordUsage": "Здесь доступна только команда `/ask question:<text>`.",
}) satisfies BotResearchCatalogue;
