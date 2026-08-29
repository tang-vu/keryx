import type { PendingReconciliationSummary } from "./x402-transfer-reconciliation";

export const PENDING_RECONCILIATION_WARN_MS = 60 * 60 * 1_000;
export const PENDING_RECONCILIATION_CRITICAL_MS = 24 * 60 * 60 * 1_000;
export const PENDING_RECONCILIATION_ALERT_STATE_KEY = "pendingPaymentReconciliationAlert";

export type PendingReconciliationStatus =
  | "clean"
  | "acknowledged"
  | "awaiting"
  | "stale"
  | "critical"
  | "mismatch";

export interface PendingReconciliationAssessment {
  status: PendingReconciliationStatus;
  oldestPendingAgeSeconds: number | null;
  degraded: boolean;
}
/**
 * Age is operational evidence only. It never promotes, fails, or releases a payment reservation;
 * those state transitions still require the exact Circle tuple in x402-transfer-reconciliation.
 */
export function assessPendingReconciliation(
  summary: Pick<PendingReconciliationSummary, "awaiting" | "mismatched" | "oldestPendingAt"> &
    Partial<
      Pick<
        PendingReconciliationSummary,
        "acknowledgedAwaiting" | "unacknowledgedAwaiting" | "oldestUnacknowledgedPendingAt"
      >
    >,
  now = Date.now(),
): PendingReconciliationAssessment {
  if (summary.mismatched > 0) {
    return {
      status: "mismatch",
      oldestPendingAgeSeconds: ageSeconds(summary.oldestPendingAt, now),
      degraded: true,
    };
  }

  if (summary.awaiting === 0) {
    return { status: "clean", oldestPendingAgeSeconds: null, degraded: false };
  }
  const unacknowledged = summary.unacknowledgedAwaiting ?? summary.awaiting;
  if (unacknowledged === 0) {
    return {
      status: "acknowledged",
      oldestPendingAgeSeconds: ageSeconds(summary.oldestPendingAt, now),
      degraded: false,
    };
  }
  const age = ageSeconds(
    summary.oldestUnacknowledgedPendingAt ?? summary.oldestPendingAt,
    now,
  );
  if (age === null) {
    return { status: "clean", oldestPendingAgeSeconds: null, degraded: false };
  }
  if (age * 1_000 >= PENDING_RECONCILIATION_CRITICAL_MS) {
    return { status: "critical", oldestPendingAgeSeconds: age, degraded: true };
  }
  if (age * 1_000 >= PENDING_RECONCILIATION_WARN_MS) {
    return { status: "stale", oldestPendingAgeSeconds: age, degraded: true };
  }
  return { status: "awaiting", oldestPendingAgeSeconds: age, degraded: false };
}

function ageSeconds(value: string | null, now: number): number | null {
  if (!value) return null;
  const created = Date.parse(value);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, Math.floor((now - created) / 1_000));
}
