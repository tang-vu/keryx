import type { PendingReconciliationAssessment } from "../lib/gateway/pending-reconciliation-health";
import { PENDING_RECONCILIATION_ALERT_STATE_KEY } from "../lib/gateway/pending-reconciliation-health";
import type { PendingReconciliationSummary } from "../lib/gateway/x402-transfer-reconciliation";

type AlertSummary = Pick<
  PendingReconciliationSummary,
  | "scanned"
  | "awaiting"
  | "mismatched"
  | "oldestPendingAt"
  | "browserAwaiting"
  | "exposedAwaiting"
  | "signedAwaiting"
  | "submittedAwaiting"
  | "treasuryAwaiting"
  | "acknowledgedAwaiting"
  | "unacknowledgedAwaiting"
  | "expiredAwaiting"
  | "unknownExpiryAwaiting"
>;

interface AlertStateStore {
  getSyncState(key: string): Promise<string | null>;
  setSyncState(key: string, value: string): Promise<void>;
}

/** Returns true when an unresolved incident still requires operator review. */
export async function reconcileAlertState(
  db: AlertStateStore,
  summary: AlertSummary,
  assessment: PendingReconciliationAssessment,
  sendAlert: (title: string, detail: string) => Promise<boolean>,
): Promise<boolean> {
  const needsReview = summary.mismatched > 0 || assessment.degraded;
  const previous = await db.getSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY);
  if (!needsReview) {
    if (previous) await db.setSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY, "");
    return false;
  }

  // The persisted fingerprint means out-of-band delivery succeeded, not just that an attempt ran.
  const fingerprint = JSON.stringify({
    oldestPendingAt: summary.oldestPendingAt,
    status: assessment.status,
    browserAwaiting: summary.browserAwaiting,
    exposedAwaiting: summary.exposedAwaiting,
    signedAwaiting: summary.signedAwaiting,
    submittedAwaiting: summary.submittedAwaiting,
    treasuryAwaiting: summary.treasuryAwaiting,
    acknowledgedAwaiting: summary.acknowledgedAwaiting,
    unacknowledgedAwaiting: summary.unacknowledgedAwaiting,
    expiredAwaiting: summary.expiredAwaiting,
    unknownExpiryAwaiting: summary.unknownExpiryAwaiting,
  });
  if (previous !== fingerprint) {
    const ageHours = ((assessment.oldestPendingAgeSeconds ?? 0) / 3_600).toFixed(1);
    let delivered = false;
    try {
      delivered = await sendAlert(
        "pending x402 reconciliation needs review",
        summary.mismatched > 0
          ? `Circle returned ${summary.mismatched} conflicting economic tuple(s) while checking ${summary.scanned} pending authorization(s). None were changed.`
          : awaitingAlert(summary, ageHours),
      );
    } catch {
      // A thrown transport error may embed the webhook URL or token.
      console.error("[reconcile] out-of-band alert delivery failed; retrying next run.");
    }
    if (delivered) {
      await db.setSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY, fingerprint);
    } else {
      console.error("[reconcile] out-of-band alert not delivered; retrying next run.");
    }
  }
  return true;
}

function awaitingAlert(summary: AlertSummary, ageHours: string): string {
  const details = [
    `${summary.awaiting} authorization(s) still lack definitive Circle evidence; the oldest has remained pending for ${ageHours} hours.`,
  ];
  if (summary.browserAwaiting > 0) details.push(`${summary.browserAwaiting} browser reservation(s) remain held.`);
  if(summary.exposedAwaiting) details.push(`${summary.exposedAwaiting} exposed authorization(s) may be unsigned or have lost callbacks.`);
  if(summary.signedAwaiting) details.push(`${summary.signedAwaiting} signed authorization(s) await proof without recorded submission.`);
  if(summary.submittedAwaiting) details.push(`${summary.submittedAwaiting} submission attempt(s) await proof.`);
  if (summary.treasuryAwaiting > 0) details.push(`${summary.treasuryAwaiting} treasury attempt(s) hold no browser grant capacity.`);
  if (summary.expiredAwaiting > 0) details.push(`${summary.expiredAwaiting} signed validity window(s) have elapsed, but expiry is not Circle failure evidence.`);
  if (summary.unknownExpiryAwaiting > 0) details.push(`${summary.unknownExpiryAwaiting} possibly unsigned or legacy row(s) lack an exact signed expiry.`);
  return details.join(" ");
}
