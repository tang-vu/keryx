"use client";

import { useState } from "react";
import type { AskStreamState } from "@/lib/hooks/use-ask-stream";
import { AnswerCard } from "./answer-card";
import { ReasoningConsole } from "./reasoning-console";
import { CreatorsPaidPanel } from "./creators-paid-panel";
import { stepPaymentTotals } from "./budget-meter";
import { fmtUsdc } from "./phase-style";
import { ReportActions } from "./report-actions";

export interface ResearchTurnData {
  id: number;
  question: string;
  payer: string;
  state: AskStreamState;
  stopped?: boolean;
}

export function ResearchTurn({ turn }: { turn: ResearchTurnData }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const { state, stopped } = turn;
  const streaming = !stopped && state.status === "streaming";
  const totals = stepPaymentTotals(state.steps);
  const unsettled = (["pending", "simulated", "unverified", "failed"] as const)
    .filter(status => totals[status] > 0)
    .map(status => `${fmtUsdc(totals[status])} ${status}`).join(" · ");
  return <article className="min-w-0 space-y-4" aria-label={`Research: ${turn.question}`} data-testid="research-turn">
    <div className="ml-auto max-w-[90%] border border-line bg-paper-2 px-4 py-3 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-wide text-ink-3">You · {turn.payer} · source cap {fmtUsdc(state.budget)} USDC</p>
      <p className="mt-1 whitespace-pre-wrap break-words font-serif text-lg text-ink">{turn.question}</p>
    </div>
    <div className="min-w-0">
      {state.run && <div id={`answer-${turn.id}`}>
        <AnswerCard run={state.run} meta={state.meta} payments={state.payments} permalink={`${typeof window === "undefined" ? "" : window.location.origin}/dispatch/${state.run.id}`} />
        <ReportActions run={state.run} meta={state.meta} payments={state.payments} />
      </div>}
      {streaming && !state.run && <div className="border border-line bg-paper px-4 py-4" role="status" aria-live="polite">
        <p className="font-mono text-xs uppercase tracking-wide text-seal">Keryx · Research in progress</p>
        <p className="mt-2 break-words font-serif text-lg">{state.steps.at(-1)?.message ?? "Finding sources worth reading…"}</p>
      </div>}
      {stopped && <p role="status" className="border border-line bg-paper p-4 text-sm text-ink-2">Stopped waiting for this research. Payments already signed may still settle; stopping does not refund them.</p>}
      {!stopped && state.status === "error" && <div role="alert" className="border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p>{state.error ?? "Research could not finish. Try another question."}</p>
        {state.errorKind === "rate-limit" && <p className="mt-2">Connect a funded session or try again{state.retryAfter ? ` in ${state.retryAfter}s` : " shortly"}.</p>}
      </div>}
      <details className="mt-3 border border-line bg-paper" onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer break-words px-4 py-3 font-mono text-xs text-ink-2">
          Decision log and creator payments · {state.steps.length} steps · {fmtUsdc(totals.settled)} USDC settled of {fmtUsdc(state.budget)} cap{unsettled && ` · ${unsettled}`}{state.meta?.mode === "offline" && " · offline simulation"}
        </summary>
        {evidenceOpen && <div className="grid min-w-0 gap-6 border-t border-line p-4 lg:grid-cols-[1.6fr_1fr]">
          <ReasoningConsole steps={state.steps} streaming={streaming} budget={state.budget} />
          <CreatorsPaidPanel payments={state.payments} mode={state.meta?.mode ?? null} streaming={streaming} />
        </div>}
      </details>
    </div>
  </article>;
}
