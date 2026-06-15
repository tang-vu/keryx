"use client";

/**
 * One row in the live reasoning console. Renders a phase chip plus the step
 * message, and for `decide` steps a colored BUY/SKIP/CACHE badge with the
 * source name + rationale. Fades/slides in on mount.
 */

import type { Decision, TraceStep } from "@/lib/types";
import { ACTION_STYLES, PHASE_STYLES, fmtUsdc } from "./phase-style";
import { cn } from "@/lib/utils";

export function TraceRow({ step }: { step: TraceStep }) {
  const ps = PHASE_STYLES[step.phase] ?? PHASE_STYLES.done;
  const Icon = ps.icon;
  const decision =
    step.phase === "decide" && step.detail
      ? (step.detail as Decision)
      : null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex gap-3 py-2.5">
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
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              ps.chip,
            )}
          >
            {ps.label}
          </span>
          {decision && <DecisionBadge decision={decision} />}
        </div>

        {decision ? (
          <DecisionBody decision={decision} />
        ) : (
          <p className="mt-1 text-sm leading-snug text-foreground/80">
            {step.message}
          </p>
        )}
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: Decision }) {
  const as = ACTION_STYLES[decision.action] ?? ACTION_STYLES.SKIP;
  const Icon = as.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold",
        as.badge,
      )}
    >
      <Icon className="h-3 w-3" />
      {as.label}
    </span>
  );
}

function DecisionBody({ decision }: { decision: Decision }) {
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">
          {decision.sourceName}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          ${fmtUsdc(decision.price)} · EV {Math.round(decision.expectedValue * 100)}%
        </span>
      </div>
      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
        {decision.rationale}
      </p>
    </div>
  );
}
