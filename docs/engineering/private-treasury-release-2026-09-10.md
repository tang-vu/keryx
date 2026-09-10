# Sealed private-job treasury capacity reuse

Version 0.22.49 adds a once-per-job internal release of never-committed creator budget.
It does not return money to the buyer or withdraw, transfer, deposit or mint funds.
The package's buyer-facing unused-budget policy remains unchanged.

## Authority and accounting

`collectRun` saves the result after draining the agent. Creator admission refuses a
job with a stored result. PostgreSQL sealing/admission share the execution-row lock;
SQLite uses atomic conditional writes. The release requires validated owner/payment,
execution, result, reservation and creator-ledger reads. The SQL writer derives its
own amount from the sealed ledger and verifies replay against the original release.
There is no HTTP release endpoint or client-supplied release amount.

For a job with creator budget `B` and all admitted authorizations totaling `A`, release
`R = B - A`. Effective allocation is `B - R = A`. Include every authorization in `A`,
even if expired, unresolved, processing or observed failed. An admitted request can have
escaped despite a lost response; missing success evidence cannot free its capacity.
Confirmed spend remains a lifetime debit. The original budget and per-job submission
barriers are not reduced or removed.

Pool available capacity is `ceiling - sum(effective allocations)`. Required conservative
Gateway backing remains `ceiling - confirmed outflows`. For an illustrative ceiling of
50,000 micro-USDC and a sealed 30,000 budget with 17,000 admitted, the release is 13,000
and new-job capacity is 33,000. If that 17,000 is still uncertain, backing remains 50,000;
if confirmed, backing becomes 33,000. Releasing the whole 30,000 would overstate capacity.

The existing reconciliation sweep visits sealed jobs, including previously completed
ones. After finishing a creator page sequence it attempts the local release. A missing
result does nothing. An error is reported through aggregate error counters and retried
on a later sweep; `allocationsReleased` counts newly sealed release records, including
zero-amount records. Reports contain no question, job identifier, signature or billing data.

## Verification

- SQLite adapter tests cover missing result, foreign owner/signer, uncertain expired
  spend, competing release calls, reopen/replay, late creator admission, original
  reservation identity, full/zero spend and mismatched ledger signer.
- Two new-job reservations compete for returned capacity; only one fits. Confirmed
  creator spend is not recycled. A real coordinator call recovers an already-saved
  zero-spend job without calling a payment or transfer-search transport.
- Supabase client transport tests require exact release readback. A committed RPC with
  a lost response throws; a later call reads the one original release. Wrong readback
  fails closed. These client tests use an injected transport and no network.
- `node --import tsx scripts/test-private-treasury-postgres.mts` passed against an
  isolated PostgreSQL 17 container. It applies migrations 46–60, checks service/client
  permissions, races duplicate releases and new reservations in separate sessions,
  and races result sealing with creator admission. Released plus admitted always equals
  the original budget, and a late admission fails. Fixtures are synthetic and unfunded.
- Focused release, summary, reconciliation and worker-loop tests and TypeScript passed.
  Existing private-intent/payment integration tests also passed.

## Deployment and remaining limits

Production commit `9947585` passed CI run `34496057436` and the VPS production build.
Health reported that commit as operational. The resumed worker matched its configured
release and was observed idle with Gateway backing sufficient for the unchanged ceiling.
It recorded one release for the existing owner-operated testnet job. A read-only before/
after digest comparison confirmed that the original reservations, signed intents, payment
attempts, execution claims, saved results, creator submissions and confirmations were
unchanged. The returned capacity matched original budget minus admitted spend. This
acceptance performed no new purchase, funding or settlement request. Private aggregate
observations are retained in ignored operator artifacts; no billing figures are published.

PostgreSQL requires migration 0060 before this worker or allocator starts. SQLite creates
the append-only release table and immutability triggers at initialization. Apply the normal
worker drain/deploy procedure. The coordinator may release eligible historical jobs on
its first sweep. Old application code conservatively ignores release credits; rollback
can deny further capacity or reject an old summary whose gross reservations exceed the
ceiling. Retain the release ledger during restore/rollback and inspect backing before resuming.

Database integrity and trusted operator access remain required. These tests are not an
independent audit, chain-finality proof, mainnet approval, buyer refund or evidence of
profitable usage. Replenishing the lifetime ceiling, recovering admitted failed spend,
server-data retention and independent wallet/creator acceptance remain unfinished.
