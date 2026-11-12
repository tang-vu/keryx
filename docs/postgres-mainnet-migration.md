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

The same owned fixture tests `scripts/postgres/rehearse-snapshot.mts` against an
empty private PostgreSQL namespace. Its row encoding preserves SQLite storage
classes, signed 64-bit integers, real-number bits and raw text/blob bytes, including
embedded NUL and invalid UTF-8. It carries those bytes as hexadecimal strings;
PostgreSQL text/JSONB conversion cannot silently replace or reject original bytes.
The copy includes empty/internal tables and the complete original schema text.
It reads back bounded pages from PostgreSQL and compares every encoded row,
sequence, count and digest before committing. Duplicate attempts refuse rather
than overwrite an existing rehearsal copy; runtime readers cannot observe it.
The source must be a private consistent snapshot with an owned read transaction.
Virtual/shadow/generated storage and oversized rows refuse for separate review.
This is a lossless private staging copy, not a restored application schema or a
verified financial migration. It creates neither runtime grants nor enrollment,
does not decrypt caches, and exposes no command that switches the application.

The fixture uses synthetic identities and functions. It does not load application
credentials, import production data, execute payments, enroll a store or establish
current mainnet domain parity. The dedicated preparation workflow and full required
source checks retain their separate acceptance roles.

## Remaining application admission

The first native financial domain is qualified separately through
`scripts/postgres/test-session-consents.mts`. It installs the same source into two
fresh synthetic PostgreSQL17 databases, compares their complete native catalog
contracts, and seals the target with the independently generated source metadata.
The source and target use UTF-8 with the C locale, retaining binary ordering and
avoiding a contract tied to an arbitrary host locale. Runtime-role and database
connection limits are included in that independently checked catalog contract.
Every domain call checks the full expected mainnet identity, source contract,
held/active control, finite deadlines, transaction isolation and durability settings
inside its native transaction. A dedicated role owns the private helpers; runtime
roles receive only the named domain calls. Mutations share a finite native lock and
protected transaction-scoped writer, while observation works in a real read-only
transaction. No SQL handle or generic transaction callback becomes an application port.

The consent ledger covers v1/v2 issuance, exactly-once concurrent consumption,
retained cumulative signer spend, failed-admission rollback, expired challenges,
hosted-signer separation, pending withdrawal barriers and historical owner proofs.
Catalog drift, direct writes, private-context calls and role escalation refuse.
Its withdrawal/hosted dependency rows exercise admission barriers only; this does
not qualify withdrawal protocols, hosted settlement or the full application backend.
The current application factory continues selecting its existing admitted store.

The typed consent transport keeps only the fixed issue/consume/read calls and
source/identity bindings. A lost acknowledgement, malformed result or disposal
after a submitted write reports an unknown outcome; it never retries the write.
The native fixture suppresses the PostgreSQL `ReadyForQuery(IDLE)` frame after
`CommandComplete`, then reconciles through a separate healthy connection. Exactly
one retained grant exists after that genuine committed-but-unacknowledged attempt.

The extended fixture (`--funding`) also qualifies native lifetime session funding
accounting against the current SQLite implementation. Its 34 differential cases
cover pending/failed debits, exact settled originals, late pre-baseline confirmations,
missing capacity/bindings/payments, foreign rails, tuple conflicts, orphan payments,
legacy real-number tolerance and more than 300 retained originals. The observation
returns integer micro-USDC strings; it cannot release held exposure or renew a cap.
The composed consent/funding transport shares one two-connection pool with eight
queued requests. Malformed accounting, oversized results, queue saturation, reader
failure and disposal refuse; none becomes an empty successful funding history.
These read protocols do not implement browser payment admission or settlement.

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
