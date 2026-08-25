/**
 * Resolve ambiguous post-submit x402 authorizations against Circle's transfer ledger.
 *
 * Circle exposes filtered, cursor-paginated transfer search but no nonce filter. A row is promoted
 * only when nonce, payer, payee, Arc network and USDC amount all match. Accepted transfers become
 * settled. Circle-terminal
 * failures become failed receipts and release browser capacity only against the same grant epoch.
 * Missing or mismatched results remain pending and outside settled metrics and creator earnings.
 *
 * Run: npm run reconcile-payments (installed every 10 minutes by deploy-vps.sh)
 * Exit: 0 clean/awaiting only · 1 stale/critical/mismatched evidence · 2 check failed
 */

import { getDb } from "../lib/db/index.ts";
import { reconcilePendingPayments } from "../lib/gateway/x402-transfer-reconciliation.ts";
import { sendAlert } from "../lib/notify/alert.ts";
import {
  PENDING_RECONCILIATION_ALERT_STATE_KEY,
  assessPendingReconciliation,
} from "../lib/gateway/pending-reconciliation-health.ts";

async function main(): Promise<void> {
  const db = await getDb();
  const signal = AbortSignal.timeout(45_000);
  const summary = await reconcilePendingPayments(db, { limit: 250, signal });
  console.log(
    `[reconcile] scanned ${summary.scanned}; promoted ${summary.promoted}; terminal failures ${summary.failed}; released reservations ${summary.releasedReservations}; awaiting ${summary.awaiting} (${summary.browserAwaiting} browser, ${summary.treasuryAwaiting} treasury); expired ${summary.expiredAwaiting}; unknown expiry ${summary.unknownExpiryAwaiting}; mismatched ${summary.mismatched}; raced ${summary.raced}.`,
  );
  if (summary.oldestPendingAt) {
    console.log(`[reconcile] oldest unresolved authorization: ${summary.oldestPendingAt}`);
  }
  if (summary.earliestAuthorizationExpiresAt) {
    console.log(`[reconcile] earliest exact signed expiry: ${summary.earliestAuthorizationExpiresAt}`);
  }

  const assessment = assessPendingReconciliation(summary);
  const needsReview = summary.mismatched > 0 || assessment.degraded;
  const previous = await db.getSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY);
  if (!needsReview) {
    if (previous) await db.setSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY, "");
    return;
  }

  // Alert once for each oldest authorization/status pair. A one-hour stale warning may alert again
  // when it crosses 24 hours, but the ten-minute cron does not spam the same incident repeatedly.
  const fingerprint = JSON.stringify({
    oldestPendingAt: summary.oldestPendingAt,
    status: assessment.status,
    browserAwaiting: summary.browserAwaiting,
    treasuryAwaiting: summary.treasuryAwaiting,
    expiredAwaiting: summary.expiredAwaiting,
    unknownExpiryAwaiting: summary.unknownExpiryAwaiting,
  });
  if (previous !== fingerprint) {
    const age = assessment.oldestPendingAgeSeconds ?? 0;
    const ageHours = (age / 3_600).toFixed(1);
    await sendAlert(
      "pending x402 reconciliation needs review",
      summary.mismatched > 0
        ? `Circle returned ${summary.mismatched} conflicting economic tuple(s) while checking ${summary.scanned} pending authorization(s). None were changed.`
        : awaitingAlert(summary, ageHours),
    );
    await db.setSyncState(PENDING_RECONCILIATION_ALERT_STATE_KEY, fingerprint);
  }
  process.exitCode = 1;
}

function awaitingAlert(
  summary: Awaited<ReturnType<typeof reconcilePendingPayments>>,
  ageHours: string,
): string {
  const details = [
    `${summary.awaiting} authorization(s) still lack definitive Circle evidence; the oldest has remained pending for ${ageHours} hours.`,
  ];
  if (summary.browserAwaiting > 0) {
    details.push(`${summary.browserAwaiting} browser reservation(s) remain held.`);
  }
  if (summary.treasuryAwaiting > 0) {
    details.push(`${summary.treasuryAwaiting} treasury attempt(s) hold no browser grant capacity.`);
  }
  if (summary.expiredAwaiting > 0) {
    details.push(`${summary.expiredAwaiting} signed validity window(s) have elapsed, but expiry is not Circle failure evidence.`);
  }
  if (summary.unknownExpiryAwaiting > 0) {
    details.push(`${summary.unknownExpiryAwaiting} legacy row(s) lack an exact signed expiry.`);
  }
  return details.join(" ");
}

main().catch((error) => {
  console.error("[reconcile] check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
