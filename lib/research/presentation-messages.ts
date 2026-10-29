import { researchPresentationEnglish } from "../../locales/en/research-presentation";
import { researchPresentationVietnamese } from "../../locales/vi/research-presentation";
import { researchPresentationPortuguese } from "../../locales/pt-BR/research-presentation";
import { researchPresentationSpanish } from "../../locales/es/research-presentation";
import { researchPresentationFrench } from "../../locales/fr/research-presentation";
import { researchPresentationChinese } from "../../locales/zh-Hans/research-presentation";
import { researchPresentationGerman } from "../../locales/de/research-presentation";
import { researchPresentationJapanese } from "../../locales/ja/research-presentation";
import { researchPresentationKorean } from "../../locales/ko/research-presentation";
import { researchPresentationHindi } from "../../locales/hi/research-presentation";
import { researchPresentationIndonesian } from "../../locales/id/research-presentation";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";

export const researchPresentationCatalogues = Object.freeze({ en: researchPresentationEnglish, vi: researchPresentationVietnamese,
  de: researchPresentationGerman, ja: researchPresentationJapanese, ko: researchPresentationKorean,
  hi: researchPresentationHindi, id: researchPresentationIndonesian,
  pt: researchPresentationPortuguese, es: researchPresentationSpanish, fr: researchPresentationFrench, "zh-Hans": researchPresentationChinese });
type Key = keyof typeof researchPresentationEnglish;
type Names<T extends string> = T extends `${string}{${infer Name}}${infer Tail}` ? Name | Names<Tail> : never;
type Values<K extends Key> = [Names<typeof researchPresentationEnglish[K]>] extends [never] ? [] : [Record<Names<typeof researchPresentationEnglish[K]>, string | number>];

export function researchPresentationMessages(language: PresentationLanguage) {
  const catalogue = researchPresentationCatalogues[language];
  return function message<K extends Key>(key: K, ...values: Values<K>): string {
    if (!Object.hasOwn(catalogue, key)) throw new Error("Unknown research presentation message");
    const parameters = values[0] as Record<string, string | number> | undefined;
    return catalogue[key].replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, name: string) => {
      if (!parameters || !Object.hasOwn(parameters, name) || !["string", "number"].includes(typeof parameters[name]))
        throw new Error("Missing research presentation parameter");
      return String(parameters[name]);
    });
  };
}
