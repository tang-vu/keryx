import type { AdditionalAnswerLanguage } from "./native-answer-intent";
import { ordinaryAnswerGerman } from "../../locales/de/ordinary-answer";
import { ordinaryAnswerJapanese } from "../../locales/ja/ordinary-answer";
import { ordinaryAnswerKorean } from "../../locales/ko/ordinary-answer";
import { ordinaryAnswerHindi } from "../../locales/hi/ordinary-answer";
import { ordinaryAnswerIndonesian } from "../../locales/id/ordinary-answer";

/** Prepared ordinary-answer copy. Enrollment, evidence and money remain caller-owned.
 * These machine drafts do not attest human translation review or output language. */
export interface NativeAnswerCopy {
  readonly summaryIntro: string;
  readonly excerptIntro: string;
  readonly unavailableIntro: string;
  readonly emptyIntro: string;
  readonly target: string;
  readonly topic: string;
  readonly source: string;
  readonly unavailableGap: string;
  readonly gap: string;
  readonly partialGap: string;
  readonly reviewNotice: string;
  readonly limitations: string;
  readonly compactNotice: string;
  readonly compactNote: string;
  readonly confidence: Readonly<Record<"synthetic" | "no-citation" | "unresolved-conflict" | "no-coverage" |
    "gaps" | "incomplete" | "explained-conflict" | "publisher-groups" | "limited-sources", string>>;
  readonly delivery: Readonly<Record<"unavailable" | "summary" | "excerpts", string>>;
  readonly assessment: string;
  readonly lowConfidence: string;
  readonly provisional: string;
  readonly sentenceEnd: "." | "。" | "।";
  readonly integration: Readonly<Record<"title" | "notice" | "constraint" | "excerpt" | "noSummary" |
    "scope" | "section" | "bounded" | "clipped" | "missing" | "target" | "noGaps" | "low" | "next" | "check", string>>;
}

const copy: Readonly<Record<AdditionalAnswerLanguage, NativeAnswerCopy>> = Object.freeze({
  de: ordinaryAnswerGerman, ja: ordinaryAnswerJapanese, ko: ordinaryAnswerKorean,
  hi: ordinaryAnswerHindi, id: ordinaryAnswerIndonesian,
});

/** Exact prepared code only; regional/request aliases never imply observed prose. */
export function nativeAnswerCopy(language: unknown): NativeAnswerCopy | undefined {
  return typeof language === "string" && Object.hasOwn(copy, language)
    ? copy[language as AdditionalAnswerLanguage] : undefined;
}

/** The only interpolation here is a caller-computed numeric count. */
export function nativeCount(text: string, count: number): string {
  return text.replaceAll("{count}", String(count));
}
