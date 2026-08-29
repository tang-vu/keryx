import { describe, expect, it } from "vitest";
import {
  PENDING_RECONCILIATION_CRITICAL_MS,
  PENDING_RECONCILIATION_WARN_MS,
  assessPendingReconciliation,
} from "./pending-reconciliation-health";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");

function summary(ageMs: number | null, mismatched = 0) {
  return {
    awaiting: ageMs === null ? 0 : 1,
    mismatched,
    oldestPendingAt: ageMs === null ? null : new Date(NOW - ageMs).toISOString(),
  };
}

describe("assessPendingReconciliation", () => {
  it("keeps recent awaiting evidence operational", () => {
    expect(assessPendingReconciliation(summary(5 * 60_000), NOW)).toMatchObject({
      status: "awaiting",
      degraded: false,
    });
  });

  it("degrades stale and critical pending authorizations without changing payment state", () => {
    expect(
      assessPendingReconciliation(summary(PENDING_RECONCILIATION_WARN_MS), NOW),
    ).toMatchObject({ status: "stale", degraded: true });
    expect(
      assessPendingReconciliation(summary(PENDING_RECONCILIATION_CRITICAL_MS), NOW),
    ).toMatchObject({ status: "critical", degraded: true });
  });

  it("prioritizes conflicting Circle evidence", () => {
    expect(assessPendingReconciliation(summary(1_000, 1), NOW)).toMatchObject({
      status: "mismatch",
      degraded: true,
    });
  });

  it("keeps an acknowledged legacy treasury ambiguity visible without degrading readiness", () => {
    expect(
      assessPendingReconciliation(
        {
          ...summary(10 * PENDING_RECONCILIATION_CRITICAL_MS),
          acknowledgedAwaiting: 1,
          unacknowledgedAwaiting: 0,
          oldestUnacknowledgedPendingAt: null,
        },
        NOW,
      ),
    ).toMatchObject({ status: "acknowledged", degraded: false });
  });

  it("still degrades on the oldest unacknowledged row when acknowledged rows are older", () => {
    expect(
      assessPendingReconciliation(
        {
          awaiting: 2,
          mismatched: 0,
          oldestPendingAt: "2026-01-01T00:00:00.000Z",
          acknowledgedAwaiting: 1,
          unacknowledgedAwaiting: 1,
          oldestUnacknowledgedPendingAt: new Date(
            NOW - PENDING_RECONCILIATION_WARN_MS,
          ).toISOString(),
        },
        NOW,
      ),
    ).toMatchObject({ status: "stale", degraded: true });
  });
});
