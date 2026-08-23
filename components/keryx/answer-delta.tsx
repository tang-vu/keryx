/** Public receipt-to-receipt comparison for a same-question re-ask. */

import Link from "next/link";
import type { AnswerDelta } from "@/lib/answers-delta";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedUsdc(value: number): string {
  if (Math.abs(value) < 0.0000005) return "$0.0000";
  return `${value > 0 ? "+" : "−"}$${Math.abs(value).toFixed(4)}`;
}

export function AnswerDeltaPanel({ delta }: { delta: AnswerDelta }) {
  const coverage = delta.coverage;
  return (
    <section aria-label="Re-ask evidence delta" className="mt-8 max-w-[860px] border border-ink bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-3 text-cream">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
          Living answer · receipt delta
        </p>
        <Link
          href={`/dispatch/${delta.previousId}`}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream/75 underline decoration-cream/40 underline-offset-2 hover:text-cream"
        >
          Compare parent receipt ↗
        </Link>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <DeltaCell
          label="Citations"
          value={`${delta.previousCitations} → ${delta.currentCitations}`}
          detail={`${delta.retainedSources} source${delta.retainedSources !== 1 ? "s" : ""} retained`}
        />
        <DeltaCell
          label="Evidence coverage"
          value={coverage ? `${pct(coverage.previousAverage)} → ${pct(coverage.currentAverage)}` : "Not sampled"}
          detail={
            coverage
              ? `${coverage.improvedClaims} improved · ${coverage.regressedClaims} regressed`
              : "Historical receipt lacks claim coverage"
          }
        />
        <DeltaCell
          label="Confidence"
          value={`${delta.previousConfidence ?? "—"} → ${delta.currentConfidence ?? "—"}`}
          detail="Agent verdict, evidence-bounded"
        />
        <DeltaCell
          label="Settled to creators"
          value={delta.settlement ? signedUsdc(delta.settlement.deltaUsdc) : "Not provable"}
          detail={
            delta.settlement
              ? `$${delta.settlement.previousTotalUsdc.toFixed(4)} → $${delta.settlement.currentTotalUsdc.toFixed(4)}`
              : "Circle-settled ledger rows are incomplete"
          }
        />
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-[10.5px] leading-[1.55] text-ink-2">
          <SourceList label="Added" sources={delta.addedSources.map((source) => source.sourceName)} />
          <SourceList label="Removed" sources={delta.removedSources.map((source) => source.sourceName)} />
          <SourceList
            label="Changed assets"
            sources={delta.changedAssets.map((item) => item.itemTitle ?? item.sourceName)}
          />
          {delta.previousEvidenceSpans !== null && delta.currentEvidenceSpans !== null ? (
            <p>
              <span className="uppercase tracking-[0.1em] text-ink-3">Verified spans</span>{" "}
              {delta.previousEvidenceSpans} → {delta.currentEvidenceSpans}
            </p>
          ) : null}
        </div>
        <p className="mt-3 max-w-[74ch] font-mono text-[9.5px] leading-[1.55] text-faint">
          Both dispatches remain immutable. This compares cited identities, exact versions,
          evidence coverage and Circle-settled totals; it does not claim the newer answer is better.
        </p>
      </div>
    </section>
  );
}

function DeltaCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-paper px-5 py-4">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.13em] text-ink-3">{label}</p>
      <p className="mt-1 font-display text-[21px] tabular-nums text-ink">{value}</p>
      <p className="mt-1 font-mono text-[9px] leading-[1.45] text-faint">{detail}</p>
    </div>
  );
}

function SourceList({ label, sources }: { label: string; sources: string[] }) {
  return (
    <p>
      <span className="uppercase tracking-[0.1em] text-ink-3">{label}</span>{" "}
      {sources.length > 0 ? sources.join(", ") : "none"}
    </p>
  );
}
