import { reportPresentationEnglish } from "../../locales/en/report-presentation";
import { reportPresentationVietnamese } from "../../locales/vi/report-presentation";
import { reportPresentationPortuguese } from "../../locales/pt-BR/report-presentation";
import { reportPresentationSpanish } from "../../locales/es/report-presentation";
import { reportPresentationFrench } from "../../locales/fr/report-presentation";
import { reportPresentationChinese } from "../../locales/zh-Hans/report-presentation";
import { reportPresentationGerman } from "../../locales/de/report-presentation";
import { reportPresentationJapanese } from "../../locales/ja/report-presentation";
import { reportPresentationKorean } from "../../locales/ko/report-presentation";
import { reportPresentationHindi } from "../../locales/hi/report-presentation";
import { reportPresentationIndonesian } from "../../locales/id/report-presentation";
import { reportPresentationRussian } from "../../locales/ru/report-presentation";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
export const reportPresentationCatalogues = Object.freeze({ en: reportPresentationEnglish, vi: reportPresentationVietnamese,
  de: reportPresentationGerman, ja: reportPresentationJapanese, ko: reportPresentationKorean,
  hi: reportPresentationHindi, id: reportPresentationIndonesian, ru: reportPresentationRussian,
  pt: reportPresentationPortuguese, es: reportPresentationSpanish, fr: reportPresentationFrench, "zh-Hans": reportPresentationChinese });
type Key = keyof typeof reportPresentationEnglish;
type Names<T extends string> = T extends `${string}{${infer Name}}${infer Tail}` ? Name | Names<Tail> : never;
type Values<K extends Key> = [Names<typeof reportPresentationEnglish[K]>] extends [never] ? [] : [Record<Names<typeof reportPresentationEnglish[K]>, string | number>];

export function reportPresentationMessages(language: PresentationLanguage) {
  const catalogue = reportPresentationCatalogues[language];
  return function message<K extends Key>(key: K, ...values: Values<K>): string {
    if (!Object.hasOwn(catalogue, key)) throw new Error("Unknown report presentation message");
    const parameters = values[0] as Record<string, string | number> | undefined;
    return catalogue[key].replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name) || !["string", "number"].includes(typeof parameters[name]))
        throw new Error("Missing report presentation parameter");
      return String(parameters[name]);
    });
  };
}
