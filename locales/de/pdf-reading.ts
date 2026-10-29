import type { pdfReadingCopy } from "../en/pdf-reading";

/** Exact source-bound machine draft; no human approval, OCR or full-document claim. */
export const pdfReadingGerman = Object.freeze({
  summary: "Bei der PDF-Textextraktion wurden {read} von {total} Seiten aufgerufen.",
  emptyPages: "Aus den aufgerufenen Seiten {pages} wurde kein Text extrahiert. Diese Seiten können gescannt, leer oder aus anderen Gründen für den Textleser nicht zugänglich sein.",
  limit: "Eine Seiten- oder Zeichengrenze hat die Textextraktion vor dem Ende des Dokuments gestoppt. Lesen Sie die verbleibenden Originalseiten direkt, bevor Sie Schlussfolgerungen zum gesamten Dokument ziehen. Eine Zeichengrenze kann dazu führen, dass die zuletzt aufgerufene Seite nur teilweise erfasst ist. Bewahren Sie diese Momentaufnahme zum Vergleich auf.",
  textOnly: "Es wurde nur die verfügbare Textebene des PDFs gelesen; Bilder und Abbildungen wurden nicht interpretiert.",
  recovery: "Prüfen Sie dieselbe Originalversion. Besorgen Sie bei Bedarf ein PDF mit Textebene, den Text des Herausgebers oder eine separat per OCR verarbeitete Kopie. Bei diesem Durchlauf wurde keine OCR durchgeführt.",
} satisfies typeof pdfReadingCopy);
