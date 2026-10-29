import type { PresentationLanguage } from "@/shared/i18n/presentation-language";
import type { QueryRun } from "../types";
import { recordedAnswerLanguage } from "../research/answer-language-provenance";
import { createMessages, englishMessages, type MessageCatalogue } from "./messages";
import type { dispatchMetadataCopy } from "./report-metadata";

// Bounded, source-authored ordinary preview labels. These are not a shipped UI
// catalogue or human approval of financial/trust terminology. All financial,
// confidence, historical-network and original-bibliography wording stays English.
const ordinaryLabels = {
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

function previewCopy(language: PresentationLanguage) {
  if (language === "en") return createMessages("en");
  const labels = ordinaryLabels[language];
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

const copies = { en: previewCopy("en"), vi: previewCopy("vi"), pt: previewCopy("pt"), es: previewCopy("es"), fr: previewCopy("fr") };

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
    citedLabel: (count: number) => copy(count === 1 ? "reportSocial.cited.one" : "reportSocial.cited.other"),
    metadataCopy: (input: Parameters<typeof dispatchMetadataCopy>[0]) => {
      const history = input.historical ? "historical" : "current";
      const kind = input.bibliographic ? "bibliography" : input.confidence !== undefined ? "confidence" : "plain";
      const form = input.count === 1 ? "one" : "other";
      const values = { ...input, confidence: input.confidence ?? "" };
      return {
        description: copy(`reportMetadata.${history}.${kind}.${form}`, values),
        openGraph: copy(`reportMetadata.og.${history}.${kind}.${form}`, values),
      };
    },
  };
}
