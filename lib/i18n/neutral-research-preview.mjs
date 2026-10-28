// This exact academic instruction describes PDF extraction and OCR.
// Translation drafts keep their existing machineDraft/review:null status.
const pdfRecovery = "Check the same original version. If needed, obtain a text-layer PDF, publisher text or a separately OCR-processed copy; this run did not perform OCR.";

/** @param {string} namespace @param {string} key @param {string} source */
export function isNeutralResearchPreview(namespace, key, source) {
  return namespace === "pdf-reading" && key === "recovery" && source === pdfRecovery;
}
