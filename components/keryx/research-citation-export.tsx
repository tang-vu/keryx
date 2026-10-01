"use client";

import { useState } from "react";
import type { Citation } from "@/lib/types";
import { buildCitationExport, type CitationExportFormat } from "@/lib/research-citation-export";

export function ResearchCitationExport({ citations }: { citations: Citation[] }) {
  const [error, setError] = useState("");
  const { count, omitted } = buildCitationExport(citations, "bibtex");
  if (!citations.length) return null;

  function download(format: CitationExportFormat) {
    setError("");
    let url: string | undefined;
    let link: HTMLAnchorElement | undefined;
    try {
      const { content } = buildCitationExport(citations, format);
      url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
      link = document.createElement("a");
      link.href = url;
      link.download = `keryx-references.${format === "bibtex" ? "bib" : "ris"}`;
      document.body.appendChild(link);
      link.click();
    } catch { setError("Reference download failed. Try again in this browser."); }
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
    <p className="font-mono text-xs uppercase tracking-[0.1em] text-ink-3">Reference export</p>
    <div className="mt-2 flex flex-wrap gap-3">
      {(["bibtex", "ris"] as const).map(format => <button key={format} type="button" disabled={!count}
        onClick={() => download(format)}
        className="min-h-11 border border-line px-3 font-mono text-xs text-seal hover:border-seal focus-visible:outline-2 focus-visible:outline-seal disabled:cursor-not-allowed disabled:opacity-50">
        {format === "bibtex" ? "Download BibTeX" : "Download RIS (Zotero)"}
      </button>)}
    </div>
    <p className="mt-2 font-serif text-sm text-ink-3">{count} article references. Recorded titles, links and available publication dates; review metadata before using in a paper. Import RIS into Zotero with File → Import.</p>
    {omitted > 0 && <p className="mt-1 font-serif text-sm text-ink-3">{omitted} citations omitted because an article title or usable article link is unavailable.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-seal">{error}</p>}
  </div>;
}
