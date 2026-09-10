# Private worker reconciliation wiring

The enabled operator worker now passes its validated treasury address to a serial reconciliation
coordinator. Execution order is encrypted-result recovery, one reconciliation visit, then eligible
research. No new public purchase route or payment retry was added.

Evidence:

- SQLite integration with actual intent/admission/confirmation methods and coordinator: two
  reserved jobs, one with pending incoming payment and one already executed with creator spend,
  become confirmed through two injected read-only search responses. Selection uses exclusive
  ordered cursors and isolates the treasury signer. The existing execution claim stays single-use.
- Coordinator tests: unresolved incoming jobs do not starve later jobs; creator pages resume;
  completed sweeps restart; concurrent ticks do not overlap; cancellation drains; malformed pages,
  lookup failures and timeouts remain redacted.
- Loop tests: recovery precedes reconciliation and execution; stopping during reconciliation starts
  no research; mismatched evidence keeps status degraded despite independent successful work.
- PostgreSQL 17 temporary isolated container: migrations 46, 47, 48, 50, 51, 52, 55, 58 and 59;
  actual service-role selection includes executed and not-yet-submitted reservations, yields one
  row, honors exclusive cursors/end, isolates signers and denies anon/authenticated access. Prior
  same-transfer processing-promotion assertions also pass. Container removed after completion.

Fixtures use synthetic unfunded identities and local signatures; search responses are injected.
There was no live Circle payment, provider call or private production worker activation. Supabase
migrations have not been applied to production. A 30-second cooperative search deadline is not
a hard database timeout, and the polling interval is not a reconciliation latency guarantee.
Large completed histories, offsite recovery, dedicated funding, supervisor readiness and a real
owner-operated private checkout remain activation work. This evidence does not establish mainnet readiness.
