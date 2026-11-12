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

An explicit PostgreSQL manifest can now select the controlled Linux observation
factory described below. Application writers remain closed while the remaining
current domains, full-data rehearsal and cutover are being completed.

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

The separately prepared VPS instance has a 1 GiB memory ceiling, zero swap,
75% CPU quota and 64-task ceiling. Apply
[`service-recovery.conf`](../ops/keryx-postgres/service-recovery.conf) to that
instance: let PostgreSQL recover an OOM-killed backend, restart a failed main
process under a bounded restart policy, and cap the stop deadline at 30 seconds.
The original service policy stopped the instance after a backend OOM and allowed
a one-hour shutdown wait. A controlled synthetic aggregate exposed that behavior
before any application database or login was installed. After the policy fix,
one actual cgroup OOM kill recovered automatically; all 12 concurrent predecessor
website checks returned HTTP 200 and the synthetic database was removed. This
qualifies that prepared-service failure case, with SQLite still serving the
website. It does not qualify selected-backend load or a production cutover.
Database process recovery never authorizes application payment/write retries.

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

The `--creator` qualification additionally composes session withdrawals and creator
request/transfer/attestation protocols on that same bounded channel. Session
reservation checks the retained owner proof and current liabilities, then pauses
the active grant atomically. Prepared cancellation, signing exposure, authenticated
publication abort and completion retain their original barriers. An actual lost
commit acknowledgement after exposure cannot become a cancelled unsigned request.

Creator requests retain the unique underlying transfer spec and an initial transfer
claim that can be won only once. A lost claim acknowledgement is reconciled by
reading the retained claim; retry cannot grant another initial transfer. Saved
attestations are matched to the original request and claim, retaining their
`request-matched-only` authority. Actual same-time history pagination is compared
with SQLite. Session completion is exercised through those actual native creator
protocols using unfunded synthetic signatures and a labelled recorded observation;
it makes no vendor/chain call and supplies no production finality proof. Hosted
treasury, complete application parity and production cutover remain pending.

The `--owner-withdrawals` profile adds the retained hosted ledger and creator owner
withdrawals. Policy storage remains bound to the exact immutable store identity
and historical public/private custody role. Accounting checks original public
payment tuples and private submission/confirmation dependencies, retains failed
and pending exposure, and never treats a missing proof as zero spent. Native
submission is single use; an actual lost commit acknowledgement does not renew it.

Owner withdrawal admission compares the complete current local liability baseline,
checks fresh available capacity, and pauses grants without clearing retained
consumption. Completion requires the exact saved original request and attestation.
Synthetic recorded observations are explicitly labelled and make no chain request.
The current fixture adds 40 hosted-ledger and eight owner-withdrawal comparisons;
it does not qualify new hosted authorization or private execution admission.
Those protocols, complete application composition, source/domain parity and the
production data transfer/cutover remain required before backend selection.

The `--application-financial-reference` profile also installs the existing
application-table source through migration 72, followed by the qualified native
financial ledger, into two separate empty namespaces. Profile constants are
selected in source DDL; imported rows and historical evidence are never relabelled.
Text-backed UUID domains preserve original UUID representation. Native boolean
payments and JSONB originals exercise the same accounting and withdrawal protocols.
The old browser-only payment check is replaced by the native original tuple/state
checks because hosted payments have a separate policy ledger and no browser epoch.
A foreign-network browser original is rejected by its table constraint during a
transactional fixture import; no partial import or held control remains afterward.
Legacy public RPC and direct table privileges remain revoked from application
roles. This profile qualifies financial table compatibility only; later tables,
all application ports and production migration still require acceptance.

The native descriptor materializes its bounded metadata once per call. A real
PostgreSQL comparison requires every descriptor field to equal the existing
reference and checks escaped-field overflow before final aggregation. This removes
a repeated scan; it neither caches successful authority nor skips schema checks.
The harness records local timing and independently verifies legacy RPC and raw
column-read refusals. These timings are not compiled production load acceptance.

The `--application-domains` profile composes 78 existing named read contracts
with the financial reference. Their fixed native entries validate exact JSON
argument keys, require a real read-only transaction, and verify caller-pinned
identity and schema inside it. The internal legacy RPCs remain ungranted, and the
legacy write bridge always refuses. Reads share the financial transport's bounded
pool and queue; failed transactions discard their client and never retry.

The shared business core can now use this RPC-only port without constructing a
Supabase SDK client or fabricating a Supabase deployment. Native cache reads keep
the identity-bound encrypted envelope. Core assembly, injected callbacks and type
casts still confer no installed application provenance. Ordinary optional ports
are not attached to the native core. Actual database checks exercise the catalog,
user/KV getters and shared source/item decoders; the full financial fixture still
runs against the larger independently constructed source.

This read composition does not qualify every legacy result shape or its native
memory use. Complete current-domain coverage, bounded report projections and
pre-aggregation limits, native pressure tests, optional ports, writes and the
closed application factory remain prerequisites for production selection.

The `--current-application-tables` profile also installs the 34 remaining
application tables, nine retained/current columns and 22 additional indexes.
Every added table and index is tied to its current SQLite SOURCE declaration
hash, and source and target are built independently. All 93 SQLite application
tables are represented; the native reference has one additional legacy policy
projection. The three transient SQLite writer IDs deliberately map to native
transaction IDs and must be empty. Their rows are never imported as capabilities.

New integer-affinity fields use a bounded numeric domain with explicit integer
checks where the source requires them. This avoids PostgreSQL's implicit bigint
assignment rounding accepting a fractional revision that SQLite rejects. Native
constraints retain the source's ASCII wallet/handle rules, JSON kinds/array limits
and UTF-8 byte bounds; 18 differential cases cover those boundaries. Mainnet browser
challenge metadata/context retention is also enforced. These are table/index and
existing-protocol qualifications. Complete optional-domain triggers and mutation
semantics, exact typed materialization and runtime admission are still pending.

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


Native web authentication is exercised with `test-session-consents.mts --auth`
(or `--auth-only` for the focused fixture). Six fixed writer entries share the
financial/read pool. Twenty-four synthetic vectors cover nonce expiry/single use,
eight actual concurrent-consumption rounds, an existing 750 ms financial-lock
transaction, wallet-scoped session revocation, duplicate-hash
refusal, retained user identity, exact wallet lookup, reader write refusal and
actual lost-COMMIT acknowledgement without retry. No real login, vendor request,
production data or selected application backend is involved.


Operational qualification (`--operational`, focused `--operational-only`) adds
eleven named writes to the same native pool. Twenty-seven current-SQLite parity
vectors cover rate-window reset and concurrent admission, cooldown/probe leases,
wallet-scoped API-key revocation, retained key restrictions, concurrent daily
counters, feedback/activation aggregates and actual lost-COMMIT acknowledgement
without retry. Native API authentication waits for its audit write. Reader roles
remain unable to write, and no operational identity grants payment authority.


`--bounded-reads` adds cumulative wire-byte checks before 29 fixed native list/scan
aggregations, plus a constant-size native dashboard. Focused qualification uses
`--bounded-reads-only`: 15 list/scan vectors and 14 dashboard comparisons cover
escaped-wire overflow, complete-result refusal, projected metric scans, settlement
classification, account normalization, MCP/evidence semantics and 20,000 synthetic
answers. The native dashboard returns about 1 KiB and preserves the existing
historical-evidence label. It never falls back to loading all history after a
native refusal. Single-row conversion, other reports/custom readers and compiled
selected-backend load remain separate qualification requirements.


The private-profile protocol (`--private-profiles`, focused
`--private-profiles-only`) reuses the fixed input validator in private SOURCE and
exposes three identity-bound native entries. Fourteen actual PostgreSQL vectors
compare normalized fields and owner activity with current SQLite, including 1,201
recorded questions, retained creation time, concurrent handle claims, exact
network scope, lost-COMMIT acknowledgement, reader refusal, terminal close and
profile FK cascade without deleting research history. These are synthetic
protocol checks; installed optional-port provenance and complete backend
admission remain required.

Native profile-identity qualification uses `--profile-identities` (focused
`--profile-identities-only`). Seventeen synthetic PostgreSQL vectors compare the
current SQLite lifecycle and exercise actual concurrent challenge consumption,
external-identity uniqueness, retained verification during replacement, superseded
callbacks, unlink/profile deletion, durable session revocation, ORCID checksum and
lost-COMMIT acknowledgement. No provider login, network request, production data
or financial operation is performed. All five entries share the existing pool
and identity/source contract; this composition does not enroll an application.

`--personal-history` (focused `--personal-history-only`) adds two actual read-only
entries for owner-attributed summaries and internal financial receipts. Twenty
SQLite comparisons cover equal-time cursor pages, literal search, filters,
historical provenance, recorded-owner mismatch, oversized rows, 51/201 sentinel
bounds, unexposed receipt omission and terminal close. Large private answers and
unneeded parent identifier values stay outside the SQL projection. Receipt callers
must still prove current ownership through the privacy port; this protocol grants
no new account, claim, sharing or financial authority.

## Controlled native observation factory

The deployment manifest's `postgres` backend declares a local `endpoint` (Unix
socket directory or loopback port), `database`, the independent reference catalog
digest as `sourceDigest`, and distinct absolute `credentialPaths.application` and
`credentialPaths.reader`. Credentials are separate canonical JSON files with
`format: "keryx-postgres-role-credential-v1"`, the exact role and `password`.
Linux files must belong to the current UID, have one link, deny group/other access,
fit 4 KiB and have no symbolic path component. A reader opens only its own role
credential. Legacy SQLite/Supabase selectors alongside PostgreSQL refuse.

The native catalog digest is SHA-256 of the actual PostgreSQL `jsonb::text` wire
(`keryx-postgres17-jsonb-text-sha256-v1`), with the normalized descriptor digest
retained separately. SQL binds stored expected metadata to that digest at seal
and on every operation. The factory accepts only the package's independently
generated `runtime-profile.ts` artifact; configuration cannot allocate approval.
`--runtime-source-reference-only` emits a separate fresh SOURCE reference, with
`runtimeQualified: false`; it is not runtime/factory acceptance.

Retained `query_runs.data` uses PostgreSQL `json` in the next original-byte
profile. Claims and privacy digests bind the exact UTF-8 text, including key
order, whitespace, escape and numeric spellings; never recompute an existing
digest from normalized JSONB. PostgreSQL documents these representation
differences in its [JSON types reference](https://www.postgresql.org/docs/17/datatype-json.html).

JSON accessors can reject escaped NUL/surrogate values in unrelated private
fields. Owner summaries therefore read a private, digest-bound
`keryx_storage.run_history_projection` derivative, with no original body in the
summary query. The SOURCE intake producer reads SQLite's existing projection,
including its repeated-key and provenance rules. A projection insert checks its
original digest; changing the original invalidates the derivative. A missing
owner derivative refuses the read even when a filter could hide that row.
Import uses the held owner lane; ordinary roles cannot edit the derivative.
The bounded producer refuses originals above its 4,000,000-byte projection
intake limit; full-data rehearsal must account for every retained row before
the complete runtime can be admitted.
This does not qualify native claim/privacy writers or a complete import.

`createReadonlyApplicationStorage()` uses the zero-argument native factory.
Construction verifies the current identity/catalog and authenticates every bounded
cache envelope with its source and all nine logical identity fields. Missing or
wrong keys, foreign cache bindings, plaintext and oversized data refuse. Each
published read retains a fresh SQL operation check and publication guard; changes
to the pinned manifest, key or credential are refused. Private WeakMap provenance
belongs only to the factory-created facade, and asynchronous disposal drains its
single bounded pool.

The observation profile exposes dashboard metrics, private-profile reads, verified
identity lists and bounded personal history/receipts. Other methods and all
writers refuse. `getDb()` cannot fall back to SQLite or Supabase after an explicit
PostgreSQL selection, including an unsupported testnet declaration. This profile
does not yet admit the full application, privacy/claims/accounts or payments.

Use `--native-runtime` (focused `--native-runtime-only`) with the existing native
fixture and `node:24.22.1-bookworm-slim`. It compiles the actual application factory
and runs it in separate Linux processes against the independently sealed fixture.
The process verifies its 512 MiB memory/no-swap, one CPU and 64-PID cgroup settings
before target access. These readbacks and cold-construction checks do not qualify
native pressure enforcement, compiled Next load or production cutover.
