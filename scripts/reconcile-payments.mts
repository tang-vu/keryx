/**
 * Resolve ambiguous post-submit x402 authorizations against Circle's transfer ledger.
 *
 * Circle exposes nonce-filtered transfer search. A row is promoted only when nonce, payer, payee,
 * Arc network and USDC amount all match. Accepted transfers become settled. Circle-terminal
 * failures become failed receipts and release browser capacity only against the same grant epoch.
 * Missing or mismatched results remain pending and outside settled metrics and creator earnings.
 *
 * Run: npm run reconcile-payments (installed every 10 minutes by deploy-vps.sh)
 * Exit: 0 clean/awaiting only · 1 mismatched Circle evidence · 2 check failed
 */

import { getDb } from "../lib/db/index.ts";
import { reconcilePendingPayments } from "../lib/gateway/x402-transfer-reconciliation.ts";
import { sendAlert } from "../lib/notify/alert.ts";

async function main(): Promise<void> {
  const db = await getDb();
  const signal = AbortSignal.timeout(45_000);
  const summary = await reconcilePendingPayments(db, { limit: 250, signal });
  console.log(
    `[reconcile] scanned ${summary.scanned}; promoted ${summary.promoted}; terminal failures ${summary.failed}; released reservations ${summary.releasedReservations}; awaiting ${summary.awaiting}; mismatched ${summary.mismatched}; raced ${summary.raced}.`,
  );
  if (summary.oldestPendingAt) {
    console.log(`[reconcile] oldest unresolved authorization: ${summary.oldestPendingAt}`);
  }

  if (summary.mismatched === 0) return;
  await sendAlert(
    "pending x402 reconciliation needs review",
    `Circle returned ${summary.mismatched} transfer(s) whose economic tuple conflicts with Keryx while checking ${summary.scanned} pending authorization(s). None of those rows were changed; inspect the reconciliation log.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reconcile] check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
