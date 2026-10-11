/** Public receipt-to-receipt comparison for a same-question re-ask. */

import { createMessages } from "@/lib/i18n/messages";
import Link from "next/link";
import type { AnswerDelta } from "@/lib/answers-delta";

const copy = createMessages("en");

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
    <section aria-label={copy("answerDelta.label")} className="mt-8 max-w-[860px] border border-ink bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink bg-ink px-5 py-3 text-cream">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em]">
          {copy("answerDelta.kicker")}
        </p>
        <Link
          href={`/dispatch/${delta.previousId}`}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream/75 underline decoration-cream/40 underline-offset-2 hover:text-cream"
        >
          {copy("answerDelta.compareParent")}
        </Link>
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
        <DeltaCell
          label={copy("answerDelta.citations")}
          value={`${delta.previousCitations} → ${delta.currentCitations}`}
          detail={copy(delta.retainedSources === 1 ? "answerDelta.retained.one" : "answerDelta.retained.other", { count: delta.retainedSources })}
        />
        <DeltaCell
          label={copy("answerDelta.coverage")}
          value={coverage ? `${pct(coverage.previousAverage)} → ${pct(coverage.currentAverage)}` : copy("answerDelta.notSampled")}
          detail={
            coverage
              ? [copy(coverage.improvedClaims === 1 ? "answerDelta.improved.one" : "answerDelta.improved.other", { count: coverage.improvedClaims }), copy(coverage.regressedClaims === 1 ? "answerDelta.regressed.one" : "answerDelta.regressed.other", { count: coverage.regressedClaims })].join(" · ")
              : copy("answerDelta.historicalNoCoverage")
          }
        />
        <DeltaCell
          label={copy("answerDelta.confidence")}
          value={`${delta.previousConfidence ?? "—"} → ${delta.currentConfidence ?? "—"}`}
          detail={copy("answerDelta.verdict")}
        />
        <DeltaCell
          label={copy("answerDelta.settled")}
          value={delta.settlement ? signedUsdc(delta.settlement.deltaUsdc) : copy("answerDelta.notProvable")}
          detail={
            delta.settlement
              ? `$${delta.settlement.previousTotalUsdc.toFixed(4)} → $${delta.settlement.currentTotalUsdc.toFixed(4)}`
              : copy("answerDelta.incompleteLedger")
          }
        />
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-[10.5px] leading-[1.55] text-ink-2">
          <SourceList label={copy("answerDelta.added")} sources={delta.addedSources.map((source) => source.sourceName)} />
          <SourceList label={copy("answerDelta.removed")} sources={delta.removedSources.map((source) => source.sourceName)} />
          <SourceList
            label={copy("answerDelta.changedAssets")}
            sources={delta.changedAssets.map((item) => item.itemTitle ?? item.sourceName)}
          />
          {delta.previousEvidenceSpans !== null && delta.currentEvidenceSpans !== null ? (
            <p>
              <span className="uppercase tracking-[0.1em] text-ink-3">{copy("answerDelta.verifiedSpans")}</span>{" "}
              {delta.previousEvidenceSpans} → {delta.currentEvidenceSpans}
            </p>
          ) : null}
        </div>
        <p className="mt-3 max-w-[74ch] font-mono text-[9.5px] leading-[1.55] text-faint">
          {copy("answerDelta.notice")}
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
      {sources.length > 0 ? sources.join(", ") : copy("answerDelta.none")}
    </p>
  );
}
