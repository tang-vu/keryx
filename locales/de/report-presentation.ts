import type { ReportPresentationCatalogue } from "../en/report-presentation";
export const reportPresentationGerman = Object.freeze({
  target: "{marker} · Forschungsziel (nicht verifiziert): {claim}",
  coverage: "Forschungsziel (nicht verifiziert): {claim}: erfasste Abdeckungsschätzung {coverage}; {sources}",
  noSources: "keine zugelassenen Quellen",
  documentVersion: "Dokumentversion: {version}",
  provenance: "Beobachtete Herkunft: {provenance}",
  scope: "Umfang der bereitgestellten Originalquellen: {scope}",
  scholarly: "Beobachtete wissenschaftliche Metadaten und Leseumfang (Begutachtung unbekannt): {metadata}",
} satisfies ReportPresentationCatalogue);
