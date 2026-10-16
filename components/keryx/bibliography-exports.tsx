"use client";


import type { BibliographicTaskResult } from "@/lib/research/bibliographic-task";
import { paperReferencesCslJson } from "@/lib/papers/reference-export";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { useState } from "react";
import { useUiMessages } from "@/lib/i18n/ui-copy";





/** Metadata reference downloads never enter research citation/reward exports. */
export function BibliographyExports({ result }: { result: BibliographicTaskResult }) {
  const copy = useUiMessages();
  const [error, setError] = useState("");
  const cslJson = paperReferencesCslJson(result.record.paper ? [result.record.paper] : []);
  const exports = { ...result.bibliographyExports, "csl-json": cslJson };
  const download = (format: "bibtex" | "ris" | "csl-json") => {
    setError("");
    try {
      downloadBrowserText(exports[format].content, `keryx-bibliography.${format === "bibtex" ? "bib" : format === "csl-json" ? "json" : "ris"}`,
        format === "csl-json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
    } catch { setError(copy("bibliographyExport.failed")); }
  };
  return <section className="mt-4 border-t border-line pt-4" aria-label={copy("bibliographyExport.label")}>
    <p className="text-xs text-ink-3">{copy("bibliographyExport.notice")}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {(["bibtex", "ris", "csl-json"] as const).map(format => <button key={format} type="button" disabled={!exports[format].count}
        onClick={() => download(format)} className="min-h-11 border border-line px-3 py-2 font-mono text-xs disabled:opacity-50">
        {copy(format === "bibtex" ? "bibliographyExport.bibtex" : format === "csl-json" ? "bibliographyExport.cslJson" : "bibliographyExport.ris")}
      </button>)}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-seal">{error}</p>}
    <details className="mt-3 text-xs text-ink-3">
      <summary className="min-h-11 cursor-pointer py-3">{copy("bibliographyExport.provenance")}</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border border-line bg-paper-2 p-3">{JSON.stringify(result.record, null, 2)}</pre>
    </details>
  </section>;
}
