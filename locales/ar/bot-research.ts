import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const botResearchArabic = Object.freeze({
  ...botResearchEnglish,
  "weight": "الوزن {weight}",
  "sourcesOne": "عدد المصادر المستشهد بها: {count}",
  "sourcesOther": "عدد المصادر المستشهد بها: {count}",
  "fullTrace": "سجل البحث الكامل: {url}",
  "failure": "⚠️ تعذّر على Keryx إكمال هذا البحث: {detail}",
  "discordUsage": "الأمر المتاح هنا هو `/ask question:<text>` فقط.",
}) satisfies BotResearchCatalogue;
