"use client";

import { useId, useRef, useState, type RefObject } from "react";
import type { EvidenceMatrixInput } from "@/lib/research/evidence-matrix";
import { buildSourceEvidenceLens, type SourceEvidenceLensModel } from "@/lib/research/source-evidence-lens";

const excerptCount = (count: number) => `${count} recorded excerpt${count === 1 ? "" : "s"}`;

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
  if (!model.available) return <p className="mt-5 text-sm text-ink-3">Source inspection unavailable: this report has no stored excerpt ledger.</p>;
  if (!model.sources.length) return <p className="mt-5 text-sm text-ink-3">No inspectable non-demo excerpts are recorded for source inspection.</p>;
  const omitted = model.sources.find(source => source.sourceId === model.omittedSourceId);
  return <details className="mt-6 border-y border-line py-3">
    <summary className="min-h-11 cursor-pointer py-2 font-serif text-base text-ink">What if a source were missing?</summary>
    <p className="mt-2 text-sm text-ink-3">Temporarily leave out one source to see which research targets retain excerpts in this report.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label htmlFor={selectId} className="min-w-0 flex-1 text-sm text-ink">
        Inspect without
        <select ref={selectRef} id={selectId} value={model.omittedSourceId ?? ""} onChange={event => onOmit(event.target.value || null)}
          className="mt-1 block min-h-11 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-2 font-serif text-base text-ink focus-visible:outline-2 focus-visible:outline-seal">
          <option value="">Keep every source</option>
          {model.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.sourceName}</option>)}
        </select>
      </label>
      {omitted && <button type="button" onClick={() => onOmit(null)} className="min-h-11 border border-line px-4 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-seal">Restore source</button>}
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className="mt-4 break-words font-serif text-sm text-ink">
      {omitted ? `${model.newlyMissingTargets} research target${model.newlyMissingTargets === 1 ? " loses its" : "s lose their"} last recorded excerpt without ${omitted.sourceName}.` : "Showing the original excerpt ledger."}
      {model.alreadyMissingTargets > 0 && ` ${model.alreadyMissingTargets} target${model.alreadyMissingTargets === 1 ? " already had" : "s already had"} no inspectable excerpts.`}
    </p>
    <ol className="mt-3 space-y-3">
      {model.rows.map(row => <li key={row.claimIndex} className="border-l-2 border-line pl-3">
        <p className="break-words font-serif text-sm text-ink">{row.claim}</p>
        <p className={`mt-1 text-sm ${row.state === "lost-last-excerpt" ? "text-seal" : "text-ink-3"}`}>
          {row.state === "already-missing" ? "No inspectable excerpts in the original report." : row.state === "lost-last-excerpt" ? "No excerpts remain in this view." : `${excerptCount(row.remaining.length)} remain.`}
        </p>
        {row.remaining.length > 0 && <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-3">Inspect remaining excerpts</summary>
          {row.remaining.map((item, index) => <blockquote key={index} className="mt-2 border-l border-line pl-3 font-serif text-sm">
            <p className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">“{item.quote}”</p>
            <p className="mt-1 break-words text-ink-3">{item.marker} · {item.sourceName}{item.itemTitle ? ` · ${item.itemTitle}` : ""}{item.contentVersion ? ` · version ${item.contentVersion}` : ""}</p>
          </blockquote>)}
        </details>}
      </li>)}
    </ol>
    <p className="mt-4 text-sm text-ink-3">Targets are requested topics, not verified assertions. Excerpts do not prove truth or independent corroboration. This view keeps the answer, confidence and payments unchanged and makes no new requests.</p>
  </details>;
}
