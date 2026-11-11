# PostgreSQL mainnet migration

The owner selected PostgreSQL on November 11, 2026 after recurring web CPU stalls.
The migration must preserve the current application, financial authority, original
journals and source-owned payment rules. A prepared PostgreSQL server or successful
transport test does not admit the current mainnet application to that backend.

## Current preparation

`lib/db/postgres/connection.ts` provides an asynchronous, local-only bootstrap
transport. Its three fixed reads carry the complete expected storage identity and,
where applicable, the source contract digest as bound parameters. It publishes no
pool, raw SQL, transaction callback, enrollment operation or installed-adapter
provenance. The existing SQLite and Supabase factories do not select it.

Each process has two connections and at most eight additional pending reads.
Server-side statement and lock timeouts complement client connection/query bounds.
Connection coordinates and the password are explicit; ambient `PG*` settings cannot
select another host, role or database. JSON wire size is checked before parsing.
Transport failures expose one generic error and never retry automatically.

Terminal disposal closes admission immediately and suppresses all late results.
It waits for its bounded admitted reads before ending the driver pool: ending a
pool while acquisitions are queued can strand those promises. Disposal therefore
does not turn a lost acknowledgement into a new financial attempt.

The actual PostgreSQL fixture is:

```text
node --import tsx --no-warnings scripts/postgres/test-bootstrap.mts
```

It needs the existing Docker engine and `postgres:17-alpine`. It creates one
uniquely named container with local-only port publication, a read-only root,
temporary memory-backed data/socket directories, one CPU, 768 MiB and 64 PIDs.
Its separate restricted role cannot write the protected fixture relation. Tests
cover identity/contract mismatch, queue overflow, responsive JavaScript timers,
connection counts and disposal during a real database read. The fixture removes
its own container and verifies absence; other containers remain outside its scope.
Those configured resource bounds are not a native-pressure enforcement experiment.

The fixture uses synthetic identities and functions. It does not load application
credentials, import production data, execute payments, enroll a store or establish
current mainnet domain parity. The dedicated preparation workflow and full required
source checks retain their separate acceptance roles.

## Remaining application admission

The current enrolled PostgreSQL/Supabase lane has explicit refusals for mainnet
research purchases, original fulfillment, hosted treasury, owner consent and
withdrawals. Its older sealed contract does not accept a mainnet identity. Current
privacy, user/account and archive capabilities also require a genuine native
PostgreSQL composition; ordinary constructors cannot supply a fallback.

Complete these boundaries before changing the selected production manifest:

1. Admit a source-bound mainnet PostgreSQL schema and a restricted runtime role.
   Every operation must verify the exact expected deployment/store identity,
   schema and authority inside its native transaction. Preserve provenance from
   the actual runtime factory, immutable originals, exact integer amounts, reservations,
   nonce/epoch handling and ambiguous-write recovery. No caller SQL or successful
   admission cache may replace these checks.
2. Implement and test every currently active domain: Operator and hosted research,
   browser/session grants and withdrawal protocols, creator withdrawals, original
   fulfillment, private/public ownership, encrypted content and reference archives.
   Preserve web, API, MCP, CLI, desktop, extension and bot contracts in their roles.
3. Reproduce the public report paths on PostgreSQL using bounded projections and
   finite work admission. The old full-run fallback is not a performance parity
   result. Test the compiled Next application under concurrent heavy reads, queue
   saturation, database timeouts and reader failure; readiness must stay truthful.

## Data transfer and cutover

Inventory application tables and independent custody/journal stores separately.
Keep the current serving release online while preparing and rehearsing the target.
Use verified originals, consistent snapshots and exact identity/provenance records;
never infer enrollment or payment settlement from an import result.

Encrypted cache envelopes bind the storage identity in authenticated data. A
backend transfer must prove its logical identity/lineage policy and preserve valid
bindings, or explicitly verify a qualified rewrap. Copying ciphertext under an
unrelated identity is not an accepted migration. Preserve required custody and
login defaults, and never print plaintext or credentials in evidence.

The final writer pause must include every current web/worker/reconciler and other
writer. Recheck startup policy/custody/queue prerequisites before pausing anything.
Import and compare row/type/canonical digests, financial totals, pending exposure,
caps and immutable originals. Qualify both the switch and the rollback boundary:
once PostgreSQL accepts new writes, an unchanged old SQLite copy is stale and cannot
become an automatic fallback.

Only a fully accepted source/domain/runtime batch may enter the existing serialized
cutover. Verify the actual backend, exact source, public health and required user
surfaces afterward. Retain the required originals and one verified unique evidence
copy; remove only owned regenerable preparation data after completion. The owner's
migration command grants no new funding, policy renewal or autonomous schedules.
