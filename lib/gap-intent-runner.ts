/**
 * Completion rules for a targeted wanted-claim retry.
 *
 * A citation object is proposed attribution, not proof of payment. `filled` therefore requires:
 * reward-qualified evidence from the offered source, evidence-bounded coverage at the threshold,
 * and a genuinely settled citation leg for that source and run.
 */

import { MIN_REWARD_SUPPORT } from "./agent/evidence-ledger";
import type { KeryxDB } from "./db/keryx-db";
import { demandGapId } from "./demand-signal";
import type { GapIntent, PaymentRecord, QueryRun } from "./types";

export const GAP_INTENT_LEASE_MS = 10 * 60_000;
export const GAP_INTENT_MAX_ATTEMPTS = 3;
export const GAP_INTENT_MAX_BUDGET_USDC = 0.05;

export interface GapIntentOutcome {
  status: "filled" | "missed" | "unpaid";
  coverage: number;
  rewardUsdc: number;
  lastError?: string;
}

export function classifyGapIntentRun(
  intent: GapIntent,
  run: QueryRun,
  payments: PaymentRecord[],
): GapIntentOutcome {
  const matchingCoverage = (run.claimCoverage ?? [])
    .filter((item) => demandGapId(item.claim) === intent.gapId)
    .reduce((best, item) => Math.max(best, item.coverage), 0);
  const targetGrounded = (run.evidence ?? []).some(
    (item) =>
      item.sourceId === intent.sourceId &&
      item.qualifiesForReward &&
      demandGapId(item.claim) === intent.gapId,
  );
  const rewardUsdc = round(
    payments
      .filter(
        (payment) =>
          payment.kind === "citation" &&
          payment.queryId === run.id &&
          payment.sourceId === intent.sourceId &&
          payment.settled &&
          Boolean(payment.txHash),
      )
      .reduce((sum, payment) => sum + payment.amountUsdc, 0),
  );

  if (!targetGrounded || matchingCoverage < MIN_REWARD_SUPPORT) {
    return {
      status: "missed",
      coverage: round(matchingCoverage),
      rewardUsdc,
      lastError: "The offered source did not pass the evidence gate for this claim.",
    };
  }
  if (rewardUsdc <= 0) {
    return {
      status: "unpaid",
      coverage: round(matchingCoverage),
      rewardUsdc: 0,
      lastError: "Evidence qualified, but no real citation settlement reached the offered source.",
    };
  }
  return {
    status: "filled",
    coverage: round(matchingCoverage),
    rewardUsdc,
  };
}

export async function finishGapIntentFromRun(
  db: Pick<KeryxDB, "listPaymentsByQuery" | "finishGapIntent">,
  intent: GapIntent,
  run: QueryRun,
): Promise<GapIntentOutcome> {
  const result = classifyGapIntentRun(
    intent,
    run,
    await db.listPaymentsByQuery(run.id),
  );
  await db.finishGapIntent(intent.id, {
    ...result,
    retryRunId: run.id,
  });
  return result;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
