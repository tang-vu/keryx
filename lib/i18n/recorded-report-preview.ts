import type { PresentationLanguage } from "@/shared/i18n/presentation-language";
import type { QueryRun } from "../types";
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import { createMessages, englishMessages, type MessageCatalogue } from "./messages";
import type { dispatchMetadataCopy } from "./report-metadata";

// Bounded, source-authored ordinary preview labels. These are not a shipped UI
// catalogue or human approval of financial/trust terminology. All financial,
// confidence, historical-network and original-bibliography wording stays English.
const ordinaryLabels = {
  de: { title: "{question} — Keryx-Recherchebericht", one: "zitierte Quelle", other: "zitierte Quellen", serial: "Serie 2026 — Ausgabe {serial}" },
  ja: { title: "{question} — Keryx調査レポート", one: "件の引用出典", other: "件の引用出典", serial: "2026年シリーズ — 第{serial}号" },
  ko: { title: "{question} — Keryx 조사 보고서", one: "개 출처 인용", other: "개 출처 인용", serial: "2026 시리즈 — 제{serial}호" },
  hi: { title: "{question} — Keryx शोध रिपोर्ट", one: "उद्धृत स्रोत", other: "उद्धृत स्रोत", serial: "2026 श्रृंखला — अंक {serial}" },
  id: { title: "{question} — Laporan Keryx", one: "sumber dikutip", other: "sumber dikutip", serial: "Seri 2026 — No. {serial}" },
  ru: { title: "{question} — Отчёт Keryx", one: "источник процитирован", other: "источников процитировано", serial: "Серия 2026 — выпуск {serial}" },
  "zh-Hans": { title: "{question} — Keryx 研究报告", one: "个引用来源", other: "个引用来源", serial: "2026 系列 — 第 {serial} 期" },
  vi: { title: "{question} — Báo cáo Keryx", one: "nguồn được trích dẫn", other: "nguồn được trích dẫn",
    serial: "Loạt 2026 — Số {serial}" },
  pt: { title: "{question} — Relatório Keryx", one: "fonte citada", other: "fontes citadas",
    serial: "Série 2026 — Nº {serial}" },
  es: { title: "{question} — Informe Keryx", one: "fuente citada", other: "fuentes citadas",
    serial: "Serie 2026 — N.º {serial}" },
  fr: { title: "{question} — Rapport Keryx", one: "source citée", other: "sources citées",
    serial: "Série 2026 — N° {serial}" },
} as const satisfies Record<Exclude<PresentationLanguage, "en">, {
  title: string; one: string; other: string; serial: string;
}>;

const russianCounts = Object.freeze({ one: "источник процитирован", few: "источника процитировано", many: "источников процитировано", other: "источника процитировано" });
const russianPlural = new Intl.PluralRules("ru");

function previewCopy(language: PresentationLanguage, count?: number) {
  if (language === "en") return createMessages("en");
  const base = ordinaryLabels[language];
  const counted = language === "ru" && count !== undefined
    ? russianCounts[russianPlural.select(count) as keyof typeof russianCounts] : undefined;
  const labels = counted ? { ...base, one: counted, other: counted } : base;
  const catalogue: MessageCatalogue = {
    "reportDispatch.title": labels.title,
    "reportSocial.serial": labels.serial,
    "reportSocial.cited.one": labels.one,
    "reportSocial.cited.other": labels.other,
  };
  for (const history of ["current", "historical"] as const) {
    for (const kind of ["plain", "confidence", "bibliography"] as const) {
      for (const form of ["one", "other"] as const) {
        const description = `reportMetadata.${history}.${kind}.${form}` as const;
        const social = `reportMetadata.og.${history}.${kind}.${form}` as const;
        // Change only the English source template, before any original data is
        // interpolated. An excerpt containing these words must stay literal.
        catalogue[description] = englishMessages[description].replace(
          form === "one" ? "{count} source cited" : "{count} sources cited", `{count} ${labels[form]}`);
        catalogue[social] = englishMessages[social].replace("{count} cited", `{count} ${labels[form]}`);
      }
    }
  }
  // Reuse the existing named-value interpolator; its English UI locale is not
  // provenance. Only the byte-bound reader below establishes answer language.
  return createMessages("en", catalogue);
}

const copies = { en: previewCopy("en"), vi: previewCopy("vi"), pt: previewCopy("pt"), es: previewCopy("es"), fr: previewCopy("fr"), "zh-Hans": previewCopy("zh-Hans"),
  de: previewCopy("de"), ja: previewCopy("ja"), ko: previewCopy("ko"), hi: previewCopy("hi"), id: previewCopy("id"), ru: previewCopy("ru") };

/** Call only after public visibility admission. Reads this retained answer/trace,
 * never a question, request, viewer preference, provider, store or receipt.
 * Unknown provenance keeps English labels and und; it does not relabel the answer. */
export function recordedReportPreview(run: Pick<QueryRun, "answer" | "trace">) {
  const answerLanguage = recordedAnswerLanguage(run) ?? "und";
  const presentationLanguage = answerLanguage === "und" ? "en" : answerLanguage;
  const copy = copies[presentationLanguage];
  return {
    answerLanguage, presentationLanguage,
    title: (question: string) => copy("reportDispatch.title", { question }),
    serial: (serial: string) => copy("reportSocial.serial", { serial }),
    citedLabel: (count: number) => (presentationLanguage === "ru" ? previewCopy("ru", count) : copy)(count === 1 ? "reportSocial.cited.one" : "reportSocial.cited.other"),
    metadataCopy: (input: Parameters<typeof dispatchMetadataCopy>[0]) => {
      const history = input.historical ? "historical" : "current";
      const kind = input.bibliographic ? "bibliography" : input.confidence !== undefined ? "confidence" : "plain";
      const form = input.count === 1 ? "one" : "other";
      const values = { ...input, confidence: input.confidence ?? "" };
      const countedCopy = presentationLanguage === "ru" ? previewCopy("ru", input.count) : copy;
      return {
        description: countedCopy(`reportMetadata.${history}.${kind}.${form}`, values),
        openGraph: countedCopy(`reportMetadata.og.${history}.${kind}.${form}`, values),
      };
    },
  };
}
