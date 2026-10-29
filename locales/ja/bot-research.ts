import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";

/** Machine draft; canonical financial and review authority remains English. */
export const botResearchJapanese = Object.freeze({
  ...botResearchEnglish,
  weight: "重み {weight}",
  sourcesOne: "引用した資料 {count} 件",
  sourcesOther: "引用した資料 {count} 件",
  fullTrace: "研究の全記録：{url}",
  failure: "⚠️ Keryx はこの研究を完了できませんでした：{detail}",
  discordUsage: "ここでは `/ask question:<text>` のみ利用できます。",
} satisfies BotResearchCatalogue);
