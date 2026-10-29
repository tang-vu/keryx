import type { AdditionalAnswerLanguage } from "./native-answer-intent";
import type { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { researchRecoveryGerman } from "../../locales/de/research-recovery";
import { researchRecoveryJapanese } from "../../locales/ja/research-recovery";
import { researchRecoveryKorean } from "../../locales/ko/research-recovery";
import { researchRecoveryHindi } from "../../locales/hi/research-recovery";
import { researchRecoveryIndonesian } from "../../locales/id/research-recovery";
import { pdfReadingGerman } from "../../locales/de/pdf-reading";
import { pdfReadingJapanese } from "../../locales/ja/pdf-reading";
import { pdfReadingKorean } from "../../locales/ko/pdf-reading";
import { pdfReadingHindi } from "../../locales/hi/pdf-reading";
import { pdfReadingIndonesian } from "../../locales/id/pdf-reading";

export interface NativeRecoveryCopy {
  readonly publicSource: string;
  readonly additionalFailures: string;
  readonly unknownFailure: string;
  readonly readFailure: Readonly<Record<"publisher-verification-required" | "pdf-extraction-unavailable" |
    "html-extraction-unavailable" | "article-byte-limit" | "document-identity-changed" |
    "empty-or-duplicate-body" | "web-operation-limit" | "invalid-url" | "cancelled", string>>;
  readonly synthesis: Readonly<Record<"input" | "generation" | "review" | "synthesis", string>>;
  readonly synthesisSummary: string;
  readonly followUp: Readonly<Record<"title" | "notice" | "truncated" | "scholarlyAbstract" | "abstract" | "conflict", string>>;
  readonly requested: Readonly<Record<"title" | "withheld" | "extracted" | "qualified" | "unqualified" |
    "truncated" | "abstract" | "failed" | "notRead" | "incomplete" | "section" | "unreadFragment" | "untargetedFragment", string>>;
  readonly empty: Readonly<Record<"prefix" | "noEvidence" | "discoveryWithheld" | "discoveryUnconfigured" |
    "discoveryUnavailable" | "discoveryCounts" | "failedOriginals" | "noOriginal" | "skipped" | "suppliedUrls" |
    "scholarly" | "narrow" | "limitations", string>>;
}

const copy: Readonly<Record<AdditionalAnswerLanguage, NativeRecoveryCopy>> = Object.freeze({
  de: researchRecoveryGerman, ja: researchRecoveryJapanese, ko: researchRecoveryKorean,
  hi: researchRecoveryHindi, id: researchRecoveryIndonesian,
});
const pdf: Readonly<Record<AdditionalAnswerLanguage, typeof pdfReadingCopy>> = Object.freeze({
  de: pdfReadingGerman, ja: pdfReadingJapanese, ko: pdfReadingKorean, hi: pdfReadingHindi, id: pdfReadingIndonesian,
});

/** Original request scope is checked by callers. Aliases are not output evidence. */
export function nativeRecoveryCopy(language: unknown): NativeRecoveryCopy | undefined {
  return typeof language === "string" && Object.hasOwn(copy, language) ? copy[language as AdditionalAnswerLanguage] : undefined;
}
export function nativePdfReadingCopy(language: unknown): typeof pdfReadingCopy | undefined {
  return typeof language === "string" && Object.hasOwn(pdf, language) ? pdf[language as AdditionalAnswerLanguage] : undefined;
}

/** One replacement pass preserves placeholder-like bytes in an original URL or diagnostic. */
export function nativeRecoveryFormat(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (_, key: string) => {
    if (!Object.hasOwn(values, key) || !["string", "number"].includes(typeof values[key]))
      throw new Error("Missing native recovery parameter");
    return String(values[key]);
  });
}
