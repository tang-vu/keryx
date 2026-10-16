"use client";

import { createMessages } from "@/lib/i18n/messages";
import { useId, useRef, useState, type RefObject } from "react";
import type { EvidenceMatrixInput } from "@/lib/research/evidence-matrix";
import { buildSourceEvidenceLens, type SourceEvidenceLensModel } from "@/lib/research/source-evidence-lens";
import { useUiMessages } from "@/lib/i18n/ui-copy";



const copy = createMessages("en");

const remainingExcerpts = (count: number) => copy(count === 1 ? "reportSourceLens.remaining.one" : "reportSourceLens.remaining.other", { count });

export function SourceEvidenceLens({ run }: { run: EvidenceMatrixInput }) {
  const sourceKey = JSON.stringify(buildSourceEvidenceLens(run).sources.map(source => source.sourceId).sort());
  return <SourceEvidenceLensSelection key={sourceKey} run={run} />;
}

function SourceEvidenceLensSelection({ run }: { run: EvidenceMatrixInput }) {
  const [omittedSourceId, setOmittedSourceId] = useState<string | null>(null);
  const id = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const model = buildSourceEvidenceLens(run, omittedSourceId);
  const onOmit = (sourceId: string | null) => {
    if (sourceId === null) selectRef.current?.focus();
    setOmittedSourceId(sourceId);
  };
  return <SourceEvidenceLensView model={model} selectId={id} selectRef={selectRef} onOmit={onOmit} />;
}

export function SourceEvidenceLensView({ model, selectId, selectRef, onOmit }: {
  model: SourceEvidenceLensModel; selectId: string; selectRef?: RefObject<HTMLSelectElement | null>; onOmit: (sourceId: string | null) => void;
}) {
  const copy = useUiMessages();
  if (!model.available) return <p className="mt-5 text-sm text-ink-3">{copy("reportSourceLens.unavailable")}</p>;
  if (!model.sources.length) return <p className="mt-5 text-sm text-ink-3">{copy("reportSourceLens.empty")}</p>;
  const omitted = model.sources.find(source => source.sourceId === model.omittedSourceId);
  return <details className="mt-6 border-y border-line py-3">
    <summary className="min-h-11 cursor-pointer py-2 font-serif text-base text-ink">{copy("reportSourceLens.title")}</summary>
    <p className="mt-2 text-sm text-ink-3">{copy("reportSourceLens.intro")}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label htmlFor={selectId} className="min-w-0 flex-1 text-sm text-ink">
        {copy("reportSourceLens.select")}
        <select ref={selectRef} id={selectId} value={model.omittedSourceId ?? ""} onChange={event => onOmit(event.target.value || null)}
          className="mt-1 block min-h-11 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-serif text-base text-ink focus-visible:outline-2 focus-visible:outline-seal">
          <option value="">{copy("reportSourceLens.keepAll")}</option>
          {model.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.sourceName}</option>)}
        </select>
      </label>
      {omitted && <button type="button" onClick={() => onOmit(null)} className="min-h-11 border border-line px-4 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-seal">{copy("reportSourceLens.restore")}</button>}
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className="mt-4 break-words font-serif text-sm text-ink">
      {omitted ? copy(model.newlyMissingTargets === 1 ? "reportSourceLens.omitted.one" : "reportSourceLens.omitted.other", { count: model.newlyMissingTargets, source: omitted.sourceName }) : copy("reportSourceLens.original")}
      {model.alreadyMissingTargets > 0 && copy(model.alreadyMissingTargets === 1 ? "reportSourceLens.alreadyMissing.one" : "reportSourceLens.alreadyMissing.other", { count: model.alreadyMissingTargets })}
    </p>
    <ol className="mt-3 space-y-3">
      {model.rows.map(row => <li key={row.claimIndex} className="border-l-2 border-line pl-3">
        <p className="break-words font-serif text-sm text-ink">{row.claim}</p>
        <p className={`mt-1 text-sm ${row.state === "lost-last-excerpt" ? "text-seal" : "text-ink-3"}`}>
          {row.state === "already-missing" ? copy("reportSourceLens.missing") : row.state === "lost-last-excerpt" ? copy("reportSourceLens.lost") : remainingExcerpts(row.remaining.length)}
        </p>
        {row.remaining.length > 0 && <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-3">{copy("reportSourceLens.inspect")}</summary>
          {row.remaining.map((item, index) => <blockquote key={index} className="mt-2 border-l border-line pl-3 font-serif text-sm">
            <p className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">“{item.quote}”</p>
            <p className="mt-1 break-words text-ink-3">{item.contentVersion ? item.itemTitle ? copy("reportSourceLens.versionTitle", { marker: item.marker, source: item.sourceName, title: item.itemTitle, version: item.contentVersion }) : copy("reportSourceLens.version", { marker: item.marker, source: item.sourceName, version: item.contentVersion }) : <>{item.marker} · {item.sourceName}{item.itemTitle ? ` · ${item.itemTitle}` : ""}</>}</p>
          </blockquote>)}
        </details>}
      </li>)}
    </ol>
    <p className="mt-4 text-sm text-ink-3">{copy("reportSourceLens.qualification")}</p>
  </details>;
}
