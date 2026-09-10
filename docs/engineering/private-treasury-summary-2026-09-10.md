# Private treasury accounting observation

`getPrivateTreasurySummary(signer)` reads a single database snapshot and returns only
aggregate integer micro-USDC amounts. It has no public route. An absent pool returns
null, not an assertion that funds or capacity are zero. SQLite uses one query;
PostgreSQL migration 0057 provides a service-role-only SECURITY INVOKER function.

The fields distinguish:

- Capacity: the immutable configured lifetime ceiling, not a bank or Gateway balance.
- Allocated: original creator budgets minus once-recorded releases of never-committed
  budget after result sealing (updated in v0.22.49).
- Unallocated: capacity minus effective allocations. Admitted authorizations always remain allocated.
- Committed: creator payment legs already admitted against those jobs.
- Confirmed: admitted amounts with matching stored facilitator-success evidence or
  transfer-search status confirmed/completed. Received/batched are not confirmed.
- Unresolved or processing: committed minus confirmed; expiry does not clear this sum.
- Conservative backing: capacity minus confirmed outflows.

Conservative backing preserves coverage for unallocated capacity and all allocated
amounts not recorded as confirmed outflows. It can overstate required available funds
when Circle has already withheld an unresolved amount. The
[sealed-job release policy](./private-treasury-release-2026-09-10.md) permits reuse of
never-committed budget but does not change the backing formula. This summary itself
changes neither reservation nor balance.
It must not be interpreted as withdrawable funds, profit or a refund.

The reader checks total ordering (confirmed <= committed <= allocated <= capacity),
stored amount/payer consistency and confirmation-to-submission agreement. It relies
on existing validated database admission for the underlying signed payment records;
it does not independently authenticate receipts or verify chain finality. Actual
signer inventory and checkout admission remain unwired.

`inspectPrivateTreasuryBacking` now compares the conservative target with the existing
uncached Gateway available-balance reader for the configured treasury signer. It
accepts only the pinned Arc-testnet network/domain and matching stored capacity.
Before a pool exists, the target is the full configured capacity. Zero is known
insufficiency when coverage is required; null/transport failure is balance-unavailable.
The database snapshot is checked again after the balance read and a changed snapshot
produces accounting-changed. Cancellation prevents subsequent operations but does not
abort an already-started balance reader, which has its own transport timeout.

Even `backed` remains `checkoutReady: false`: funds can change after observation, the
two systems are not atomically locked, and unallocated capacity can be zero. Callers
still require validated signer inventory, worker/provider checks, job-specific capacity
and the original atomic reservation. The inspector never deposits, transfers, reserves,
releases or refunds funds. Its focused tests inject Gateway balances and database
observations; they are not evidence of a funded private production treasury.

Local evidence on September 10, 2026:

- SQLite relational fixtures exercise multiple legs per job, signer isolation,
  empty pools, processing exclusion, status progression and mismatched proof refusal.
- The existing buyer/backend integration drill now reads the actual SQLite adapter's
  summary after result recovery and confirms that the empty-corpus job retains its
  complete allocation without inventing creator payouts.
- An isolated PostgreSQL 17 container applied migrations 0046/0047/0048/0050/0051/0055/
  0057 and exercised the function as service_role. Synthetic rows produced capacity
  100000, allocation 80000, commitments 40000, confirmations 20000; a received leg and
  a missing proof did not count as confirmed. A mismatched proof was flagged and
  anon/authenticated execution privileges were absent. The container was removed.
- The three focused Vitest tests, TypeScript and focused lint passed. The SQL fixture
  tests query semantics; their rows are synthetic and not production payment evidence.

Migration 0057 has not been applied to a production Supabase instance. No wallets
were funded, no network settlement occurred and no mainnet gate is marked complete.
