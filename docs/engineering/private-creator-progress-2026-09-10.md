# Private creator processing progression

The SQLite regression `advances recorded creator processing evidence to confirmed spend
without reopening its authorization` first failed: a stored received observation caused the
reconciler to skip search, leaving confirmed spend at zero. The fix rechecks processing records
and permits only the same transfer and admitted submission to advance to confirmed/completed.

Validation uses synthetic, unfunded data, including local EOA signatures in the SQLite fixture.
No signature was sent to a network, and no settlement, funding or live Circle request was performed.

- Actual SQLite adapters on the same file: processing 20000 micro-USDC becomes confirmed 20000;
  a replacement transfer cannot promote, a stale processing write cannot downgrade, and the
  original authorization cannot be admitted again. The original observation timestamp is retained.
- PostgreSQL 17 in an isolated temporary container: applied migrations 46, 47, 48, 50, 51, 52 and
  58, then exercised the actual service-role RPC. Verified batched-to-completed promotion, wrong
  transfer/owner/worker rejection, retained timestamp, no downgrade and denied anon/authenticated
  execution. The container was removed after successful completion.
- Search tests retain pagination, tuple matching and private-context suppression; processing
  observations now have a separate counter and are not reported as confirmed payments.

This changes internal private reconciliation, which is not yet scheduled in production. Migration
58 has not been applied to a production Supabase database. These checks do not establish private
checkout readiness, independent chain finality or crash/concurrent-writer acceptance on PostgreSQL.
The first processing observation's timestamp remains recorded, while its stage can advance once;
this is not a complete event-history ledger. See D-152 for the bounded update policy.
