import type { ReportPresentationCatalogue } from "../en/report-presentation";

export const reportPresentationFrench = Object.freeze({
  target: "{marker} objectif de recherche (non vérifié) : {claim}",
  coverage: "Objectif de recherche (non vérifié) : {claim} : estimation de couverture enregistrée {coverage} ; {sources}",
  noSources: "aucune source admise",
  documentVersion: "Version du document : {version}",
  provenance: "Provenance observée : {provenance}",
  scope: "Périmètre original des sources demandées : {scope}",
  scholarly: "Métadonnées scientifiques et périmètre de lecture observés (évaluation par les pairs inconnue) : {metadata}",
} satisfies ReportPresentationCatalogue);
