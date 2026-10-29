import type { pdfReadingCopy } from "../en/pdf-reading";

/** Observed reading scope only; no OCR, full-document or factual qualification is inferred. */
export const pdfReadingFrench = {
  summary: "L'extraction de texte du PDF a parcouru {read} pages sur {total}.",
  emptyPages: "Aucun texte n'a été extrait des pages parcourues {pages}. Ces pages peuvent être numérisées, vierges ou inaccessibles au lecteur de texte pour une autre raison.",
  limit: "Une limite de pages ou de caractères a interrompu l'extraction de texte avant la fin du document. Lisez directement les pages originales restantes avant de tirer des conclusions sur le document entier ; une coupure au nombre de caractères peut laisser la dernière page parcourue incomplète. Conservez cet instantané pour comparaison.",
  textOnly: "Seule la couche de texte disponible du PDF a été lue ; les images et les figures n'ont pas été interprétées.",
  recovery: "Vérifiez la même version originale. Si nécessaire, obtenez un PDF avec une couche de texte, le texte de l'éditeur ou une copie traitée séparément par OCR ; cette exécution n'a pas effectué d'OCR.",
} satisfies typeof pdfReadingCopy;
