# Private worker discovery evidence — September 10, 2026

`listPrivateWorkerCandidates(signer, after?)` is a backend-only query in both database
adapters. It returns up to 25 private job IDs and owners, ordered by ID, for a dedicated
treasury signer. Candidate rows require a treasury reservation, non-null confirmation
and settlement time, and no execution claim. The worker must restart its scan after
the last page to find new IDs preceding its old cursor.

These rows are hints, not verified payments. The executor must still verify the stored
intent and payment evidence, match the signed provider policy and treasury, check
funding, and win a fresh atomic execution claim. No stale claim can be reassigned by
this query. The function is not an account API and exposes no research text or bearer
signature. PostgreSQL migration `0056_private_worker_candidates.sql` grants execution
only to `service_role`, with invoker privileges and existing table RLS/permissions.

Validation completed locally:

- Three Vitest tests passed across the candidate selector and buyer/backend recovery
  integration. The integration uses real EOA signing, journal files and reopened SQLite
  with a synthetic facilitator; it verifies pending exclusion and removal after claim.
- A disposable PostgreSQL 17 container applied migrations 0046, 0047, 0048, 0055 and
  0056. Thirty synthetic relational rows verified the 25-row limit, second-page IDs,
  pending/claimed/other-signer filters, service-role execution and denial of function
  privileges to `anon` and `authenticated`. The container was removed afterward.
- TypeScript and focused ESLint checks passed.

No live payment, source purchase, provider request or worker run occurred. The private
worker polling loop, bootstrap and readiness checks remain incomplete; private checkout
is not enabled by this change. PostgreSQL synthetic rows test selection and privileges,
not signature verification or real settlement validity.
