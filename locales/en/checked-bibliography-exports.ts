/** Explicit unread metadata exports; existing cited-reference labels stay unchanged. */
export const checkedBibliographyExportCopy = Object.freeze([
  Object.freeze({ format: "bibliography-bibtex" as const, label: "Export bibliography BibTeX", notice: "Private bibliography BibTeX saved. Metadata only; no read or settlement evidence." }),
  Object.freeze({ format: "bibliography-ris" as const, label: "Export bibliography RIS", notice: "Private bibliography RIS saved. Metadata only; no read or settlement evidence." }),
  Object.freeze({ format: "bibliography-csl-json" as const, label: "Export bibliography CSL-JSON", notice: "Private bibliography CSL-JSON saved. Metadata only; no read or settlement evidence." }),
]);

export const checkedBibliographyExportErrors = Object.freeze({
  unavailable: "No reusable bibliography metadata in the checked saved receipt",
});
