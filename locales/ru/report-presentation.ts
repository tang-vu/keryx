import type { ReportPresentationCatalogue } from "../en/report-presentation";

/** Machine draft; no human approval, output-language attestation or financial authority. */
export const reportPresentationRussian = Object.freeze({
  "target": "{marker} · Тема исследования (не проверена): {claim}",
  "coverage": "Тема исследования (не проверена): {claim}: записанная оценка охвата {coverage}; {sources}",
  "noSources": "нет допущенных источников",
  "documentVersion": "Версия документа: {version}",
  "provenance": "Наблюдаемое происхождение: {provenance}",
  "scope": "Область предоставленных оригиналов: {scope}",
  "scholarly": "Наблюдаемые научные метаданные и прочитанный объём (рецензирование неизвестно): {metadata}",
}) satisfies ReportPresentationCatalogue;
