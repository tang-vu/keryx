"use client";


import type { QueryRun } from "@/lib/types";
import { buildEvidenceMatrix, evidenceMatrixCsv } from "@/lib/research/evidence-matrix";
import { useUiMessages } from "@/lib/i18n/ui-copy";





export function EvidenceMatrixExport({ run }: { run: QueryRun }) {
  const copy = useUiMessages();
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
      <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-ink-3">{copy("evidenceMatrix.title")}</summary>
      <p className="mt-3 text-sm text-ink-3">{copy("evidenceMatrix.notice")}</p>
      {rows.length ? (
        <>
          <button type="button" onClick={downloadCsv} className="my-3 min-h-11 border border-line px-3 font-mono text-xs text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-seal">{copy("evidenceMatrix.download")}</button>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{copy("evidenceMatrix.caption")}</caption>
              <thead><tr>
                <th scope="col" className="min-w-48 border-b border-line p-2">{copy("evidenceMatrix.target")}</th>
                <th scope="col" className="min-w-40 border-b border-line p-2">{copy("evidenceMatrix.status")}</th>
                {sources.map((source, index) => <th key={index} scope="col" className="min-w-56 border-b border-line p-2 font-normal">
                  <span className="font-mono">[{source.marker}]</span> {source.itemTitle ?? source.sourceName}
                  <span className="mt-1 block text-xs text-ink-3">{copy("evidenceMatrix.publication", { publication: source.sourceName })}</span>
                  <span className="mt-1 block text-xs text-ink-3">{copy("evidenceMatrix.published", { date: source.itemPublishedAt ?? copy("evidenceMatrix.notRecorded") })}</span>
                </th>)}
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.claimIndex}>
                <th scope="row" className="border-b border-line p-2 align-top font-normal">{row.claim}</th>
                <td className="border-b border-line p-2 align-top text-ink-3">{row.status}</td>
                {sources.map((source, index) => {
                  const excerpts = row.evidence.filter((item) => item.marker === source.marker && item.sourceId === source.sourceId &&
                    item.itemId === source.itemId && item.contentVersion === source.contentVersion);
                  return <td key={index} className="border-b border-line p-2 align-top">
                    {excerpts.length ? <details><summary className="cursor-pointer text-paid">{copy(excerpts.length === 1 ? "evidenceMatrix.inspect.one" : "evidenceMatrix.inspect.other", { count: excerpts.length })}</summary>
                      {excerpts.map((item, quoteIndex) => <blockquote key={quoteIndex} className="mt-2 whitespace-pre-wrap border-l-2 border-paid pl-3 font-serif [overflow-wrap:anywhere]">{item.quote}</blockquote>)}
                    </details> : <span className="text-xs text-ink-3">{copy("evidenceMatrix.noExcerpt")}</span>}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
        </>
      ) : <p className="mt-3 text-sm text-ink-3">{copy("evidenceMatrix.unavailable")}</p>}
    </details>
  );
}
