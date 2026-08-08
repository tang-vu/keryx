/**
 * Resolve ambiguous post-submit x402 authorizations against Circle's transfer ledger.
 *
 * Circle exposes nonce-filtered transfer search. A row is promoted only when nonce, payer, payee,
 * Arc network, USDC amount, and a non-failed acceptance status all match. Missing, failed, or
 * mismatched results remain outside settled metrics and creator earnings.
 *
 * Run: npm run reconcile-payments (installed every 10 minutes by deploy-vps.sh)
 * Exit: 0 clean/awaiting only · 1 failed or mismatched Circle evidence · 2 check failed
 */

import { getDb } from "../lib/db/index.ts";
import { reconcilePendingPayments } from "../lib/gateway/x402-transfer-reconciliation.ts";
import { sendAlert } from "../lib/notify/alert.ts";

async function main(): Promise<void> {
  const db = await getDb();
  const signal = AbortSignal.timeout(45_000);
  const summary = await reconcilePendingPayments(db, { limit: 250, signal });
  console.log(
    `[reconcile] scanned ${summary.scanned}; promoted ${summary.promoted}; awaiting ${summary.awaiting}; failed ${summary.failed}; mismatched ${summary.mismatched}; raced ${summary.raced}.`,
  );
  if (summary.oldestPendingAt) {
    console.log(`[reconcile] oldest unresolved authorization: ${summary.oldestPendingAt}`);
  }

  if (summary.failed === 0 && summary.mismatched === 0) return;
  await sendAlert(
    "pending x402 reconciliation needs review",
    `Circle returned ${summary.failed} failed and ${summary.mismatched} mismatched transfer(s) while checking ${summary.scanned} pending Keryx authorization(s). None were promoted; inspect the reconciliation log before changing ledger state.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reconcile] check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
