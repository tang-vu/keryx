"use client";

import { useMemo, useRef, useState } from "react";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { reportComparisonCopy } from "@/locales/en/report-comparison";
import { compareSavedResearch, MAX_COMPARISON_RECEIPT_BYTES, ReportComparisonError,
  type ComparisonExcerpt, type ReportComparison, type TargetMatch } from "@/lib/research/report-comparison";
import { exportReportComparison, type ComparisonExportFormat } from "@/lib/research/report-comparison-export";
import { COMPARISON_FILTERS, filterComparisonTargets, indexComparisonTargets, matchesComparisonFilter,
  type ComparisonFilter } from "@/lib/research/report-comparison-view";
import { createReportComparisonPlan, MAX_COMPARISON_PLAN_BYTES, ReportComparisonPlanError,
  restoreReportComparisonPlan } from "@/lib/research/report-comparison-plan";
import { downloadBrowserText } from "@/lib/browser-text-download";

type Side = "before" | "after";
type Copy = typeof reportComparisonCopy;
interface FileState { name: string; text: string | null; loading: boolean; error: string | null }
const emptyFile = (): FileState => ({ name: "", text: null, loading: false, error: null });
const fieldClass = "min-w-0 w-full border border-line bg-paper p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function Excerpt({ row, copy, status }: { row: ComparisonExcerpt; copy: Copy; status: string }) {
  return <article className="min-w-0 border-t border-line py-4">
    <p className="mb-2 font-mono text-xs text-paid">{status}</p>
    <p className="break-words font-mono text-xs text-ink-3">{copy.sourceMarker({ marker: row.marker })} {row.sourceName || row.sourceId}</p>
    {row.illustrative && <p className="mt-2 font-mono text-xs text-seal">{copy.illustrative}</p>}
    <blockquote aria-label={copy.quote} className="mt-2 whitespace-pre-wrap break-words font-serif text-base leading-relaxed [overflow-wrap:anywhere]">{row.quote}</blockquote>
    <p className="mt-2 break-words font-mono text-xs text-ink-3">{copy.version}: {row.contentVersion ?? copy.notRecorded}</p>
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-mono text-xs">{copy.identity}</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">{JSON.stringify({ sourceId: row.sourceId, itemId: row.itemId, itemTitle: row.itemTitle, itemUrl: row.itemUrl,
        contentVersion: row.contentVersion, ...row.context }, null, 2)}</pre>
    </details>
  </article>;
}

export function ReportComparisonWorkspace() {
  const copy = useUiCopy("report-comparison", reportComparisonCopy);
  const message = useUiMessages();
  const [downloadError, setDownloadError] = useState("");
  const [files, setFiles] = useState<Record<Side, FileState>>({ before: emptyFile(), after: emptyFile() });
  const [model, setModel] = useState<ReportComparison | null>(null);
  const [result, setResult] = useState<ReportComparison | null>(null);
  const [matches, setMatches] = useState<TargetMatch[] | undefined>();
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ComparisonFilter>("all"), [query, setQuery] = useState("");
  const [planLoading, setPlanLoading] = useState(false), [planRestored, setPlanRestored] = useState(false);
  const targetIndex = useMemo(() => result ? indexComparisonTargets(result) : [], [result]);
  const visibleTargets = useMemo(() => filterComparisonTargets(targetIndex, filter, query), [targetIndex, filter, query]);
  const filterCounts = useMemo(() => Object.fromEntries(COMPARISON_FILTERS.map(value =>
    [value, targetIndex.filter(row => matchesComparisonFilter(row.target, value)).length])) as Record<ComparisonFilter, number>, [targetIndex]);
  const revision = useRef(0), reads = useRef({ before: 0, after: 0 });
  const form = useRef<HTMLFormElement>(null);
  function resetView() { setFilter("all"); setQuery(""); }
  function invalidate() { revision.current++; setResult(null); setError(null); setDownloadError(""); setBusy(false); setPlanLoading(false); setPlanRestored(false); resetView(); }
  async function choose(side: Side, file: File | undefined) {
    invalidate(); setModel(null); setMatches(undefined);
    const token = ++reads.current[side];
    setFiles(old => ({ ...old, [side]: { name: file?.name ?? "", text: null, loading: !!file, error: null } }));
    if (!file) return;
    try {
      if (file.size > MAX_COMPARISON_RECEIPT_BYTES) throw new ReportComparisonError("input-too-large");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (reads.current[side] === token) setFiles(old => ({ ...old, [side]: { name: file.name, text, loading: false, error: null } }));
    } catch (failure) {
      const message = failure instanceof ReportComparisonError ? copy.errors[failure.code] : copy.errors.file;
      if (reads.current[side] === token) setFiles(old => ({ ...old, [side]: { name: file.name, text: null, loading: false, error: message } }));
    }
  }
  async function compare() {
    if (planLoading || files.before.text === null || files.after.text === null) return;
    const token = revision.current; setBusy(true); setResult(null); setError(null); setDownloadError(""); resetView();
    try {
      const next = await compareSavedResearch({ before: files.before.text, after: files.after.text, matches });
      if (revision.current === token) { setModel(next); setResult(next); }
    } catch (failure) {
      if (revision.current === token) setError(copy.errors[failure instanceof ReportComparisonError ? failure.code : "invalid-receipt"]);
    } finally { if (revision.current === token) setBusy(false); }
  }
  const selected = matches ?? model?.targets.flatMap(row => row.before && row.after
    ? [{ beforeClaimIndex: row.before.claimIndex, afterClaimIndex: row.after.claimIndex }] : []) ?? [];
  function matchTarget(beforeClaimIndex: number, value: string) {
    invalidate();
    setMatches([...selected.filter(pair => pair.beforeClaimIndex !== beforeClaimIndex),
      ...(value === "" ? [] : [{ beforeClaimIndex, afterClaimIndex: Number(value) }])]);
  }
  function clear() {
    reads.current.before++; reads.current.after++; invalidate();
    setFiles({ before: emptyFile(), after: emptyFile() }); setModel(null); setMatches(undefined); form.current?.reset();
  }
  function saveMatchingPlan() {
    if (!model) return;
    setDownloadError("");
    try {
      downloadBrowserText(JSON.stringify(createReportComparisonPlan(model, selected), null, 2) + "\n",
        "keryx-report-matching.json", "application/json;charset=utf-8");
    } catch { setDownloadError(message("evidenceMatrix.downloadUnavailable")); }
  }
  async function restoreMatchingPlan(file: File | undefined) {
    if (!file || !model) return;
    invalidate(); const token = revision.current; setPlanLoading(true);
    try {
      if (file.size > MAX_COMPARISON_PLAN_BYTES) throw new ReportComparisonPlanError("invalid-matching-plan");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const pairs = restoreReportComparisonPlan(raw, model);
      if (revision.current === token) { setMatches(pairs); setPlanRestored(true); }
    } catch (failure) {
      if (revision.current === token) setError(failure instanceof ReportComparisonPlanError
        ? copy.matchingPlanErrors[failure.code] : copy.errors.file);
    } finally { if (revision.current === token) setPlanLoading(false); }
  }
  function download(format: ComparisonExportFormat) {
    if (!result) return;
    setDownloadError("");
    try {
      const type = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
      downloadBrowserText(exportReportComparison(result, format), `keryx-report-comparison.${format === "markdown" ? "md" : format}`, `${type};charset=utf-8`);
    } catch { setDownloadError(message("evidenceMatrix.downloadUnavailable")); }
  }
  return <section className="mx-auto max-w-[1080px] px-4 py-10 sm:px-8 sm:py-16">
    <header className="max-w-3xl">
      <p className="font-mono text-xs uppercase tracking-widest text-seal">{copy.kicker}</p>
      <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">{copy.title}</h1>
      <p className="mt-5 font-serif text-lg leading-relaxed text-ink-2">{copy.introduction}</p>
    </header>
    <p className="mt-7 border-l-2 border-paid bg-paper p-4 font-serif text-sm leading-relaxed text-ink-2">{copy.privacy}</p>
    {downloadError && <p role="alert" className="mt-4 font-serif text-sm text-seal">{downloadError}</p>}
    <form ref={form} className="mt-8 space-y-6" onSubmit={event => { event.preventDefault(); void compare(); }}>
      <p className="max-w-3xl font-serif text-sm leading-relaxed text-ink-2">{copy.instructions}</p>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {(["before", "after"] as const).map(side => <div key={side} className="min-w-0 border border-line bg-paper p-5">
          <label htmlFor={`comparison-${side}`} className="block font-mono text-sm">{side === "before" ? copy.beforeFile : copy.afterFile}</label>
          <input id={`comparison-${side}`} type="file" accept=".json,application/json" className={`${fieldClass} mt-3 file:mr-3 file:border-0 file:bg-paper-2 file:p-2 file:text-ink`}
            onChange={event => { void choose(side, event.currentTarget.files?.[0]); }} />
          {files[side].loading && <p role="status" className="mt-3 text-sm">{copy.reading}</p>}
          {files[side].error && <p role="alert" className="mt-3 text-sm text-seal">{files[side].error}</p>}
        </div>)}
      </div>
      {model && model.before.targets.length > 0 && model.after.targets.length > 0 && <fieldset className="min-w-0 border border-line p-5">
        <legend className="px-2 font-display text-2xl">{copy.matchingTitle}</legend>
        <p className="max-w-3xl font-serif text-sm leading-relaxed text-ink-2">{copy.matchingNotice}</p>
        <div className="mt-5 grid gap-5">
          {model.before.targets.map(target => <label key={target.claimIndex} className="grid min-w-0 gap-2 font-serif text-sm md:grid-cols-2 md:items-center md:gap-6">
            <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{copy.targetOption({ index: target.claimIndex, claim: target.claim })}</span>
            <select aria-label={copy.matchAfter} className={fieldClass} value={selected.find(pair => pair.beforeClaimIndex === target.claimIndex)?.afterClaimIndex ?? ""}
              onChange={event => matchTarget(target.claimIndex, event.currentTarget.value)}>
              <option value="">{copy.unmatched}</option>
              {model.after.targets.map(next => <option key={next.claimIndex} value={next.claimIndex}
                disabled={selected.some(pair => pair.afterClaimIndex === next.claimIndex && pair.beforeClaimIndex !== target.claimIndex)}>
                {copy.targetOption({ index: next.claimIndex, claim: next.claim })}
              </option>)}
            </select>
          </label>)}
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <p className="max-w-3xl font-serif text-sm leading-relaxed text-ink-2">{copy.matchingPlanNotice}</p>
          <button type="button" disabled={planLoading} onClick={saveMatchingPlan} className="mt-3 border border-line px-4 py-3 font-mono text-xs disabled:opacity-50">{copy.saveMatchingPlan}</button>
          <label htmlFor="comparison-matching-plan" className="mt-4 block font-mono text-xs">{copy.restoreMatchingPlan}</label>
          <input id="comparison-matching-plan" type="file" accept=".json,application/json" className={`${fieldClass} mt-2`}
            onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void restoreMatchingPlan(file); }} />
          {planLoading && <p role="status" className="mt-3 text-sm">{copy.reading}</p>}
          {planRestored && <p role="status" className="mt-3 text-sm">{copy.matchingPlanRestored}</p>}
        </div>
        {!result && matches !== undefined && <p role="status" className="mt-4 font-mono text-xs text-seal">{copy.matchingChanged}</p>}
      </fieldset>}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy || planLoading || files.before.text === null || files.after.text === null} className="bg-ink px-5 py-3 font-mono text-sm text-paper disabled:cursor-wait disabled:opacity-50">{busy ? copy.comparing : copy.compare}</button>
        <button type="button" onClick={clear} className="border border-line px-4 py-3 font-mono text-xs">{copy.clear}</button>
      </div>
      {error && <p role="alert" className="border border-seal p-4 font-serif text-sm text-seal">{error}</p>}
    </form>
    {result && <div data-testid="report-comparison-result" className="mt-12 space-y-8" aria-live="polite">
      <header className="border-t-2 border-ink pt-6">
        <p className="font-mono text-xs text-paid">{copy.verified}</p>
        <h2 className="mt-2 font-display text-3xl">{copy.resultTitle}</h2>
        <p className="mt-3 font-serif text-sm leading-relaxed text-ink-2">{copy.checksumNotice}</p>
        <p className={`mt-3 font-mono text-xs ${result.availability === "complete" ? "text-paid" : "text-seal"}`}>{copy.availability[result.availability]}</p>
        {result.sameReceipt && <p className="mt-3 text-sm">{copy.sameReceipt}</p>}
      </header>
      <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3">
        {([ [copy.comparable, result.summary.comparableTargets], [copy.changed, result.summary.changedTargets], [copy.unknown, result.summary.unknownTargets],
          [copy.added, result.summary.addedRows], [copy.removed, result.summary.removedRows], [copy.contextChanged, result.summary.contextChangedRows] ] as const).map(([label, count]) =>
          <div key={label} className="bg-paper p-4"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-display text-3xl">{count}</dd></div>)}
      </dl>
      <p className="font-serif text-sm text-ink-2">{copy.summaryNotice}</p>
      {result.summary.illustrativeRows > 0 && <p className="border border-seal p-4 text-sm text-seal">{copy.illustrativeNotice({ rows: result.summary.illustrativeRows })}</p>}
      <section aria-label={copy.exports} className="border border-line bg-paper p-5">
        <h3 className="font-display text-xl">{copy.exports}</h3>
        <div className="mt-4 flex flex-wrap gap-2">{(["json", "markdown", "csv"] as const).map(format =>
          <button key={format} type="button" onClick={() => download(format)} className="border border-ink px-4 py-2 font-mono text-xs">{copy[format]}</button>)}</div>
        <p className="mt-4 font-serif text-sm text-ink-2">{copy.exportNotice}</p>
      </section>
      {result.targets.length > 0 && <section aria-labelledby="comparison-filter-heading" className="border border-line bg-paper p-5">
        <h3 id="comparison-filter-heading" className="font-display text-xl">{copy.filterTitle}</h3>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="comparison-search" className="mb-2 block font-mono text-xs">{copy.searchLabel}</label>
            <input id="comparison-search" type="search" value={query} maxLength={512} autoComplete="off" spellCheck={false}
              onChange={event => setQuery(event.target.value)} className={fieldClass} aria-describedby="comparison-filter-notice" />
          </div>
          <div className="min-w-0">
            <label htmlFor="comparison-filter" className="mb-2 block font-mono text-xs">{copy.filterLabel}</label>
            <select id="comparison-filter" value={filter} onChange={event => setFilter(event.target.value as ComparisonFilter)} className={fieldClass}>
              {COMPARISON_FILTERS.map(value => <option key={value} value={value}>{copy.filterOption({ label: copy.filters[value], count: filterCounts[value] })}</option>)}
            </select>
          </div>
        </div>
        <p id="comparison-filter-notice" className="mt-3 font-serif text-sm text-ink-2">{copy.filterNotice}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role="status" className="font-mono text-xs">{copy.visibleTargets({ shown: visibleTargets.length, total: result.targets.length })}</p>
          {(query !== "" || filter !== "all") && <button type="button" onClick={resetView} className="border border-ink px-4 py-2 font-mono text-xs">{copy.resetView}</button>}
        </div>
      </section>}
      {result.targets.length === 0 && <p>{copy.empty}</p>}
      {result.targets.length > 0 && visibleTargets.length === 0 && <p className="border border-line p-5 font-serif text-sm">{copy.noMatches}</p>}
      {visibleTargets.map(({ target, index }) => <section key={`${target.before?.claimIndex ?? "none"}:${target.after?.claimIndex ?? "none"}`} data-testid="comparison-target" className="min-w-0 border border-line bg-paper">
        <header className="border-b border-line px-5 py-4">
          <h3 className="font-display text-xl">{copy.pairTitle({ index })}</h3>
          <p className="mt-2 font-mono text-xs text-seal">{copy.state[target.state]}</p>
          <p className="mt-1 font-mono text-xs text-ink-3">{copy.match[target.match]}</p>
        </header>
        <div className="grid min-w-0 md:grid-cols-2">{(["before", "after"] as const).map(side => {
          const original = target[side];
          return <div key={side} className="min-w-0 p-5 first:border-b first:border-line md:first:border-r md:first:border-b-0">
            <h4 className="font-mono text-xs uppercase tracking-wider text-ink-3">{copy[side]}</h4>
            <p className="mt-3 whitespace-pre-wrap break-words font-serif text-lg [overflow-wrap:anywhere]">{original?.claim ?? copy.noTarget}</p>
            {original && !original.ledgerAvailable && <p className="mt-3 text-sm text-seal">{copy.ledgerGap}</p>}
            {original && original.excludedRows > 0 && <p className="mt-3 text-sm text-ink-3">{copy.excluded({ rows: original.excludedRows })}</p>}
            <div className="mt-4">{original?.excerpts.map((row, rowIndex) => <Excerpt key={rowIndex} row={row} copy={copy}
              status={target.added.includes(row) ? copy.row.added : target.removed.includes(row) ? copy.row.removed :
                target.contextChanged.some(pair => pair[side] === row) ? copy.row.context : target.unchanged.some(pair => pair[side] === row) ? copy.row.unchanged : copy.row.retained} />)}</div>
          </div>;
        })}</div>
      </section>)}
      <details className="min-w-0 border border-line p-5">
        <summary className="cursor-pointer font-mono text-sm">{copy.receiptDetails}</summary>
        {result.questionChanged && <p className="mt-4 text-sm text-seal">{copy.questionChanged}</p>}
        {result.answerChanged && <p className="mt-2 text-sm text-seal">{copy.answerChanged}</p>}
        <div className="mt-5 grid min-w-0 gap-6 md:grid-cols-2">{(["before", "after"] as const).map(side => <section key={side} className="min-w-0">
          <h3 className="font-display text-xl">{copy[side]}</h3>
          <dl className="mt-3 space-y-3 font-mono text-xs">{([[copy.digest, result[side].digest], [copy.reportId, result[side].id], [copy.createdAt, result[side].createdAt]] as const).map(([label, value]) =>
            <div key={label}><dt className="text-ink-3">{label}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{value ?? copy.notRecorded}</dd></div>)}</dl>
          {(["question", "answer"] as const).map(field => <div key={field} className="mt-5"><h4 className="font-mono text-xs text-ink-3">{copy[field]}</h4>
            <pre className="mt-2 whitespace-pre-wrap break-words font-serif text-sm leading-relaxed [overflow-wrap:anywhere]">{result[side][field] ?? copy.notRecorded}</pre></div>)}
        </section>)}</div>
      </details>
    </div>}
  </section>;
}
