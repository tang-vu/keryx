# Pending reconciliation acknowledgement

This runbook handles a narrow operational case: a legacy **treasury-funded** x402 authorization
remains ambiguous after its response was lost, predates exact `validBefore` persistence, and has no
Circle transfer evidence. It does not settle, fail, delete, refund, or relabel the payment.

## Invariants

- Circle's exact accepted/failed transfer tuple remains the only settlement authority.
- Acknowledged rows remain `pending` and outside settled earnings, traction, and receipts.
- The ten-minute reconciler continues searching every acknowledged row.
- Browser-funded rows are ineligible because they may hold user session capacity.
- Rows with exact signed expiry are ineligible; expiry remains context, not failure evidence.
- Any Circle tuple mismatch remains degraded even if an acknowledgement exists.
- The first acknowledgement is retained. A repeat is idempotent; a changed tuple fails closed.

## Eligibility gate

The operator command requires all of the following:

1. Exact `--payment-id` and an explicit `--confirm` flag.
2. A reason between 20 and 500 characters.
3. `settlement_status='pending'`, `settled=0`, and a retained authorization nonce.
4. No `grant_epoch` and no `authorization_expires_at`.
5. The payer exactly matches the public address derived from the server's persistent spend key;
   stored address metadata must also agree. Absence of a browser grant alone is not accepted as
   treasury proof. The key is never printed or copied into acknowledgement state.
6. At least 24 hours since the local submission record.
7. A fresh, cursor-complete Circle search whose verdict is `awaiting` (no exact or conflicting
   nonce/economic tuple).

The audit record stores the payment id, nonce, acknowledgement and Circle-check timestamps, reason,
the cursor-complete search policy/version, candidate count, and a SHA-256 binding over payment id +
nonce + payer + payee + Arc network + integer micro-USDC.
It is private `sync_state`; public health exposes counts, never the nonce or addresses.

## Command

Run on the production host so it uses the production database and environment:

```bash
cd /root/keryx
npm run acknowledge-pending -- \
  --payment-id 'x402:0x...' \
  --reason 'Fresh complete Circle review found no transfer; legacy treasury row has no browser reservation.' \
  --confirm
```

Expected output must contain:

- `financialStateChanged: false`
- `acknowledgedAwaiting: 1`
- `unacknowledgedAwaiting: 0`
- `mismatched: 0`

Then verify `npm run reconcile-payments` reports the same split and `/api/health` returns
`status: operational` with `reconciliation.status: acknowledged`. The command does not manufacture
a Circle transaction id. If Circle later returns an exact accepted or failed transfer, normal
reconciliation terminalizes the payment and the dormant audit record no longer affects health.

## Failure and recovery

- Circle HTTP/schema/pagination failure: command exits before writing acknowledgement.
- Exact accepted/failed evidence: command exits and directs the operator to normal reconciliation.
- Browser, known-expiry, recent, malformed, or non-pending row: command exits without a write.
- Conflicting stored audit tuple: command exits; investigate DB integrity.
- Process loss after the audit write but before summary refresh: the next ten-minute reconciliation
  reads the durable acknowledgement and repairs the public summary.
- Removing/ignoring the acknowledgement is operationally reversible and restores the original
  alert; it never changes the payment ledger either way.
