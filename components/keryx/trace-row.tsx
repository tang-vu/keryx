"use client";

/**
 * One row in the live reasoning console. Renders a phase chip plus the step
 * message, and for `decide` steps a colored BUY/SKIP/CACHE badge with the
 * source name + rationale. The owning ledger controls live arrival motion.
 */





import { Globe } from "lucide-react";
import type { Decision, TraceStep } from "@/lib/types";
import { isDecisionRecord } from "@/lib/research/decision-record";
import { parseSelectionDiagnostic, type SelectionDiagnostic } from "@/lib/research/selection-diagnostic";
import { ACTION_STYLES, PHASE_STYLES, fmtUsdc } from "./phase-style";
import { cn } from "@/lib/utils";
import { useUiMessages } from "@/lib/i18n/ui-copy";



export function TraceRow({ step }: { step: TraceStep }) {
  const message = useUiMessages();
  const ps = PHASE_STYLES[step.phase] ?? PHASE_STYLES.done;
  const Icon = ps.icon;
  const decision =
    step.phase === "decide" && isDecisionRecord(step.detail)
      ? step.detail
      : null;
  const diagnostic = step.phase === "decide" ? parseSelectionDiagnostic(step.detail) : undefined;

  return (
    <div className="flex min-w-0 gap-3 py-3 [overflow-wrap:anywhere]">
      <div className="relative flex flex-col items-center">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            ps.chip,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
              ps.chip,
            )}
          >
            {ps.label}
          </span>
          {decision && <DecisionBadge decision={decision} />}
        </div>

        {decision ? (
          <DecisionBody decision={decision} />
        ) : diagnostic ? (
          <SelectionDiagnosticBody message={step.message} diagnostic={diagnostic} />
        ) : (
          <p className="mt-1 text-sm leading-snug text-ink-2">{step.message}</p>
        )}
      </div>
    </div>
  );
}

function SelectionDiagnosticBody({ message: diagnosticMessage, diagnostic }: { message: string; diagnostic: SelectionDiagnostic }) {
  const message = useUiMessages();
  const counts = diagnostic.counts;
  return <div className="mt-1 space-y-2 text-sm leading-snug text-ink-2" data-testid="selection-diagnostic-row">
    <p className="font-semibold">{diagnostic.outcome === "refused" ? message("sourceDecision.refused") : message("sourceDecision.partiallyWithheld")}</p>
    <p>{diagnosticMessage}</p>
    <p className="break-words font-mono text-[11px]">
      {[
        message(counts.candidateCount === 1 ? "sourceDecision.candidateCount.one" : "sourceDecision.candidateCount.other", { count: counts.candidateCount }),
        message(counts.targetCount === 1 ? "sourceDecision.targetCount.one" : "sourceDecision.targetCount.other", { count: counts.targetCount }),
        message(counts.decisionCount === 1 ? "sourceDecision.proposalCount.one" : "sourceDecision.proposalCount.other", { count: counts.decisionCount }),
      ].join(" · ")}<br />
      {[
        message(counts.matchedCandidateCount === 1 ? "sourceDecision.matchedCount.one" : "sourceDecision.matchedCount.other", { count: counts.matchedCandidateCount }),
        message(counts.validActionableCount === 1 ? "sourceDecision.actionableCount.one" : "sourceDecision.actionableCount.other", { count: counts.validActionableCount }),
        message(counts.withheldCandidateCount === 1 ? "sourceDecision.withheldCount.one" : "sourceDecision.withheldCount.other", { count: counts.withheldCandidateCount }),
        message(counts.invalidRowCount === 1 ? "sourceDecision.invalidCount.one" : "sourceDecision.invalidCount.other", { count: counts.invalidRowCount }),
      ].join(" · ")}
    </p>
    <p className="break-words text-xs">{message(diagnostic.truncated ? "sourceDecision.truncatedReasons" : "sourceDecision.reasons", { reasons: Array.from(new Set(diagnostic.reasons.map(reason => reason.code))).join(", ") })}</p>
  </div>;
}

function DecisionBadge({ decision }: { decision: Decision }) {
  const as = ACTION_STYLES[decision.action] ?? ACTION_STYLES.SKIP;
  const Icon = as.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold",
        as.badge,
      )}
    >
      <Icon className="h-3 w-3" />
      {as.label}
    </span>
  );
}

function DecisionBody({ decision }: { decision: Decision }) {
  const message = useUiMessages();
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-serif text-[15px] text-ink">
          {decision.sourceName}
        </span>
        {decision.external && (
          <span className="inline-flex items-center gap-1 rounded border border-line bg-paper-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            <Globe className="h-3 w-3" /> {message("sourceDecision.marketplace")}
          </span>
        )}
        <span className="font-mono text-[11px] text-ink-3">
          {message("sourceDecision.priceAndValue", { price: fmtUsdc(decision.price), value: Math.round(decision.expectedValue * 100) })}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
        {decision.rationale}
      </p>
    </div>
  );
}
