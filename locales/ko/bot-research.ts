import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";
/** Neutral machine draft; financial, funding, settlement and pause authority remain English. */
export const botResearchKorean = Object.freeze({
  ...botResearchEnglish,
  weight: "가중치 {weight}",
  sourcesOne: "출처 {count}개 인용",
  sourcesOther: "출처 {count}개 인용",
  fullTrace: "전체 추적: {url}",
  failure: "⚠️ Keryx가 이 조사를 완료하지 못했습니다: {detail}",
  discordUsage: "여기서는 `/ask question:<text>`만 사용할 수 있습니다.",
} satisfies BotResearchCatalogue);
