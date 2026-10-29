"use client";


import { useState } from "react";
import type { Citation } from "@/lib/types";
import { buildCitationExport, type CitationExportFormat } from "@/lib/research-citation-export";
import { UiMessage } from "@/lib/i18n/ui-copy";





export function ResearchCitationExport({ citations }: { citations: Citation[] }) {
  const [failed, setFailed] = useState(false);
  const { count, omitted } = buildCitationExport(citations, "bibtex");
  if (!citations.length) return null;

  function download(format: CitationExportFormat) {
    setFailed(false);
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const { content } = buildCitationExport(citations, format);
      url = URL.createObjectURL(new Blob([content], { type: format === "csl-json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" }));
      link = document.createElement("a");
      link.href = url;
      link.download = `keryx-references.${format === "bibtex" ? "bib" : format === "csl-json" ? "json" : "ris"}`;
      document.body.appendChild(link);
      link.click();
    } catch { setFailed(true); }
    finally {
      link?.remove();
      // Leave the URL alive while the browser starts its download.
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  return <div className="mt-5 border-t border-line pt-4">
    <p className="font-mono text-xs uppercase tracking-[0.1em] text-ink-3"><UiMessage messageKey="citationExport.title" /></p>
    <div className="mt-2 flex flex-wrap gap-3">
      {(["bibtex", "ris", "csl-json"] as const).map(format => <button key={format} type="button" disabled={!count}
        onClick={() => download(format)}
        className="min-h-11 border border-line px-3 font-mono text-xs text-seal hover:border-seal focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50">
        <UiMessage messageKey={format === "bibtex" ? "citationExport.bibtex" : format === "csl-json" ? "citationExport.cslJson" : "citationExport.ris"} />
      </button>)}
    </div>
    <p className="mt-2 font-serif text-sm text-ink-3"><UiMessage messageKey={count === 1 ? "citationExport.references.one" : "citationExport.references.other"} values={{ count }} /></p>
    {omitted > 0 && <p className="mt-1 font-serif text-sm text-ink-3"><UiMessage messageKey={omitted === 1 ? "citationExport.omitted.one" : "citationExport.omitted.other"} values={{ count: omitted }} /></p>}
    {failed && <p role="alert" className="mt-2 text-sm text-seal"><UiMessage messageKey="citationExport.failed" /></p>}
  </div>;
}
