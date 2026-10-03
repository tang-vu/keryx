"use client";

import type { QueryRun } from "@/lib/types";
import { buildEvidenceMatrix, evidenceMatrixCsv } from "@/lib/research/evidence-matrix";

export function EvidenceMatrixExport({ run }: { run: QueryRun }) {
  const rows = buildEvidenceMatrix(run);
  const sources = run.citations.filter((citation, index, all) => all.findIndex((other) =>
    other.marker === citation.marker && other.sourceId === citation.sourceId && other.itemId === citation.itemId &&
    other.contentVersion === citation.contentVersion) === index);

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", evidenceMatrixCsv(run)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "keryx-evidence-matrix.csv";
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  return (
    <details className="mt-5 border-t border-line pt-4">
      <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-ink-3">Research evidence matrix</summary>
      <p className="mt-3 text-sm text-ink-3">Compare unverified research targets with cited sources and inspect recorded excerpts. An empty cell means no inspectable excerpt was recorded; it does not establish whether a claim is true, false, or disputed. Coverage and agent confidence do not prove entailment, measured accuracy or complete synthesis.</p>
      {rows.length ? (
        <>
          <button type="button" onClick={downloadCsv} className="my-3 min-h-11 border border-line px-3 font-mono text-xs text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-seal">Download evidence CSV</button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Research target by cited source evidence matrix</caption>
              <thead><tr>
                <th scope="col" className="min-w-48 border-b border-line p-2">Research target (unverified)</th>
                <th scope="col" className="min-w-40 border-b border-line p-2">Inspection status</th>
                {sources.map((source, index) => <th key={index} scope="col" className="min-w-56 border-b border-line p-2 font-normal">
                  <span className="font-mono">[{source.marker}]</span> {source.itemTitle ?? source.sourceName}
                  <span className="mt-1 block text-xs text-ink-3">Publication: {source.sourceName}</span>
                  <span className="mt-1 block text-xs text-ink-3">Published: {source.itemPublishedAt ?? "Not recorded"}</span>
                </th>)}
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.claimIndex}>
                <th scope="row" className="border-b border-line p-2 align-top font-normal">{row.claim}</th>
                <td className="border-b border-line p-2 align-top text-ink-3">{row.status}</td>
                {sources.map((source, index) => {
                  const excerpts = row.evidence.filter((item) => item.marker === source.marker && item.sourceId === source.sourceId &&
                    item.itemId === source.itemId && item.contentVersion === source.contentVersion);
                  return <td key={index} className="border-b border-line p-2 align-top">
                    {excerpts.length ? <details><summary className="cursor-pointer text-paid">Inspect {excerpts.length} {excerpts.length === 1 ? "excerpt" : "excerpts"}</summary>
                      {excerpts.map((item, quoteIndex) => <blockquote key={quoteIndex} className="mt-2 whitespace-pre-wrap border-l-2 border-paid pl-3 font-serif">{item.quote}</blockquote>)}
                    </details> : <span className="text-xs text-ink-3">No excerpt recorded</span>}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        </>
      ) : <p className="mt-3 text-sm text-ink-3">Research claims were not recorded for this dispatch. No evidence matrix is available.</p>}
    </details>
  );
}
