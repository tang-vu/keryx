"use client";

import type { BibliographicTaskResult } from "@/lib/research/bibliographic-task";

/** Metadata reference downloads never enter research citation/reward exports. */
export function BibliographyExports({ result }: { result: BibliographicTaskResult }) {
  const download = (format: "bibtex" | "ris") => {
    const blob = new Blob([result.bibliographyExports[format].content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `keryx-bibliography.${format === "bibtex" ? "bib" : "ris"}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section className="mt-4 border-t border-line pt-4" aria-label="Bibliography exports">
    <p className="text-xs text-ink-3">Bibliographic metadata · separate from research citations and creator rewards</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {(["bibtex", "ris"] as const).map(format => <button key={format} type="button" disabled={!result.bibliographyExports[format].count}
        onClick={() => download(format)} className="min-h-11 border border-line px-3 py-2 font-mono text-xs disabled:opacity-50">
        Download {format === "bibtex" ? "BibTeX" : "RIS"}
      </button>)}
    </div>
    <details className="mt-3 text-xs text-ink-3">
      <summary className="min-h-11 cursor-pointer py-3">Original metadata and field provenance</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border border-line bg-paper-2 p-3">{JSON.stringify(result.record, null, 2)}</pre>
    </details>
  </section>;
}
