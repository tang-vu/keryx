"use client";
import { useMemo, useState } from "react";
import { inspectReadDecisions, previewReadPolicy } from "@/lib/research-audit/decision-inspection";
import { decisionLabCopy as copy } from "@/lib/research-audit/decision-lab-copy";

const fieldClass = "mt-1 block min-h-11 w-full max-w-sm border border-line bg-paper px-3 py-2 font-mono text-sm";
const buttonClass = "min-h-11 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-50";

export function DecisionCheckpointInspection({ packet }: { packet: unknown }) {
  const inspection = useMemo(() => inspectReadDecisions(packet), [packet]);
  const [remaining, setRemaining] = useState("0.005");
  const [attention, setAttention] = useState("2");
  const [preview, setPreview] = useState<ReturnType<typeof previewReadPolicy> | null>(null);
  if (!inspection) return <p role="status">{copy.refused}</p>;
  const compare = () => {
    // A decimal entered by the reader is converted without rounding. The shared
    // preview refuses any amount the existing Number policy cannot represent.
    const match = /^(0|[1-9][0-9]{0,10})(?:\.([0-9]{1,6}))?$/.exec(remaining);
    const remainingMicros = match ? (BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0"))).toString() : "invalid";
    const attentionLimit = /^(0|[1-9][0-9]{0,4})$/.test(attention) ? Number(attention) : NaN;
    setPreview(previewReadPolicy(packet, { remainingMicros, attentionLimit }));
  };
  return <div className="mt-5 min-w-0 space-y-5">
    <section className="border border-line bg-paper p-4 sm:p-5" aria-label={copy.checkpointTitle}>
      <h2 className="font-display text-2xl">{copy.checkpointTitle}</h2>
      <div className="mt-4 flex flex-wrap gap-3" aria-label={copy.totals}>
        {Object.entries(inspection.totals.byDisposition).map(([action, count]) => <div key={action} className="min-w-20 border border-line p-3">
          <span className="block font-mono text-xs">{action}</span><span className="mt-1 block font-display text-2xl">{count}</span>
        </div>)}
      </div>
      <p className="mt-3 text-xs text-ink-3">{copy.totals}</p>
      <p className="mt-2 text-xs text-ink-3">{copy.stops}: {inspection.totals.stopCheckpoints} · {copy.pending}: {inspection.totals.unresolvedCandidates}</p>
      <div className="mt-4 max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[650px] border-collapse text-left text-xs">
          <thead><tr>{[copy.candidate, copy.round, copy.proposal, copy.plan, copy.checkpoint, copy.result, copy.rule].map(label => <th key={label} scope="col" className="border-b border-line p-2 font-mono">{label}</th>)}</tr></thead>
          <tbody>{inspection.rows.map(row => <tr key={row.sequence} className="border-b border-line">
            <th scope="row" className="p-2 font-mono">{row.scope === "run" ? copy.runContext : row.candidate}</th>
            <td className="p-2 font-mono">{row.round}</td>
            <td className="p-2 font-mono">{row.scope === "run" ? "—" : row.proposal}</td><td className="p-2 font-mono">{row.scope === "run" ? "—" : row.plan}</td>
            <td className="p-2">{row.check.kind}</td><td className="p-2 font-mono">{row.outcome.action}</td><td className="p-2">{row.outcome.rule}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="border border-line bg-paper p-4 sm:p-5" aria-label={copy.previewTitle}>
      <h2 className="font-display text-2xl">{copy.previewTitle}</h2>
      <p className="mt-2 max-w-3xl text-sm text-ink-3">{copy.previewHelp}</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <label className="text-sm">{copy.remaining}<input className={fieldClass} inputMode="decimal" maxLength={32} value={remaining} onChange={event => { setRemaining(event.target.value); setPreview(null); }} /></label>
        <label className="text-sm">{copy.attention}<input className={fieldClass} inputMode="numeric" maxLength={5} value={attention} onChange={event => { setAttention(event.target.value); setPreview(null); }} /></label>
      </div>
      <button type="button" onClick={compare} className={`${buttonClass} mt-4`}>{copy.preview}</button>
      {preview && (preview.status === "unavailable" ? <p role="status" className="mt-3 text-sm">{copy.noPreview}</p> : <div className="mt-4">
        <p role="status" className="text-sm text-ink-3">{copy.previewScope}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[380px] text-left text-xs">
          <thead><tr>{[copy.candidate, copy.checkpoint, copy.before, copy.after].map(label => <th scope="col" key={label} className="border-b border-line p-2">{label}</th>)}</tr></thead>
          <tbody>{preview.comparisons.map(row => <tr key={row.sequence} className="border-b border-line">
            <th scope="row" className="p-2 font-mono">{row.candidate || "—"}</th><td className="p-2">{row.originalCheck.kind}</td>
            <td className="p-2 font-mono">{row.originalOutcome.action}</td><td className={`p-2 font-mono ${row.changed ? "text-seal" : ""}`}>{row.previewOutcome.action}</td>
          </tr>)}</tbody>
        </table></div>
      </div>)}
    </section>
  </div>;
}
