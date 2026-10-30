"use client";

import { originalTechnicalText } from "@/shared/i18n/original-technical-text";
import { createMessages, type MessageKey } from "@/lib/i18n/messages";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EvidenceMatrixInput } from "@/lib/research/evidence-matrix";
import { buildSourceEvidenceLens, type SourceEvidenceLensModel } from "@/lib/research/source-evidence-lens";
import { UiMessage, useUiMessages } from "@/lib/i18n/ui-copy";
import { cn } from "@/lib/utils";



const defaultMessages = createMessages("en");

export function SourceEvidenceLens({ run }: { run: EvidenceMatrixInput }) {
  const sourceKey = JSON.stringify(buildSourceEvidenceLens(run).sources.map(source => source.sourceId).sort());
  return <SourceEvidenceLensSelection key={sourceKey} run={run} />;
}

function SourceEvidenceLensSelection({ run }: { run: EvidenceMatrixInput }) {
  const message = useUiMessages();
  const [omittedSourceId, setOmittedSourceId] = useState<string | null>(null);
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const model = buildSourceEvidenceLens(run, omittedSourceId);
  const onOmit = (sourceId: string | null) => {
    if (sourceId === null) selectRef.current?.focus();
    setOmittedSourceId(sourceId);
  };
  return <SourceEvidenceLensView messages={message} renderMessage={(messageKey, values) => <UiMessage messageKey={messageKey} values={values} />} model={model} selectId={id} selectRef={selectRef} onOmit={onOmit} />;
}

export function SourceEvidenceLensView({ model, selectId, selectRef, onOmit, messages = defaultMessages, renderMessage }: {
  messages?: ReturnType<typeof createMessages>; model: SourceEvidenceLensModel; selectId: string; selectRef?: RefObject<HTMLSelectElement | null>; onOmit: (sourceId: string | null) => void;
  renderMessage?: (key: MessageKey, values?: Record<string, string | number>) => ReactNode;
}) {
  const copy = messages;
  const text = renderMessage ?? copy;
  if (!model.available) return <p className="mt-5 border-l-2 border-line bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{text("reportSourceLens.unavailable")}</p>;
  if (!model.sources.length) return <p className="mt-5 border-l-2 border-line bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{text("reportSourceLens.empty")}</p>;
  const omitted = model.sources.find(source => source.sourceId === model.omittedSourceId);
  return <details className="@container/source-lens group/source-lens mt-6 min-w-0 border-y border-line py-2">
    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 font-serif text-base text-ink [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal [&::-webkit-details-marker]:hidden">
      <span>{text("reportSourceLens.title")}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 transition-transform duration-180 group-open/source-lens:rotate-90 motion-reduce:transition-none"><path d="m9 5 7 7-7 7" /></svg>
    </summary>
    <p className="mt-2 text-sm leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{text("reportSourceLens.intro")}</p>
    <p id={`${selectId}-notice`} className="mt-3 border-l-2 border-line bg-paper-2 px-4 py-3 text-sm leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{text("reportSourceLens.qualification")}</p>
    <div className="mt-5 border border-line bg-paper-2 p-4 sm:p-5">
      <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">{text("reportSourceLens.localView")}</p>
      <div className="mt-3 flex min-w-0 flex-col items-stretch gap-3 @min-[26rem]/source-lens:flex-row @min-[26rem]/source-lens:items-end">
      <label htmlFor={selectId} className="min-w-0 flex-1 text-sm text-ink [overflow-wrap:anywhere]">
        {text("reportSourceLens.select")}
        <select ref={selectRef} id={selectId} value={model.omittedSourceId ?? ""} onChange={event => onOmit(event.target.value || null)}
          aria-describedby={`${selectId}-notice`}
          className="mt-2 block min-h-[44px] w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-serif text-base text-ink [contain:paint] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
          <option value="">{copy("reportSourceLens.keepAll")}</option>
          {model.sources.map(source => <option lang="und" dir="auto" key={source.sourceId} value={source.sourceId}>{source.sourceName}</option>)}
        </select>
      </label>
      {omitted && <button type="button" onClick={() => onOmit(null)} className="min-h-[44px] min-w-0 max-w-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-180 hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal motion-reduce:transition-none">{text("reportSourceLens.restore")}</button>}
      </div>
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className={cn("mt-4 border-l-2 px-4 py-3 font-serif text-sm leading-relaxed text-ink transition-colors duration-180 [overflow-wrap:anywhere] motion-reduce:transition-none", omitted ? "border-seal bg-seal/5" : "border-line bg-paper-2")}>
      {omitted ? text(model.newlyMissingTargets === 1 ? "reportSourceLens.omitted.one" : "reportSourceLens.omitted.other", { count: model.newlyMissingTargets, source: omitted.sourceName }) : text("reportSourceLens.original")}
      {model.alreadyMissingTargets > 0 && text(model.alreadyMissingTargets === 1 ? "reportSourceLens.alreadyMissing.one" : "reportSourceLens.alreadyMissing.other", { count: model.alreadyMissingTargets })}
    </p>
    <ol aria-label={copy("reportSourceLens.title")} className="my-5 grid min-w-0 grid-cols-1 gap-4 @min-[44rem]/source-lens:grid-cols-2">
      {model.rows.map(row => <li key={row.claimIndex} className={cn("min-w-0 border bg-paper p-4 transition-colors duration-180 motion-reduce:transition-none sm:p-5", row.state === "lost-last-excerpt" ? "border-seal/50" : "border-line")}>
        <header>
        <h3 id={`${selectId}-claim-${row.claimIndex}`} lang="und" dir="auto" className="font-serif text-lg leading-relaxed text-ink [overflow-wrap:anywhere]">{originalTechnicalText(row.claim)}</h3>
        <p key={`${row.state}-${row.remaining.length}`} className={cn("mt-2 text-sm leading-relaxed [overflow-wrap:anywhere] motion-safe:animate-[kxSourceArrive_180ms_ease-out_both]", row.state === "lost-last-excerpt" ? "text-seal" : "text-ink-3")}>
          {row.state === "already-missing" ? text("reportSourceLens.missing") : row.state === "lost-last-excerpt" ? text("reportSourceLens.lost") : text(row.remaining.length === 1 ? "reportSourceLens.remaining.one" : "reportSourceLens.remaining.other", { count: row.remaining.length })}
        </p>
        </header>
        <dl className="my-4 grid min-w-0 grid-cols-1 gap-3 border-y border-line py-3 @min-[18rem]/source-lens:grid-cols-2">
          <div className="flex min-w-0 flex-col"><dt className="font-mono text-xs text-ink-3 [overflow-wrap:anywhere] @min-[18rem]/source-lens:min-h-[2lh]">{text("reportSourceLens.originalExcerpts")}</dt><dd className="mt-auto pt-1 font-mono text-2xl tabular-nums text-ink">{row.originalExcerpts}</dd></div>
          <div className="flex min-w-0 flex-col"><dt className="font-mono text-xs text-ink-3 [overflow-wrap:anywhere] @min-[18rem]/source-lens:min-h-[2lh]">{text("reportSourceLens.viewExcerpts")}</dt><dd className={cn("mt-auto pt-1 font-mono text-2xl tabular-nums", row.state === "lost-last-excerpt" ? "text-seal" : "text-ink")}>{row.remaining.length}</dd></div>
        </dl>
        {row.remaining.length > 0 && <details>
          <summary aria-describedby={`${selectId}-claim-${row.claimIndex}`} className="min-h-[44px] cursor-pointer py-3 text-sm text-ink-2 hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{text("reportSourceLens.inspect")}</summary>
          {row.remaining.map((item, index) => <blockquote key={index} className="mt-2 border-l border-line pl-3 font-serif text-sm">
            <p lang="und" dir="auto" className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">“{originalTechnicalText(item.quote)}”</p>
            <p className="mt-1 text-ink-3 [overflow-wrap:anywhere]">{item.contentVersion ? item.itemTitle ? text("reportSourceLens.versionTitle", { marker: item.marker, source: item.sourceName, title: item.itemTitle, version: item.contentVersion }) : text("reportSourceLens.version", { marker: item.marker, source: item.sourceName, version: item.contentVersion }) : <>{item.marker} · {item.sourceName}{item.itemTitle ? ` · ${item.itemTitle}` : ""}</>}</p>
          </blockquote>)}
        </details>}
      </li>)}
    </ol>
  </details>;
}
