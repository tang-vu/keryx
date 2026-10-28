import { botResearchEnglish, type BotResearchCatalogue } from "../en/bot-research";

/** Neutral wrappers only; financial, funding, settlement and pause authority stay English. */
export const botResearchFrench = Object.freeze({
  ...botResearchEnglish,
  weight: "poids {weight}",
  sourcesOne: "{count} source citée",
  sourcesOther: "{count} sources citées",
  fullTrace: "Trace complète : {url}",
  failure: "⚠️ Keryx n'a pas pu terminer cette recherche : {detail}",
  discordUsage: "Seule la commande `/ask question:<text>` est disponible ici.",
} satisfies BotResearchCatalogue);
