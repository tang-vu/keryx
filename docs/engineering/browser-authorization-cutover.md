# Browser authorization journal cutover

This is an Arc **testnet** operation. Schema installation leaves signing disabled
for the new browser protocol until explicit journal activation. Synthetic tests,
including process termination and PostgreSQL CI, do not prove funded recovery,
power-loss durability, multi-instance routing, or mainnet readiness.

## Before activation

1. Pass the candidate's application, browser, contract, build and actual PostgreSQL
   gates and independent code review. Apply migrations through `0069` without
   activating the journal. Preserve the existing backups and legacy rows.
2. Stop old browser admission with an ingress/browser-route maintenance gate, or
   stop and drain the old web generation. The old build does **not** implement
   `KERYX_BROWSER_AUTHORIZATION_PAUSED`; setting that environment flag alone proves
   neither admission closure nor drain. Replace **every** old web/worker process,
   close old SSE streams and pending callbacks, and verify every old PID has exited.
   An old request that reserved before activation can submit from memory without
   another database write, so database fences alone cannot make a mixed-generation
   cutover safe.
3. Deploy one compatible web instance and compatible workers with the journal
   inactive and `KERYX_BROWSER_AUTHORIZATION_PAUSED=1` in their operator-managed
   environment. Alternatively, replace the old generation directly with this
   inactive compatible generation, then verify every old PID has exited and browser
   admission is closed before activation. The inactive/paused controls apply only
   to the compatible build. Old browser requests without `durable-v1` are rejected before any
   sign request. Updated browsers require the server's admitted nonce; no random
   fallback is allowed. No browser failure selects the treasury gateway.
4. Inspect existing grants and pending recovery evidence privately. Activation
   imports the greater of current epoch spend and evidenced pending/settled browser
   payment amounts, then sums distinct epochs per normalized signer. Orphan epochs
   remain retained; conflicting identities or fractional micro-USDC refuse activation.
   Historical missing nonces, lost pre-insert authorizations and deleted grants with
   no payment evidence cannot be reconstructed. Preserve that residual in review.

## Activate and verify

After the above drain is independently confirmed, run from the deployed candidate
with the application's normal operator-supplied environment:

```sh
node --import tsx --env-file=.env.local scripts/browser-authorization-journal.mts --activate --confirm-old-writers-drained
```

The command is idempotent, testnet-only, and sends no payment or notification.
It cannot prove that old processes were drained; that flag is an operator
attestation. The database retains the activation fence across restart. Old grant
reserve/release/reset/delete writers then fail closed. Check status without mutation:

```sh
node --import tsx --env-file=.env.local scripts/browser-authorization-journal.mts
```

Remove the pause only after checking the exact candidate and database state.
Begin with an unfunded/synthetic browser acceptance; a funded drill requires its
separate authorization. Keep single-instance callback routing. A callback arriving
after restart can durably acknowledge metadata but does not start another paid retry.

## Accounting and recovery

The budget/cap is **cumulative** for a normalized signer across replacement,
expiry, revocation and session aliases. Available remaining capacity equals that
cap less retained confirmed consumption and unresolved reservations. Recovery
clamps the requested cumulative cap to independently observed Circle availability
plus exact, deduplicated confirmed browser consumption. Pending, exposed and
unknown historical consumption is never added back as available. If Circle's
balance already nets a pending debit, recovery can conservatively restrict capacity
twice until exact proof arrives. A distinct independently funded signer has its own
capacity; the original signer's history stays retained.

Admission atomically creates the intent, reservation and authoritative
`payment_events` row before exposure. Prepared rows are hidden from public feeds.
Only confirmed `prepared -> cancelled_unexposed` releases locally. Exposure,
signature and submission metadata are conditional durable transitions. Timeout,
disconnect, malformed callback, grant replacement, expiry and empty Circle search
never release an exposed reservation. Exact Circle terminal failure releases the
original retained epoch once; settlement keeps cumulative consumption. Neither
signature headers nor private keys are persisted.

Privately inspect up to 100 unresolved browser rows with `--pending`; output includes
nonce, phase, epoch, amount, age timestamp, recorded expiry and evidence reference.
Do not publish that output. The reconciler includes exposed rows without signed
expiry and requires the complete nonce/payer/payee/network/token/amount tuple.
No definitive result remains unresolved for operator support. Alert failures retry
through the existing reconciler. There is no autonomous resubmission or timeout release.

## Rollback

Pause browser signing and drain the current generation before rollback. Preserve
the journal, activation fence, retained capacity and additive schema. Prefer a
compatible candidate with signing paused; an old writer is intentionally blocked
by database triggers/RPC guards. Never disable the database fence, drop journal
tables, restore a pre-activation schema, reset spend, or delete unresolved grants
to restore service. Restore from backups and reconcile existing nonces without
creating replacements. Missing proof can lock capacity indefinitely; safe finite
release policy, funded recovery drills and independent security acceptance remain
open gates.
