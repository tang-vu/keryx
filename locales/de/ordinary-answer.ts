import type { NativeAnswerCopy } from "../../lib/research/native-answer-copy";

/** Machine draft; no human review or language observation is implied. */
export const ordinaryAnswerGerman = Object.freeze({
  summaryIntro: "Vom Modell verfasste Zusammenfassung mit Quellenangaben zu jedem Satz. Jeder Satz steht neben dem Originalauszug, anhand dessen er geprüft wurde.",
  excerptIntro: "Nur Quellenauszüge. Der Entwurf wird nicht als Schlussfolgerung ausgegeben; die Vollständigkeit der Synthese ist nicht bestätigt. Forschungsziele sind zu untersuchende Themen, keine belegten Schlussfolgerungen.",
  unavailableIntro: "Keine belegte Antwort: Die Synthese oder die Prüfung der Belege wurde nicht abgeschlossen. Ursprüngliche Leseergebnisse und Belege bleiben erhalten.",
  emptyIntro: "Keine belegte Antwort: Der gelesene Inhalt lieferte keine zugelassenen Auszüge für die Forschungsziele.",
  target: "Forschungsziel",
  topic: "Angefragtes Thema (nicht verifiziert)",
  source: "Originaltext der Quelle",
  unavailableGap: "Die Belege für dieses Forschungsziel konnten in diesem Durchlauf nicht bewertet werden.",
  gap: "Beleglücke: kein zugelassener Auszug für dieses Forschungsziel.",
  partialGap: "Beleglücke: Die erfasste Bewertung liegt für dieses Forschungsziel weiterhin unter der Unterstützungsschwelle.",
  reviewNotice: "Die Sätze wurden von Modellen verfasst und geprüft, nicht unabhängig verifiziert.",
  limitations: "Die Auszüge belegen den Bezug zur Quelle, nicht deren Richtigkeit oder eine vollständige Synthese. Quellen können falsch sein oder einander widersprechen. Zahlungszustände werden separat erfasst.",
  compactNotice: "{count} kurze Stichpunkte konnten nicht alle Forschungsziele und zugelassenen Auszüge bewahren; die Ziele werden unten einzeln dargestellt.",
  compactNote: "Von Modellen verfasste und geprüfte Zusammenfassungen; vergleichen Sie die zugehörigen Originalauszüge. Die Vollständigkeit der Synthese und die Richtigkeit der Quellen bleiben unbestätigt. Zahlungszustände werden separat erfasst.",
  confidence: Object.freeze({
    synthetic: "Dieser Durchlauf enthält synthetisches Demonstrationsmaterial, das kein Vertrauen in die sachliche Richtigkeit begründet",
    "no-citation": "Keine Quellenangabe hat die Belegprüfung bestanden",
    "unresolved-conflict": "Anzahl ungelöster Quellenwidersprüche: {count}; Abdeckungswerte lösen widersprüchliche Belege nicht auf",
    "no-coverage": "Für die Forschungsziele liegt keine Bewertung der Belegabdeckung vor",
    gaps: "Anzahl der Forschungsziele unterhalb der Belegschwelle: {count}",
    incomplete: "Die abschließende Bewertung belegt keine vollständige, gestützte Antwort auf jeden angefragten Teil",
    "explained-conflict": "Die Auswahl bevorzugter Quellen ist erklärt, widersprüchliche Belege begrenzen aber die Verlässlichkeit",
    "publisher-groups": "{count} Gruppen von Verlagsdomains liefern passende Belegstellen für jedes Forschungsziel, nachdem beobachtete Werke mit gleicher DOI zusammengeführt wurden; die Gruppierung beweist weder unabhängige Bestätigung noch sachliche Richtigkeit",
    "limited-sources": "Anzahl der beleggeprüften Quellen, die jedes Forschungsziel abdecken: {count}; unabhängige Bestätigung oder Belegstärke bleibt begrenzt",
  }),
  delivery: Object.freeze({
    unavailable: "Die Synthese oder Belegprüfung wurde nicht abgeschlossen; Quellenunterstützung und Nutzwert der Antwort sind noch nicht bewertet.",
    summary: "Jeder Zusammenfassungssatz ist mit einem wörtlichen Auszug verbunden und wurde von einem Modell geprüft; Vollständigkeit und unabhängige sachliche Richtigkeit bleiben unbestätigt.",
    excerpts: "Es werden nur Quellenauszüge geliefert; eine vollständige Synthese und die Belege für jede einzelne Aussage bleiben unbestätigt.",
  }),
  assessment: "Belegbewertung",
  lowConfidence: "Geringe Verlässlichkeit",
  provisional: "Betrachten Sie dieses Ergebnis als vorläufig.",
  sentenceEnd: ".",
}) satisfies NativeAnswerCopy;
