import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";

/** Neutral wrappers only; financial, funding, settlement and pause authority stay English. */
export const botResearchChinese = Object.freeze({
  ...botResearchEnglish,
  weight: "权重 {weight}",
  sourcesOne: "引用了 {count} 个来源",
  sourcesOther: "引用了 {count} 个来源",
  fullTrace: "完整跟踪记录：{url}",
  failure: "⚠️ Keryx 未能完成此项研究：{detail}",
  discordUsage: "此处仅支持 `/ask question:<text>` 命令。",
} satisfies BotResearchCatalogue);
