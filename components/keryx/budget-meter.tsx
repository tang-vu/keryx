"use client";

/**
 * Live budget meter for §I · The decision. Fills as each fetch toll and
 * citation reward settles, so the viewer watches the agent spend against the
 * authorized budget in real time — and visibly stop early with USDC still
 * unspent. Treasury-green fill on a crisp banknote track; a vermillion hairline
 * marks the hard cap the orchestrator (not the model) enforces.
 */

import type { TraceStep } from "@/lib/types";
import { isPaymentRecord, paymentSettlementStatus } from "@/lib/payments/payment-state";
import { fmtUsdc } from "./phase-style";

/** Keep ambiguous and offline amounts separate from confirmed Arc settlement. */
export function stepPaymentTotals(steps: TraceStep[]): {
  settled: number;
  pending: number;
  simulated: number;
  failed: number;
  unverified: number;
} {
  const totals = { settled: 0, pending: 0, simulated: 0, failed: 0, unverified: 0 };
  for (const s of steps) {
    if (s.phase !== "fetch" && s.phase !== "settle") continue;
    if (!isPaymentRecord(s.detail) || !Number.isFinite(s.detail.amountUsdc) || s.detail.amountUsdc <= 0) continue;
    const status = paymentSettlementStatus(s.detail);
    if (s.detail.settled !== (status === "settled")) {
      totals.unverified += s.detail.amountUsdc;
      continue;
    }
    if (status === "settled" && s.detail.settled) totals.settled += s.detail.amountUsdc;
    else if (status === "pending") totals.pending += s.detail.amountUsdc;
    else if (status === "simulated" && !s.detail.settled) totals.simulated += s.detail.amountUsdc;
    else if (status === "failed") totals.failed += s.detail.amountUsdc;
  }
  return totals;
}

/** Confirmed real spend only. Callers must label simulated and pending amounts separately. */
export function spentFromSteps(steps: TraceStep[]): number {
  return stepPaymentTotals(steps).settled;
}

export function BudgetMeter({
  spent,
  budget,
  streaming,
  pending = 0,
}: {
  spent: number;
  budget: number;
  streaming: boolean;
  pending?: number;
}) {
  if (budget <= 0) return null;
  const pct = Math.max(0, Math.min(100, (spent / budget) * 100));
  const saved = Math.max(0, budget - spent);

  return (
    <div className="-mt-2.5 mb-3.5 flex items-center gap-3">
      <div className="relative h-1.5 flex-1 overflow-hidden border border-line bg-paper-2">
        <div
          className="h-full bg-paid transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
        {/* hard-cap hairline — the funded ceiling the agent can never cross */}
        <span className="absolute inset-y-0 right-0 w-px bg-seal/60" aria-hidden />
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
        {streaming && (
          <span
            className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-paid align-middle"
            aria-hidden
          />
        )}
        {Math.round(pct)}%
        {!streaming && pending <= 0 && spent > 0 && saved > 0 && (
          <span className="ml-2 text-paid">${fmtUsdc(saved)} under cap</span>
        )}
      </span>
    </div>
  );
}
