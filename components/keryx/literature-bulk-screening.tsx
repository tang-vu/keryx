"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useUiCopy } from "@/lib/i18n/ui-copy";
import { literatureBulkScreeningCopy as english } from "@/locales/en/literature-bulk-screening";
import { changeLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { SCREENING_STATES, type LiteratureEntry, type LiteratureWorkspace } from "@/lib/papers/literature-workspace";
import { applyLiteratureScreening, LiteratureScreeningError, previewLiteratureScreening, type LiteratureScreeningPlan } from "@/lib/papers/literature-bulk-screening";

const button = "inline-flex min-h-11 items-center justify-center border border-line px-3 py-2 font-mono text-xs text-seal hover:border-ink disabled:opacity-50";
export function LiteratureBulkScreening({ workspace, visible }: { workspace: LiteratureWorkspace; visible: readonly LiteratureEntry[] }) {
  const copy = useUiCopy("literature-bulk-screening", english), id = useId();
  const [decision, setDecision] = useState<LiteratureEntry["screening"]>("include");
  const [plan, setPlan] = useState<LiteratureScreeningPlan>(), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const previewButton = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { if (plan) heading.current?.focus(); }, [plan]);
  useEffect(() => { if (!plan && !busy && restoreFocus.current) {
    restoreFocus.current = false;
    if (previewButton.current?.disabled) summary.current?.focus(); else previewButton.current?.focus();
  } }, [plan, busy]);
  const cancel = () => { restoreFocus.current = true; setPlan(undefined); setFailure(""); setMessage(""); };
  const apply = async () => {
    if (!plan || busy) return;
    setBusy(true); setFailure(""); setMessage("");
    try {
      await changeLiteratureWorkspace(current => applyLiteratureScreening(current, plan));
      restoreFocus.current = true; setPlan(undefined); setMessage(copy.saved);
    } catch (issue) { setFailure(issue instanceof LiteratureScreeningError && issue.code === "stale-selection" ? copy.stale : copy.failed); }
    finally { setBusy(false); }
  };
  return <details className="mt-4 min-w-0 border border-line bg-panel p-4">
    <summary ref={summary} className="min-h-11 cursor-pointer py-3 font-mono text-xs text-seal underline">{copy.summary}</summary>
    <div className="mt-2 min-w-0">
      <label htmlFor={id} className="font-mono text-xs text-ink-2">{copy.decision}</label>
      <select id={id} value={decision} disabled={busy} onChange={event => setDecision(event.currentTarget.value as LiteratureEntry["screening"])} className="mt-1 block min-h-11 w-full min-w-0 border border-line bg-paper-2 px-3 py-2 font-serif text-base text-ink">
        {Object.entries(SCREENING_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button ref={previewButton} type="button" className={`${button} mt-3`} disabled={busy || visible.length === 0} onClick={() => {
        try { setPlan(previewLiteratureScreening(workspace, visible.map(entry => entry.paper.url), decision)); setFailure(""); setMessage(""); }
        catch { setFailure(copy.failed); }
      }}>{copy.preview}</button>
      {plan && <section aria-labelledby={`${id}-preview`} className="mt-4 border border-ink bg-paper p-4">
        <h3 id={`${id}-preview`} ref={heading} tabIndex={-1} className="font-display text-lg text-ink">{copy.previewTitle}</h3>
        <p className="mt-2 font-mono text-xs text-ink-2">{copy.count}: {plan.entries.length}</p>
        <p className="mt-2 font-serif text-sm text-ink">{copy.target}: {SCREENING_STATES[plan.screening]}</p>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy.notice}</p>
        <ol className="mt-3 list-inside list-decimal space-y-2 break-words font-serif text-sm text-ink">{plan.entries.map(entry => <li key={entry.paper.url}>
          <span>{entry.paper.title}</span> <span className="block break-all font-mono text-xs text-ink-3">{entry.paper.url}</span>
        </li>)}</ol>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={button} disabled={busy} onClick={() => void apply()}>{busy ? copy.applying : copy.confirm}</button>
          <button type="button" className={button} disabled={busy} onClick={cancel}>{copy.cancel}</button>
        </div>
      </section>}
      {(failure || message) && <p role={failure ? "alert" : "status"} className="mt-3 font-serif text-sm text-seal">{failure || message}</p>}
    </div>
  </details>;
}
