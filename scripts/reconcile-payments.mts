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
import { assessPendingReconciliation } from "../lib/gateway/pending-reconciliation-health.ts";
import {
  PENDING_RECONCILIATION_ACK_STATE_KEY,
  parsePendingReconciliationAcknowledgements,
} from "../lib/gateway/pending-reconciliation-acknowledgement.ts";
import { readTreasurySpendWalletAddress } from "../lib/payments/treasury-spend-wallet.ts";
import { reconcileAlertState } from "./reconciliation-alert.ts";

async function main(): Promise<void> {
  const db = await getDb();
  const signal = AbortSignal.timeout(45_000);
  const acknowledgements = parsePendingReconciliationAcknowledgements(
    await db.getSyncState(PENDING_RECONCILIATION_ACK_STATE_KEY),
  );
  const summary = await reconcilePendingPayments(db, {
    limit: 250,
    signal,
    acknowledgements,
    treasuryPayer: readTreasurySpendWalletAddress(),
  });
  console.log(
    `[reconcile] scanned ${summary.scanned}; promoted ${summary.promoted}; terminal failures ${summary.failed}; released reservations ${summary.releasedReservations}; awaiting ${summary.awaiting} (${summary.acknowledgedAwaiting} acknowledged, ${summary.unacknowledgedAwaiting} alertable; ${summary.browserAwaiting} browser, ${summary.treasuryAwaiting} treasury); expired ${summary.expiredAwaiting}; unknown expiry ${summary.unknownExpiryAwaiting}; mismatched ${summary.mismatched}; raced ${summary.raced}.`,
  );
  if (summary.oldestPendingAt) {
    console.log(`[reconcile] oldest unresolved authorization: ${summary.oldestPendingAt}`);
  }
  if (summary.earliestAuthorizationExpiresAt) {
    console.log(`[reconcile] earliest exact signed expiry: ${summary.earliestAuthorizationExpiresAt}`);
  }

  const assessment = assessPendingReconciliation(summary);
  if (await reconcileAlertState(db, summary, assessment, sendAlert)) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reconcile] check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
