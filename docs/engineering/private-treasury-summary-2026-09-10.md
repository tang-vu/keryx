# Private treasury accounting observation

`getPrivateTreasurySummary(signer)` reads a single database snapshot and returns only
aggregate integer micro-USDC amounts. It has no public route. An absent pool returns
null, not an assertion that funds or capacity are zero. SQLite uses one query;
PostgreSQL migration 0057 provides a service-role-only SECURITY INVOKER function.

The fields distinguish:

- Capacity: the immutable configured lifetime ceiling, not a bank or Gateway balance.
- Allocated: creator budgets permanently reserved for admitted private jobs.
- Unallocated: capacity minus allocations; completed jobs do not release allocations.
- Committed: creator payment legs already admitted against those jobs.
- Confirmed: admitted amounts with matching stored facilitator-success evidence or
  transfer-search status confirmed/completed. Received/batched are not confirmed.
- Unresolved or processing: committed minus confirmed; expiry does not clear this sum.
- Conservative backing: capacity minus confirmed outflows.

Conservative backing preserves coverage for unallocated capacity and all allocated
amounts not recorded as confirmed outflows. It can overstate required available funds
when Circle has already withheld an unresolved amount, or when a completed job retains
unused allocation. Resolving those cases requires reconciliation and a separate,
reviewed capacity-release policy. This summary changes neither reservation nor balance.
It must not be interpreted as withdrawable funds, profit or a refund.

The reader checks total ordering (confirmed <= committed <= allocated <= capacity),
stored amount/payer consistency and confirmation-to-submission agreement. It relies
on existing validated database admission for the underlying signed payment records;
it does not independently authenticate receipts or verify chain finality. Actual
Gateway balance comparison, signer inventory and checkout admission remain unwired.

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
