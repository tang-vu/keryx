"use client";

import { useId, useRef, useState } from "react";
import type { QueryRun } from "@/lib/types";
import { buildEvidenceMatrix, evidenceMatrixCsv, type EvidenceMatrixRow } from "@/lib/research/evidence-matrix";
import { evidenceMatrixMarkdown } from "@/lib/research/evidence-matrix-markdown";
import { inspectEvidenceMatrix, matrixSourceIdentity, type MatrixInspectionState } from "@/lib/research/evidence-matrix-inspection";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { evidenceMatrixExportEnglish } from "@/locales/en/evidence-matrix-export";
import { cn } from "@/lib/utils";

type Source = QueryRun["citations"][number];
type Copy = ReturnType<typeof useUiMessages>;
const actionClass = "min-h-[44px] min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-mono text-xs text-ink transition-colors duration-150 hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal motion-reduce:transition-none";

export function EvidenceMatrixExport({ run }: { run: QueryRun }) {
  return <EvidenceMatrixReading key={run.id} run={run} />;
}

function EvidenceMatrixReading({ run }: { run: QueryRun }) {
  const copy = useUiMessages();
  const exportCopy = useUiCopy("evidence-matrix-export", evidenceMatrixExportEnglish);
  const [view, setView] = useState<"targets" | "matrix">("targets");
  const [downloadError, setDownloadError] = useState(false);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [inspectionState, setInspectionState] = useState<MatrixInspectionState>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const noticeId = useId();
  const rows = buildEvidenceMatrix(run);
  const sources = run.citations.filter((citation, index, all) => all.findIndex((other) =>
    other.marker === citation.marker && other.sourceId === citation.sourceId && other.itemId === citation.itemId &&
    other.itemUrl === citation.itemUrl && other.contentVersion === citation.contentVersion) === index);
  const visibleRows = inspectEvidenceMatrix(rows, { query, source: sourceFilter, state: inspectionState });
  const hasFilters = query !== "" || sourceFilter !== "" || inspectionState !== "all";
  function resetFilters() {
    setQuery(""); setSourceFilter(""); setInspectionState("all");
    searchRef.current?.focus();
  }

  function downloadFile(filename: string, body: () => string, type: string) {
    setDownloadError(false);
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([body()], { type }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } catch {
      setDownloadError(true);
    } finally {
      anchor?.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  return (
    <details className="group/matrix mt-5 min-w-0 border-y border-line py-2">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-2 [overflow-wrap:anywhere] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal [&::-webkit-details-marker]:hidden">
        <span>{copy("evidenceMatrix.title")}</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 transition-transform duration-200 group-open/matrix:rotate-90 motion-reduce:transition-none"><path d="m9 5 7 7-7 7" /></svg>
      </summary>
      <p id={noticeId} className="mt-2 text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{copy("evidenceMatrix.notice")}</p>
      {rows.length ? (
        <div className="@container/matrix min-w-0 pb-3">
          <fieldset aria-describedby={`${noticeId}-search-hint`} className="mt-5 min-w-0 border border-line bg-paper-2 p-4 sm:p-5">
            <legend className="px-2 font-mono text-xs uppercase tracking-[0.08em] text-ink-2">{exportCopy.filters}</legend>
            <p id={`${noticeId}-search-hint`} className="text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{exportCopy.searchHint}</p>
              <label className="mt-4 block min-w-0 text-sm text-ink" htmlFor={`${noticeId}-search`}>
                {exportCopy.search}
                <input ref={searchRef} id={`${noticeId}-search`} type="search" maxLength={200} value={query}
                  aria-controls={`${noticeId}-results`} aria-describedby={`${noticeId}-count`}
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); setQuery(""); } }}
                  className="mt-2 block min-h-11 w-full min-w-0 border border-line bg-paper px-3 py-2 font-serif text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal" />
              </label>
            <details className="mt-3 min-w-0 border-t border-line">
              <summary className="min-h-11 cursor-pointer py-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{exportCopy.advancedFilters}</summary>
              <p id={`${noticeId}-article-hint`} className="text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{exportCopy.articleHint}</p>
              <div className="mt-4 grid min-w-0 gap-4 @min-[38rem]/matrix:grid-cols-2">
              <label className="min-w-0 text-sm text-ink" htmlFor={`${noticeId}-article`}>
                {exportCopy.article}
                <select id={`${noticeId}-article`} value={sourceFilter} aria-controls={`${noticeId}-results`} aria-describedby={`${noticeId}-article-hint`}
                  onChange={event => setSourceFilter(event.target.value)}
                  className="mt-2 block min-h-11 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-serif text-base text-ink [contain:paint] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                  <option value="">{exportCopy.allArticles}</option>
                  {sourceFilter && !sources.some(source => matrixSourceIdentity(source) === sourceFilter) && <option value={sourceFilter}>{exportCopy.unavailableArticle}</option>}
                  {sources.map((source, index) => <option key={matrixSourceIdentity(source)} value={matrixSourceIdentity(source)}>
                    {`${index + 1}. [${source.marker}] ${source.itemTitle ?? source.sourceName} · ${source.sourceName} · ${source.contentVersion ?? copy("evidenceMatrix.notRecorded")} · ${source.itemUrl ?? copy("evidenceMatrix.notRecorded")}`}
                  </option>)}
                </select>
              </label>
              <label className="min-w-0 text-sm text-ink" htmlFor={`${noticeId}-availability`}>
                {exportCopy.inspectionState}
                <select id={`${noticeId}-availability`} value={inspectionState} aria-controls={`${noticeId}-results`}
                  onChange={event => setInspectionState(event.target.value as MatrixInspectionState)}
                  className="mt-2 block min-h-11 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-serif text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                  <option value="all">{exportCopy.allTargets}</option>
                  <option value="with-excerpts">{exportCopy.withExcerpts}</option>
                  <option value="without-excerpts">{exportCopy.withoutExcerpts}</option>
                </select>
              </label>
              </div>
            </details>
            <div className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
              <p id={`${noticeId}-count`} role="status" aria-live="polite" aria-atomic="true" className="font-mono text-xs tabular-nums text-ink-2 [overflow-wrap:anywhere]">
                {exportCopy.resultCount.replace("{shown}", String(visibleRows.length)).replace("{total}", String(rows.length))}
              </p>
              <button type="button" disabled={!hasFilters} onClick={resetFilters} className={cn(actionClass, "disabled:opacity-40")}>{exportCopy.resetFilters}</button>
            </div>
          </fieldset>
          <p className="mt-3 text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{exportCopy.fullExport}</p>
          <div className="my-5 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label={copy("evidenceMatrix.views")} className="flex min-w-0 flex-wrap gap-2">
              {([ ["targets", "evidenceMatrix.byTarget"], ["matrix", "evidenceMatrix.compareSources"] ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
                  className={cn(actionClass, "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper")}>
                  {copy(label)}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <button type="button" onClick={() => downloadFile("keryx-evidence-matrix.csv", () => `\uFEFF${evidenceMatrixCsv(run)}`, "text/csv;charset=utf-8")} className={actionClass}>{copy("evidenceMatrix.download")}</button>
              <button type="button" onClick={() => downloadFile("keryx-evidence-matrix.md", () => evidenceMatrixMarkdown(run), "text/markdown;charset=utf-8")} className={actionClass}>{exportCopy.downloadMarkdown}</button>
            </div>
          </div>
          {downloadError && <p role="alert" className="mb-4 border-l-2 border-seal pl-3 text-sm text-seal">{copy("evidenceMatrix.downloadUnavailable")}</p>}
          <div id={`${noticeId}-results`} key={view} className="min-w-0 motion-safe:animate-[kxSourceArrive_200ms_ease-out_both]">
            {visibleRows.length === 0 ? <p className="border-l-2 border-brass bg-paper-2 px-4 py-5 font-serif text-base leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{exportCopy.noMatches}</p> : view === "targets" ? (
              <ol aria-label={copy("evidenceMatrix.byTarget")} aria-describedby={noticeId} className="space-y-5">
                {visibleRows.map(row => <li key={row.claimIndex} className="min-w-0 border border-line bg-paper">
                  <header className="border-b border-line bg-paper-2 px-4 py-4 sm:px-5">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">{copy("evidenceMatrix.target")}</p>
                    <h3 id={`${noticeId}-${row.claimIndex}`} className="mt-2 font-serif text-lg leading-relaxed text-ink [overflow-wrap:anywhere]">{row.claim}</h3>
                    <p className="mt-2 font-mono text-xs text-ink-3 [overflow-wrap:anywhere]">{copy("evidenceMatrix.status")}: <span>{row.status}</span></p>
                  </header>
                  {sources.length > 0 && <details>
                    <summary aria-describedby={`${noticeId}-${row.claimIndex}`} className="min-h-[44px] cursor-pointer px-4 py-3 font-mono text-xs text-ink hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal sm:px-5">{copy("evidenceMatrix.inspectSources")}</summary>
                    <div className="grid min-w-0 grid-cols-1 divide-y divide-line border-t border-line @min-[38rem]/matrix:grid-cols-2 @min-[38rem]/matrix:divide-y-0">
                      {sources.map((source, index) => <article key={index} className="min-w-0 p-4 @min-[38rem]/matrix:border-b @min-[38rem]/matrix:border-line @min-[38rem]/matrix:odd:border-r sm:p-5">
                        <SourceHeader source={source} copy={copy} expanded />
                        <SourceExcerpts excerpts={excerptsFor(row, source)} copy={copy} />
                      </article>)}
                    </div>
                  </details>}
                </li>)}
              </ol>
            ) : (
              <div role="region" aria-label={copy("evidenceMatrix.caption")} aria-describedby={noticeId} tabIndex={0}
                className="max-h-[min(70dvh,36rem)] max-w-full overflow-auto overscroll-contain border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
                <table className="w-full border-collapse text-left text-sm">
                  <caption className="sr-only">{copy("evidenceMatrix.caption")}</caption>
                  <thead><tr>
                    <th scope="col" className="sticky left-0 top-0 z-30 w-48 min-w-48 max-w-48 border-b border-r border-line bg-paper-2 p-3 align-top [overflow-wrap:anywhere]">{copy("evidenceMatrix.target")}</th>
                    <th scope="col" className="sticky top-0 z-20 min-w-40 border-b border-line bg-paper-2 p-3 align-top">{copy("evidenceMatrix.status")}</th>
                    {sources.map((source, index) => <th key={index} scope="col" className="sticky top-0 z-20 min-w-56 max-w-80 border-b border-line bg-paper-2 p-3 align-top font-normal">
                      <SourceHeader source={source} copy={copy} />
                    </th>)}
                  </tr></thead>
                  <tbody>{visibleRows.map(row => <tr key={row.claimIndex}>
                    <th scope="row" className="sticky left-0 z-10 w-48 min-w-48 max-w-48 border-b border-r border-line bg-paper p-3 align-top font-normal [overflow-wrap:anywhere]">{row.claim}</th>
                    <td className="border-b border-line p-3 align-top text-ink-3">{row.status}</td>
                    {sources.map((source, index) => <td key={index} className="border-b border-line p-3 align-top">
                      <SourceExcerpts excerpts={excerptsFor(row, source)} copy={copy} />
                    </td>)}
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : <p className="my-3 text-sm text-ink-3">{copy("evidenceMatrix.unavailable")}</p>}
    </details>
  );
}

function excerptsFor(row: EvidenceMatrixRow, source: Source) {
  return row.evidence.filter(item => item.marker === source.marker && item.sourceId === source.sourceId &&
    item.itemId === source.itemId && item.itemUrl === source.itemUrl && item.contentVersion === source.contentVersion);
}

function SourceHeader({ source, copy, expanded = false }: { source: Source; copy: Copy; expanded?: boolean }) {
  return <div className="min-w-0 [overflow-wrap:anywhere]">
    <p className="font-mono text-xs text-seal">[{source.marker}]</p>
    <p className="mt-1 font-serif text-base leading-relaxed text-ink">{source.itemTitle ?? source.sourceName}</p>
    <p className="mt-2 text-xs text-ink-3">{copy("evidenceMatrix.publication", { publication: source.sourceName })}</p>
    <p className="mt-1 text-xs text-ink-3">{copy("evidenceMatrix.published", { date: source.itemPublishedAt ?? copy("evidenceMatrix.notRecorded") })}</p>
    <p className="mt-1 font-mono text-xs text-ink-3">{copy("evidenceMatrix.version", { version: source.contentVersion ?? copy("evidenceMatrix.notRecorded") })}</p>
    <details className="mt-2" open={expanded}>
      <summary className="min-h-[44px] cursor-pointer py-3 font-mono text-xs text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy("evidenceMatrix.identity")}</summary>
      <p className="pb-2 font-mono text-xs text-ink-3">{copy("evidenceMatrix.articleUrl")}: <span>{source.itemUrl ?? copy("evidenceMatrix.notRecorded")}</span></p>
    </details>
  </div>;
}

function SourceExcerpts({ excerpts, copy }: { excerpts: EvidenceMatrixRow["evidence"]; copy: Copy }) {
  if (!excerpts.length) return <p className="mt-2 text-sm text-ink-3">{copy("evidenceMatrix.noExcerpt")}</p>;
  return <details className="mt-2 border-t border-line">
    <summary className="min-h-[44px] cursor-pointer py-3 text-sm text-ink hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy(excerpts.length === 1 ? "evidenceMatrix.inspect.one" : "evidenceMatrix.inspect.other", { count: excerpts.length })}</summary>
    {excerpts.map((item, index) => <div key={index} className="mb-4">
      {item.evidenceProvenance === "synthetic-demo" && <p className="mb-2 font-mono text-xs text-seal">{copy("evidenceMatrix.statusIllustrative")}</p>}
      <blockquote className="whitespace-pre-wrap border-l-2 border-line pl-3 font-serif text-base leading-relaxed text-ink [overflow-wrap:anywhere]">{item.quote}</blockquote>
    </div>)}
  </details>;
}
