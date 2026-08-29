/**
 * Risk-accept one permanently ambiguous legacy treasury authorization without changing its
 * financial state. The command performs a fresh complete Circle search first. Browser rows,
 * rows with exact signed expiry, recent rows, and any non-awaiting Circle verdict are rejected.
 *
 * Usage:
 * npm run acknowledge-pending -- --payment-id x402:0x... --reason "reviewed ..." --confirm
 */

import { getDb } from "../lib/db/index.ts";
import {
  checkPendingTransfer,
  reconcilePendingPayments,
  searchCircleTransfer,
} from "../lib/gateway/x402-transfer-reconciliation.ts";
import {
  PENDING_RECONCILIATION_ACK_STATE_KEY,
  addPendingReconciliationAcknowledgementOnce,
  createPendingReconciliationAcknowledgement,
  decodePendingReconciliationAcknowledgements,
  serializePendingReconciliationAcknowledgements,
} from "../lib/gateway/pending-reconciliation-acknowledgement.ts";
import { readTreasurySpendWalletAddress } from "../lib/payments/treasury-spend-wallet.ts";

const args = process.argv.slice(2);
const paymentId = valueAfter("--payment-id");
const reason = valueAfter("--reason");
const confirmed = args.includes("--confirm");

if (!paymentId || !reason || !confirmed) {
  console.error(
    'Usage: npm run acknowledge-pending -- --payment-id <exact-id> --reason "20+ chars" --confirm',
  );
  process.exit(2);
}

const db = await getDb();
const pending = await db.listPendingPayments(10_000);
const payment = pending.find((candidate) => candidate.id === paymentId);
if (!payment) throw new Error("payment id is not an unresolved pending authorization");

const signal = AbortSignal.timeout(45_000);
const transfers = await searchCircleTransfer(payment, signal);
const check = checkPendingTransfer(payment, transfers);
if (check.verdict !== "awaiting") {
  throw new Error(`Circle returned ${check.verdict}; run reconciliation instead of acknowledging`);
}

const checkedAt = new Date().toISOString();
const treasuryPayer = readTreasurySpendWalletAddress();
if (!treasuryPayer) throw new Error("persistent treasury spend-wallet address is unavailable");
const acknowledgement = createPendingReconciliationAcknowledgement(payment, {
  treasuryPayer,
  reason,
  circleCheckedAt: checkedAt,
  circleCandidateCount: transfers.length,
});
const decoded = decodePendingReconciliationAcknowledgements(
  await db.getSyncState(PENDING_RECONCILIATION_ACK_STATE_KEY),
);
if (!decoded.valid) throw new Error("stored acknowledgement audit state is malformed");
const existing = decoded.acknowledgements;
const added = addPendingReconciliationAcknowledgementOnce(existing, acknowledgement);
const acknowledgements = added.acknowledgements;
if (added.created) {
  await db.setSyncState(
    PENDING_RECONCILIATION_ACK_STATE_KEY,
    serializePendingReconciliationAcknowledgements(acknowledgements),
  );
}

const summary = await reconcilePendingPayments(db, {
  limit: 250,
  signal: AbortSignal.timeout(45_000),
  acknowledgements,
  treasuryPayer,
});
console.log(
  JSON.stringify(
    {
      acknowledged: added.acknowledgement.paymentId,
      acknowledgedAt: added.acknowledgement.acknowledgedAt,
      circleCheckedAt: checkedAt,
      circleCandidateCount: transfers.length,
      alreadyAcknowledged: !added.created,
      financialStateChanged: false,
      reconciliation: {
        awaiting: summary.awaiting,
        acknowledgedAwaiting: summary.acknowledgedAwaiting,
        unacknowledgedAwaiting: summary.unacknowledgedAwaiting,
        mismatched: summary.mismatched,
      },
    },
    null,
    2,
  ),
);

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}
