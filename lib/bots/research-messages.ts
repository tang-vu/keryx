import { botResearchEnglish } from "../../locales/en/bot-research";
import { botResearchVietnamese } from "../../locales/vi/bot-research";
import { botResearchPortuguese } from "../../locales/pt-BR/bot-research";
import { botResearchSpanish } from "../../locales/es/bot-research";
import { botResearchFrench } from "../../locales/fr/bot-research";
import { botResearchChinese } from "../../locales/zh-Hans/bot-research";
import { botResearchGerman } from "../../locales/de/bot-research";
import { botResearchJapanese } from "../../locales/ja/bot-research";
import { botResearchKorean } from "../../locales/ko/bot-research";
import { botResearchHindi } from "../../locales/hi/bot-research";
import { botResearchIndonesian } from "../../locales/id/bot-research";
import { botResearchRussian } from "../../locales/ru/bot-research";
import { answerPresentation } from "../research/answer-presentation";
import { researchAdmissionError } from "../research/availability-contract";
import type { PresentationLanguage } from "../research/presentation-language";

export const botResearchCatalogues = Object.freeze({
  de: botResearchGerman, ja: botResearchJapanese, ko: botResearchKorean, hi: botResearchHindi, id: botResearchIndonesian, ru: botResearchRussian,
  en: botResearchEnglish, vi: botResearchVietnamese,
  pt: botResearchPortuguese, es: botResearchSpanish, fr: botResearchFrench, "zh-Hans": botResearchChinese,
});
export type BotResearchMessageKey = keyof typeof botResearchEnglish;
type Parameters<Text extends string> = Text extends `${string}{${infer Name}}${infer Tail}`
  ? Name | Parameters<Tail> : never;
type Arguments<Key extends BotResearchMessageKey> = [Parameters<typeof botResearchEnglish[Key]>] extends [never]
  ? [] : [Record<Parameters<typeof botResearchEnglish[Key]>, string | number>];

/** Validated presentation hint or original-question selector only. Callers bind
 * result hints to recorded provenance; this pure renderer performs no preference
 * I/O, language detection or mutable process-wide locale. */
export function botResearchMessages(originalQuestion = "", recordedLanguage?: PresentationLanguage) {
  const language = recordedLanguage ?? answerPresentation(originalQuestion, "ordinary").language;
  const catalogue = botResearchCatalogues[language];
  return function message<Key extends BotResearchMessageKey>(key: Key, ...args: Arguments<Key>): string {
    if (!Object.hasOwn(catalogue, key)) throw new Error("Unknown bot research message");
    const parameters = args[0] as Record<string, string | number> | undefined;
    return catalogue[key].replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name)
        || !["string", "number"].includes(typeof parameters[name])) throw new Error("Missing bot research parameter");
      return String(parameters[name]);
    });
  };
}

/** Translate the product-owned pause, never provider/source diagnostic bytes. */
export function botResearchFailure(error: unknown, originalQuestion = "", requestedLanguage?: PresentationLanguage): string {
  const message = botResearchMessages(originalQuestion, requestedLanguage);
  const detail = researchAdmissionError(error) ? message("paused")
    : error instanceof Error ? error.message : String(error);
  return message("failure", { detail });
}
