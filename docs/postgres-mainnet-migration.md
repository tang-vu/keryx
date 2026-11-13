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

## Online copy and offline full-data intake

`create-online-snapshot-child.mts` reads the explicitly hashed private deployment
manifest and opens its declared SQLite database read-only. Before either file is
opened it verifies the actual dedicated systemd cgroup: 256 MiB, zero swap,
50% CPU, 32 tasks, a private network namespace and a 30-second hard deadline.
It uses SQLite's online backup API with a pinned read transaction, bounded page
batches, raw schema hashes and a new exclusive private output. Only that owned
copy is finalized to DELETE journal mode, checked for absent sidecars, fsynced
and hashed. Existing outputs refuse without being overwritten. This operator
tool does not load application environment, signing keys or runtime adapters.

`test-online-snapshot.mts` qualifies actual native SQLite OOM enforcement,
concurrent WAL writes, lossless int64/real/NUL-text/blob copying, outside-unit
refusal, retained output refusal and removal of only its own systemd units.
The production source remains open and serving during the copy.

Full inventory and rehearsal run on the development host rather than extending
the live VPS copy's resource window. `qualify-offline-intake.mts` compiles generic
code into a uniquely labelled Docker image; the private snapshot remains at its
original host path through an actual read-only file mount. Windows inputs require
explicit protected ACLs restricted to the current user, SYSTEM and Administrators;
Linux inputs require private ownership and mode. This is a separate operator
input profile, not a relaxation of runtime credential-file admission.

The child verifies actual Linux cgroup limits of 512 MiB, zero swap, 25% CPU and
32 PIDs, no capabilities, no new privileges, a read-only root and loopback-only
networking before input access. A verified PID-1 `timeout` enforces the hard
deadline even if native SQLite blocks JavaScript. Qualification first proves an
actual native-allocation OOM, kills a deliberately blocked child at its deadline,
refuses wrong memory limits and verifies synthetic full-fidelity values.

The November 13 retained rehearsal point contains 94 SQLite tables and 400,932
rows, including 311 query runs. Its complete typed inventory finished within the
development profile; the earlier 25-second VPS inventory refused at its deadline.
That snapshot is a rehearsal point while the live database continues writing.
It cannot be used as the final cutover state without a separately verified drain
and final consistent copy.

With `--rehearse`, the controller creates an isolated PostgreSQL 17 instance with
no external network or published port, a read-only root, 3 GiB and zero swap.
Its private data is temporary RAM-backed storage. The 512-MiB child shares only
that loopback network, opens the source read-only and uses a separate restricted
importer. A verified 30-minute external deadline bounds the complete staging
copy and every-row readback. Only metadata and digests leave the child; neither
private rows nor credentials enter the code image or evidence. Owned containers,
the generic image and temporary bundle are removed after the operation. This
lossless staging rehearsal grants no current application materialization,
cache-decryption, enrollment or backend-switch authority.

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

The next native claim protocol adds fixed availability, issue and consume calls
on the same bounded channel. Its derivative records the current SQLite
`JSON.parse` original-eligibility rules separately from SQLite's history
projection rules. Original bytes and their retained digest stay unchanged.
Changing original bytes, ID or completion time invalidates the derivative.
Issuance and consumption recheck the exact original, current A2A membership,
durable SIWE session, binding, deadline and single-use state under the existing
writer lock. A claim changes only its ownership sidecar.

Known claim failures return only after the inner write block has rolled back.
An uncertain acknowledgement stays `PostgresDomainWriteOutcomeUnknown`; it does
not generate a new token, reissue a ticket or retry consumption. Actual PG17
qualification compares the current SQLite implementation, including concurrent
consume, expired ticket/session, replaced/revoked session owner, A2A exclusion,
escaped NUL/surrogate originals and a lost actual commit acknowledgement.
This protocol composition grants no installed writer-facade provenance. Ownership
history, privacy/publication, full import and complete writer admission remain
separate work.

`createReadonlyApplicationStorage()` uses the zero-argument native factory.
Construction verifies the current identity/catalog and authenticates every bounded
cache envelope with its source and all nine logical identity fields. Missing or
wrong keys, foreign cache bindings, plaintext and oversized data refuse. Each
published read retains a fresh SQL operation check and publication guard; changes
to the pinned manifest, key or credential are refused. Private WeakMap provenance
belongs only to the factory-created facade, and asynchronous disposal drains its
single bounded pool.

The observation profile exposes dashboard metrics, private-profile reads, verified
identity lists, bounded personal/ownership history, enabled privacy reads and private
bibliography/watch reads. Other methods and all
writers refuse. `getDb()` cannot fall back to SQLite or Supabase after an explicit
PostgreSQL selection, including an unsupported testnet declaration. This profile
does not yet admit the full application, privacy/claim/account writers or payments.

Use `--native-runtime` (focused `--native-runtime-only`) with the existing native
fixture and `node:24.22.1-bookworm-slim`. It compiles the actual application factory
and runs it in separate Linux processes against the independently sealed fixture.
The process verifies its 512 MiB memory/no-swap, one CPU and 64-PID cgroup settings
before target access. These readbacks and cold-construction checks do not qualify
native pressure enforcement, compiled Next load or production cutover.

## Native private ownership history

`--ownership-history-only` qualifies the current SQLite recorded/claimed owner
predicate against native PG17. Both reads use the same identity, fresh catalog
check, native data lock and bounded pool. The network and exact claim binding
are captured before the first await. A consumed claim remains associated after
ticket expiry; a changed original, completion time or current A2A membership
removes that association. A recorded association wins and is returned once.

A separate private `run_ownership_projection` binds its allowlist summary and
validation flags to the exact retained original digest. Its producer preserves
SQLite's first repeated-key filter/eligibility behavior separately from Node's
last-key original validation and summary. It retains the SQLite question-search
bytes without PostgreSQL Unicode decoding. Missing derivatives refuse before
filters can hide them. Changing original bytes, ID, completion time or scalar
owner invalidates the derivative. Only the held owner or an explicitly scoped
native writer may create or remove it.

List SQL returns bounded summaries without projecting private original bodies.
The owner-private single-original call returns bounded exact UTF-8 bytes as hex;
the typed port validates current owner/ID/time without rewriting the packet.
The operation has its own finite result bound; global input/result limits do not
increase. The genuine read-only factory publishes these two reads behind its
publication guard and terminal disposal. This adds no privacy mutation, public
sharing, claim writer, payment or complete application-writer authority.

`qualify-offline-intake.mts <private-snapshot> <sha256> --audit-run-domains`
applies both SOURCE projection producers to every retained run inside the native
offline containment profile. It reports counts/digests and current A2A amount and
cache-envelope compatibility metadata only. It does not emit private values,
decrypt caches, modify originals or materialize an application database.

The retained snapshot's 93 application tables and all column sequences match
the current SQLite SOURCE. Its 94th table is the original one-row
`keryx_storage_identity`. Preserve those original bytes in the private staging
copy and required original; never relabel or copy that SQLite physical identity
as PostgreSQL enrollment. The real audit projected all 311 originals, found no
invalid summaries or first/last-key eligibility differences, and found no
nonpositive retained A2A amount. All 54 cache values have the bound-envelope
prefix, totaling 78,178 bytes. These metadata checks do not authenticate or
decrypt the ciphertext; cache-key and new identity continuity remain required.

## Native privacy and publication

The privacy protocol filters current publication state in PostgreSQL before
returning any original. Owner reads retain recorded-owner precedence, exact
consumed-claim binding and the separately retained owner/digest after erasure.
Mutation checks include a live SIWE session, revision and exact request bytes.
Visibility, audit and erasure run in one scoped transaction; protected financial
originals remain under their existing retention holds. Erasure removes ordinary
memory and question-derived gap text, retains financial counters and installs
digest-bound derivatives of the erased original. Tombstones prevent resaves.

New publication captures one pure Node packet before awaiting. The fixed native
operation commits the exact raw JSON, scalar record mapping, publication state
and three private derivatives atomically. It uses no SQLite runtime connection.
Fresh creation applies explicit visibility or the saved default; a resave,
historical run or orphan sidecar keeps retained policy. Numeric record counters
use decimal casts. Unknown fields in the raw JSON remain unchanged, including
escaped NUL/surrogate fields. PostgreSQL text scalars that cannot represent the
input refuse before submission; full writer admission still requires caller
compatibility and failure-path qualification for those inputs.

Private SOURCE producers preserve the current SQLite metadata expressions.
Public questions, archive cards and learning pages avoid full answer/trace reads.
Source-history metadata retains answer presence and allowlist evidence fields;
each call resolves current source/item provenance in the same SQL snapshot.
These private derivatives confer no visibility or enduring authorization cache.
The zero-argument observation factory exposes enabled privacy reads only;
creation, sharing, export audits and erasure remain refused on its reader role.
Feature flags, manifest, credential and key changes invalidate the facade.

The native fixture compares actual SQLite behavior, concurrent revisions,
session revocation, claimed erasure, changing source/item provenance and lost
actual publication/erasure commit acknowledgements. Uncertain writes are never
automatically retried. `--privacy-only` qualifies the candidate protocol without
allocating installed-factory provenance; the complete `--native-runtime` fixture
retains the independently pinned SOURCE/catalog and genuine compiled Linux factory.

`qualify-offline-intake.mts <private-snapshot> <sha256> --audit-run-privacy`
checks all retained privacy/erasure derivatives inside the qualified offline
native resource profile. It publishes counts/digests only. This audit does not
materialize or enroll an application database. The retained snapshot contains
about 108 MB of public originals. A full-body collection has a finite 32 MiB
bound and refuses as a whole if exceeded; remaining report/list callers need
bounded iteration before full application admission. Native materialization,
cache-key continuity, remaining domains, full writer and compiled load/cutover
qualification are still required.

## Native private workspaces

Bibliography persistence uses fixed token reads, owner metadata lists and atomic
create/replace/revoke operations. Keep the existing token-hash namespace,
20-record owner limit and optimistic revision rules. List queries select metadata
only. Replacing a snapshot keeps its token; revocation invalidates its URL.
Unknown write acknowledgements do not trigger a new token or automatic retry.

Manual topic watches bind an immutable copy of the original durable session.
Every operation checks its exact hash, wallet and issued/expiry timestamps in
storage. CAS checks the current revision, trusted store deadline and owner limit
under the same native writer lock. Preserve completed history, pending-check
identity, existing watermark entries, creation time and used specification;
cancelled states remain tombstones. This port adds persistence to the existing
manual metadata workflow; it adds no scheduler, funding or payment authority.

A private digest-bound watch derivative preserves the current Node validation
and canonical comparison rules. It stores hashes of transition fields instead
of private question text. Held SOURCE intake validates the exact retained state
bytes; new writes capture one pure Node packet. Original/owner/ID/revision changes
invalidate the derivative, and a missing derivative refuses. The genuine
observation factory exposes only bibliography and session-bound watch reads.
Its writer methods refuse before parsing caller data.

`qualify-offline-intake.mts <private-snapshot> <sha256> --audit-workspaces`
checks retained workspace compatibility inside the qualified native resource
profile and reports counts/digests only. The retained snapshot has no bibliography
records and one valid watch. This does not materialize the application database,
admit the complete writer or qualify production load/cutover.

The native SOURCE fixture is pinned to the official PostgreSQL 17.12 image. Its
catalog comparison omits only one well-formed, unsigned 64-bit `pg_attver` column
option on patched PG17. That backend-owned WAL version differs between independent
installations; every other column option and every structural/security descriptor
still participates. Actual independent installs and changes to both `n_distinct`
options exercise the distinction. Keep the server's composite-type safety checks
enabled. See the [upstream attribute-version design](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/catalog/README.attver.md)
and [17.12 release notes](https://www.postgresql.org/docs/17/release-17-12.html).
The retained, dormant Supabase acceptance fixture runs its exact original 17.11
image and immutable contract; it does not grant a new production backend profile.

## Native ordinary content writes

Fixed operations cover source/item upserts, metadata and notification settings,
sync values, query memories and gap-intent leases. Retain original creation time,
sticky source/item provenance, on-chain metadata and exact manifest timestamp
strings. Item ordering puts missing dates last; recency excludes the same malformed
feed-date shapes as the current SQLite implementation. Complete result bounds
refuse rather than return an incomplete collection.
Exact article-URL lookup remains scoped to one source, retains literal URL matching
and refuses ambiguous membership before a caller can select a paid article.

Cache writes seal the plaintext against the source and all storage-identity fields
before submission. Serialize the 512-row/8-MiB ciphertext quota with the native
writer lock, including UTF-16 source-ID and per-envelope bounds. A lost commit
acknowledgement remains unknown and cannot cause an automatic second write.

Bounds belong to named operations: item batches and sealed cache inputs 8 MiB,
memory/sync inputs 1 MiB, source/metadata inputs 256 KiB, other existing setters
64 KiB. These ports do not admit raw SQL or a transaction callback. Full-writer
admission remains closed until managed-source history, remaining current domains,
lossless materialization/cache continuity and compiled load/cutover qualify.

## Native decision reviews

Fixed review ports retain owner isolation, one activation deadline, exact captured
terms, one gate verdict and one approved consume. An identical verdict key reads
back its current record; a changed payload conflicts. Later opinions and code
observations retain the initial decision and its financial terms. Cancellation
and expiry do not imply a payment, job action or release of financial capacity.

Keep original `input_json` and verdict bytes as text. The current API accepts NUL
in a source name, which PostgreSQL JSON extraction cannot safely project. A private
SOURCE-derived metadata row binds the required fields to the exact original SHA;
an original change invalidates that derivative. Reads require the live binding
and return bounded raw bytes for the existing strict TypeScript projection. No
free text is normalized into JSONB. This follows PostgreSQL's documented
[Unicode restrictions in JSON processing](https://www.postgresql.org/docs/17/datatype-json.html).
Lists refuse beyond 300 rows and metrics
return bounded cohort aggregates without private reasons. The observation factory
exposes only the corresponding reads and refuses writers before parsing input.

The complete application writer remains closed. These protocols still require
their actual PostgreSQL, original-data, factory and full required CI acceptance.

`qualify-offline-intake.mts <private-snapshot> <sha256> --audit-reviews`
checks retained originals and reports counts/digests only. The rehearsal snapshot
contains 2,344 compatible review records and one verdict. The audit uses the
verified 512-MiB/no-swap/offline child and its original hard deadline; it does not
materialize the application database or grant writer/cutover authority.

## Fresh authority before native cache cryptography

Recheck native authority asynchronously after the cold-cache read and before
opening envelopes. The shared native core also verifies authority after reading
cached ciphertext and before decryption, and before sealing a cache write. Its
primitive string inputs are captured before waiting; disposal or changed authority
prevents crypto and submission. Keep source/identity AAD, key fingerprints and
the existing codec/size limits.

The compiled Linux fixture can hold a completed cold-read acknowledgement while
its synthetic owner actually revokes database authority. It then requires factory
refusal with zero decryption calls and drains the reader connections. This is a
fixture-only protocol barrier; it provides no runtime callback or target discovery.

## Native public health observation

Use one fixed read-only operation for metrics, current A2A operations and the four
worker/reconciliation sync keys, including the two registry keys only when
configured. The existing control/data locks protect all inputs. Reuse the current
dashboard aggregation inside that operation without a second full catalog scan;
keep fresh identity, catalog, durability and authority checks for every request.

Retain SQLite's completion markers and ordinary/recovered/unknown latency cohorts.
Read sync keys in one bounded batch, preserving requested order, missing nulls and
literal Unicode. Refuse a whole observation beyond 1,000 relevant jobs, 4 MiB of
job packets or 4 MiB of sync values; never publish a truncated healthy result.
The read facade can return an unavailable snapshot for a data-bound failure only
after a fresh authority check succeeds. Revoked authority and disposal still reject.

Synthetic PostgreSQL/SQLite parity and the genuine compiled Linux factory qualify
this observation path. They do not prove production load capacity or identify the
cause of historical timeout incidents. Complete writer and cutover remain closed.

## Retained financial and cache compatibility audits

`qualify-offline-intake.mts <private-snapshot> <sha256> --audit-a2a` checks exact
micro-USDC amounts, fee splits, recorded network/order identity and retained
purchase/inbound tuples. Keep unknown or conflicting lineage explicit. Matching
database rows do not authenticate a settlement or authorize another execution.

`--audit-cache` authenticates every bounded retained envelope against the identity
inside that same hash-verified snapshot. Supply the existing `CONTENT_MASTER_KEY`
through the operator environment; only the actual contained audit child receives
it over stdin. Keep the original read-only mount, verified native-memory pressure
and hard deadline. Counts, source/key fingerprints and digests leave the child;
plaintext and key bytes do not. These audits do not import application tables,
rebind cache ciphertext to a target identity, enroll a store or start jobs.

## Qualified native financial observations

The genuine read factory binds the existing fixed consent, retained signer
capacity, funding, withdrawal and hosted-ledger observation ports to the current
`KeryxDB` method names. They share the existing native channel and preserve fresh
authority/configuration checks and terminal disposal. These observations retain
the original protocol validators and accounting rules; they do not read through
the legacy RPC bridge or allocate another connection pool.

Mutation methods remain absent from this facade. Reading retained policy or
withdrawal history does not renew a policy, authorize a withdrawal, reset capacity,
submit a payment or open complete application-writer admission.

## Native public usage and current history

Fixed operations classify the complete metadata/payment window before cohort
selection. Financial totals include private, unlisted and erased runs; public
history and the published population are separate. The complete window remains
bounded to 10,000 runs, 50,000 joined payments and 8 MiB of decoded metadata.
Oversized reads refuse without reporting partial totals. Private usage derivatives
retain SQLite's first matching root usage/provenance fields (2,048/1,024 bytes),
bind their original SHA and invalidate on original/identity/time/asker changes.
Publication and prospective erasure install these derivatives in the same native
write scope as the other run projections.

The read factory awaits fresh authority after preparing a private per-call
selection, then performs a final fixed native transaction that rechecks authority,
PUBLIC state, original identity/time/usage and current bodies together. This
transaction is the history observation point. No further asynchronous authority
read returns previously observed bodies. A withdrawal before this observation
removes the candidate; published sampling can use remaining captured candidates,
without adding newly public rows outside that population. Legacy inactive history
preserves its identity/time-only interpretation and binds original SHAs across
the native reads. Raw originals retain unrelated escaped NUL/surrogate fields.
History bodies have finite per-original and complete-response limits.

`--usage-only` compares actual PostgreSQL with a genuine selected SQLite reader.
The native factory fixture also withdraws publication after its actual committed
authority read and before the final body operation. `--audit-usage` inspects the
retained hash-verified original in the qualified contained child, publishing
counts/digests and metadata incompatibilities only. These checks do not materialize
application tables, activate the full writer or change production storage.

## Bounded native public ledger

The native ledger port returns the existing detached financial snapshots, with
null positions for excluded originals consuming the same 251-position scan.
The generic ledger reader awaits either a synchronous SQLite snapshot or a
PostgreSQL promise before hydrating payments. A present failed capability never
falls back to whole-run reads. The SQLite constructor remains synchronous.

Private SOURCE derivatives bind snapshots to original SHA and body identity/time.
Only closed source/item reference IDs enter JSONB; snapshot text travels as UTF-8
hex so arbitrary recorded content versions retain escaped NUL/surrogate values.
The final fixed read checks current native authority, PUBLIC state, originals and
source/item synthetic provenance together after the factory authority await.
No question, answer or full original leaves this operation. Publication,
replacement, identical replay and erasure maintain the derivative in their
existing native write scope. Per-snapshot text is limited to 2 MiB and the
complete decoded snapshot window to 16 MiB; overflow refuses the read.

`--ledger-only` compares actual PostgreSQL with the genuine selected SQLite ledger
capability, including excluded positions, current provenance, invalid/missing
derivatives, escaped content versions and reader/disposal boundaries.
`--audit-ledger` inspects the retained original in the contained read-only child
and emits counts, byte totals and a digest. These are protocol/data compatibility
checks; they do not admit the complete writer, import application tables or
establish production capacity.

## Native customer deliverable choices

Preserve the immutable acceptance store UUID and the exact SQLite `SELECT *`
order JSON, including property order and JSON stored as TEXT. Existing original
fingerprints hash that representation and the exact delivery token; PostgreSQL
JSONB reserialization cannot replace it. A private SOURCE derivative retains the
original text and hashes. The native read compares every current order field,
with explicit JSON/date representation conversion, and independently requires
the current exact purchase/inbound tuple. Any order update invalidates the
derivative. Future A2A writers must publish its replacement before complete writer
admission; no caller can install one through the read facade.

Fixed native choice operations preserve current session/key scope authority,
revision CAS, exact idempotency, private reasons and explicit public consent.
Concurrent revisions have one winner. An uncertain write acknowledgement remains
unknown until an explicit same-key request reconciles it; there is no automatic
write retry. Neither a choice nor recorded settlement rows execute a refund,
revision, payment or job. Public choice counts remain labelled unmeasured.

The genuine read factory captures selectors, awaits fresh authority and then reads
the current original/consent in its final native transaction. It exposes read,
public state and counts, while refusing submission before inspecting its input.
`--acceptance-only` compares actual PostgreSQL against genuine selected SQLite,
including expired/revoked authority, original changes, concurrent CAS and actual
lost commit acknowledgement. The compiled Linux factory also withdraws consent
after a committed authority read to prove that the final observation sees it.
`--audit-acceptance` checks the retained original inside the contained read-only
child and emits counts/digests. These checks do not import application tables or
open the full production writer.

## Closed native application read groups

Compile the existing 78 fixed JSON read adapters into ten SOURCE functions, with
at most eight literal actions in each `CASE`. Every branch retains its exact
argument-key set, SOURCE-derived composite argument types, named underlying call
and fresh `require_operation` check. Runtime statements contain a fixed group and
literal action. Unknown, null, cross-group and SQL-shaped action values refuse;
there is no runtime function lookup or caller-supplied SQL.

Each group requires a real read-only transaction, keeps the existing 64 KiB
argument and 4 MiB result bounds, and retains app/reader permission restrictions.
The 34 separately qualified write operations remain unchanged. The fresh combined
SOURCE contains 444 application functions, leaving space for remaining domains
inside the unchanged 512-function and aggregate metadata limits. Full catalog
verification still runs per operation; grouping creates no admission cache.

`--read-groups-only` qualifies the fixed native entrypoints, argument refusal,
actual reader role, missing former individual entrypoints and current function
inventory. The compiled Linux factory and complete native financial/domain CI
remain required before accepting a new runtime profile. This changes internal
native entrypoints without changing public product contracts or production storage.

## Native account membership journal

Nine fixed operations preserve the existing six-table account journal: offer,
resolve, current, resume, issue, take, complete, unlink and revoke. Native checks
bind the exact durable login, membership revision, credential generation, origin,
network and consent. The dedicated mainnet profile requires the enrolled origin
and network; this does not qualify arbitrary cross-origin account enrollment.
JWT authentication remains the server caller's responsibility. A session hash is
a selector, never a credential or payment authorization.

Keep the exact stored challenge TEXT and lease commitment. Invalid take attempts
commit their consumed marker, while ordinary refused mutations roll back. Concurrent
take/complete operations have one winner. Unknown commit acknowledgement stays
unknown and receives no automatic retry. New login/resume retains the credential
generation; unlink/revocation cannot resurrect an old session. Keep eight wallets,
eight live challenges and the existing 1024-entry retention limits. No financial
row or signing authority belongs to these write scopes.

`--accounts-only` compares actual PostgreSQL with genuine selected SQLite,
including current-session changes, actual writer blocking followed by revocation
or expiry, retained challenge limits and a real lost commit acknowledgement.
The compiled Linux readonly factory exposes offer/resolve/current and exact
durable web-session reads. It captures inputs before awaiting authority and performs
the final native account read afterwards; a committed session revocation at that
boundary refuses the result. Mutations refuse before inspecting inputs, and
captured methods refuse after terminal close.

The factory supplies no `prepareHistoryFence`. SQLite retains that synchronous
seal. PostgreSQL instead supplies the explicit `prepareAsyncHistoryFence` when
the privacy domain is active. The owned-history route serializes its response,
finishes privacy and exact-credential awaits, then awaits the native final read
last. No further IO or await follows it, and it grants no streaming authority.

Preparation captures immutable request-local inputs and compares the complete
semantic original, including unknown fields, with the actual raw native original.
Detail observations without list attribution still require positive captured
recorded/claimed ownership. Preserve raw-original SHA-256 and every privacy/claim
field, including absent rows, completion time and A2A association. The one-use
final read checks that fingerprint and current account/session in one fresh native
snapshot after the authority/writer wait. Preparation cannot cache permission.

Keep 1000 items, 4,000,000 raw bytes per original, 16,000,000 aggregate raw bytes
and the existing 25-second request deadline. Native byte limits apply before
body materialization. The compiled genuine readonly factory exercises the actual
owned-history route and commits a privacy change after its final credential read
and authority await; the prebuilt response must be refused. Protocol qualification
compares the native final read with the selected SQLite seal, including whole-body,
privacy, claim/A2A, session, malformed input and terminal-disposal boundaries.

The complete application writer, materialized import, production capacity and
cutover remain closed. The retained original's accepted typed inventory contains zero
rows in all six account tables; that census does not establish future import or
history authorization.

## Native private chat links

Keep the two existing chat tables and seven operations: issue, preview, complete,
lookup, unlink, list and unlinkAccount. Fixed native statements select literal
actions; caller data cannot select SQL or a function. The dedicated profile uses
the enrolled origin/network. Provider scope/user selects the reservation; the
stored delivery channel remains unchanged by a lookup from another channel.

Completion checks the exact live account session, current revision, member and
credential generation inside its native transaction. Lookup requires current
active membership while retaining a stale reservation for explicit unlink.
Concurrent completion has one winner. A takeover refusal commits the token's
consumed marker without moving the link. Capacity or authentication failure rolls
back; an unknown commit acknowledgement receives no automatic retry and can be
reviewed by explicit lookup. Keep 32 links per account, unexpired burned hashes,
replacement/unlink invalidation and recipient-scoped expiry cleanup. Read clocks
after writer waits; a queued request gains no stale session or token lifetime.

The genuine readonly factory publishes the non-enumerable core/facade capability
recognized by `chatAccountPort`, with current reads after authority awaits.
Mutations refuse before inspecting their input. Its compiled fixture commits
credential revocation after an authority read and requires the final link lookup
to refuse. Protocol qualification compares actual PostgreSQL with selected SQLite,
including three platforms, limits, takeover, revocation, expiry and lost commit
acknowledgement. The retained original has zero rows in both chat tables.

The store supplies no provider-envelope authentication or browser consent proof.
Existing verified-provider, private-channel and HMAC callers remain authoritative;
links attribute future history only and grant no payment, funding or custody
authority. This does not admit the complete application writer, import application
data, execute jobs or establish production capacity/cutover acceptance.


## Native opt-in public profiles

Keep five operations: public read, owner settings, revision-bound update,
unpublish and sitemap. They alter publication metadata only. Published run
selection retains existing recorded/claimed ownership proof and public privacy;
missing sharing, a changed whole original, A2A membership or mismatched claim
binding cannot become a public association. Current private handles and verified
identities are read in the same final stable snapshot. Consumed claim associations
survive disabling new-claim issuance, as in SQLite. Update/unpublish check the
current durable session after writer waits and again before mutation; conflict
and authentication refusals roll back. Unknown commit acknowledgements require
explicit settings reconciliation, without automatic retry.

Add minimal public-run fields and exact original-mode booleans to the existing
private privacy derivative. Keep the fields as JSON TEXT, transported as hex, to
preserve escaped NUL/surrogates without casting an original to JSONB. Existing
whole-original SHA/byte bindings and invalidation cover the new fields, including
normal publication and prospective erasure. These derivatives grant no visibility.
A missing or unsupported derivative refuses the public read; no target repair or
fallback is permitted. Older synthetic rows may omit the nullable fields, which
cannot qualify a public-profile read.

For explicitly opted-in wallet-wide ledgers, retain settled fetch/citation,
nonempty receipt hash, network and offline exclusions. SQL groups original
numeric amounts by network and reader/creator/sponsor masks. Node applies the
existing exact JS Number/recordedMicros admission and multiplies by integer
counts; an invalid amount makes only its affected aggregate null. Claimed runs
grant no contribution inference. No payer, payee, transaction hash or original
body is returned in the intermediate ledger packet.

Bounds: 50 runs, 262144 UTF-8 bytes per public-run input and 8388608 aggregate
input bytes; at most 65536 ledger groups within 4194304 serialized bytes; a
22020096-byte complete RPC cap. Exceeding a bound fails closed. This is bounded
protocol coverage, not a production capacity or latency claim. Sitemap remains
at most 1000 handles. The retained SOURCE inventory has zero publication rows.

The genuine Linux readonly factory installs an own non-enumerable port on both
core and facade only when both existing privacy/public-profile flags are true.
Capture selectors before the authority await, then read current native state
last. Disabled/changed flags and readonly mutations refuse without fallback.
The full application writer, actual data materialization, startup authority,
compiled load and production cutover remain unqualified by this domain alone.

### Native recipient assignment protocol

The explicit `native-postgres-async-v1` alternative preserves the existing SQLite
synchronous HTTP reply seal. `ownerAssignmentAct` accepts only consent, confirm,
reject, withdraw and withdraw-consent; `ownerAssignmentReply` performs the final
current private snapshot. Both use fixed statements and closed bounded metadata.
The readonly core/facade owns a non-enumerable port; mutations refuse before input
getters. The factory captures selectors, awaits authority, then invokes the final
native reply without another authority await after a prepared body.

The actor must match the durable interactive login, current account birth,
member/credential generations, login floor and binding. Auth precedes replay.
A receipt means historical committed result only. Reconciliation requires the
original request ID and bytes under current authority; lost acknowledgements
never trigger an automatic write retry. Associations retain terminal audit rows,
exact revision CAS and their last-operation links. Negative decisions can clear
an association whose original or positive consent is no longer eligible.

Keep at most 25 active inbox positions, 16KiB canonical manifests, 32KiB states,
64KiB events and a 2MiB complete private SQL reply. The exact retained original
SHA, canonical completion-date string, anonymous eligibility, sharing state,
claim/A2A exclusion and independently recorded network remain mandatory. New
`original_created_at` metadata preserves the raw SQLite date representation;
its whole-original SHA and the existing invalidation fence remain authoritative.
Escaped NUL/surrogate original content never enters JSONB. Nonterminal assignment
occupancy still blocks claim issuance and original/A2A changes after suppression
or expiry. Retained privacy tombstones survive fixture cleanup until the isolated
fixture itself is destroyed.

The retained typed SOURCE census contains zero `owner269_operations` and zero
`owner269_associations` rows. Synthetic selected Full19 SQLite and PostgreSQL
qualify recipient actions using real POSIX-root invocation of the unchanged CLI
for source genesis. Source-owner revocation fault injection, writer-wait expiry,
commit-ack loss, current reader permissions and unchanged financial digests are
separate checks. The actual PostgreSQL owner CLI, production Original269, complete
writer, full materialization, compiled load and authorized cutover remain open.

### Exact anonymous-claim completion dates

Claim issuance and consumption compare the SHA-bound `original_created_at`
metadata with the retained claim's exact completion string, in addition to the
physical timestamp, original SHA and existing eligibility checks. An offset date
and normalized UTC date can represent the same instant without authorizing the
same claim. Private history, privacy ownership, public-profile selection and the
account-history final reply seal use this same exact-date condition for claimed
ownership. Missing metadata cannot grant an association.

New issuance still requires canonical UTC. Retained ticket consumption preserves
SQLite's exact-string behavior, including matching offset representations;
no stored original or claim is normalized. Regression fixtures compare actual
SQLite behavior with PostgreSQL for issuance, consumption, private reads, public
selection and prepared account replies. Source-owner corruption fixtures restore
the exact immutable SQLite trigger before invoking either reader. These tests
are isolated and create no production data, payments or jobs.

### Held public-table materialization rehearsal

`scripts/postgres/qualify-native-materialization.mts` owns a development-only
PG17.12 fixture with independently installed source and target catalogs. Both
must match the pinned runtime source/profile before input is read. The target
must have no identity, source contract or user data; only the two exact fresh
singleton controls are permitted. Existing controls are updated in place,
preserving their no-delete/no-reinsert guards. All other tables use plain inserts.

| Store | Purpose | Runtime authority |
| --- | --- | --- |
| Read-only SQLite snapshot | Immutable declared input, verified hash and sidecars | None |
| `native_staging` | Exact schema and typed original row wires, including storage classes and real bits | Operator only; application connections revoked |
| `native_materialized` | Explicit native public columns and verified values | Held; complete application writer remains closed |

The runtime catalog rejects additional namespaces. Keep staging in a separate
database, with no catalog exception or target-derived approval. Five incompatible
historical browser layouts require zero input rows. The existing
`browser_signing_queries` primary-key difference likewise requires an empty
table; a future nonempty source needs its own qualified mapping.

The closed codec preserves JSON/TEXT wire, int64 and numeric value. JSONB compares
parsed value separately from its exact retained original text. Refuse NUL/invalid
text, duplicate JSONB keys, unsupported JSONB Unicode, lossy integer casts and
timestamp normalization. SQLite extraction selects the first duplicate key;
JS/JSONB can select the last, which cannot become a migration shortcut.
Map columns by name, then stream the actual native cells in source primary-key
order and verify each row before accepting the transaction. Bounds remain finite:
64-row insertion batches targeting 1MiB, with one larger row allowed only within
the existing 8MiB typed-source row bound; 8-row re-read pages, 5-second statements and a
30-minute external deadline. A lost commit acknowledgement stays unknown and
never triggers an automatic write retry.

The development profile uses a 3GiB PostgreSQL cgroup and a 512MiB Node cgroup
with 256MiB JS heap, no swap, no outbound network route, no capabilities and
`no-new-privileges`. Its generic compiled code is capped at 4MiB; this separate
profile does not change the existing 1MiB offline-intake bound. Private input is
mounted read-only and never copied into an image. Owned containers and generated
bundles are removed after qualification; the unique retained original remains.

Public-row fidelity alone does not qualify source-derived private projections,
original-key cold cache, the complete application writer, production load or
cutover. The live source has changed since the retained rehearsal point: final
cutover requires a fresh consistent snapshot/delta and every existing ROOT,
startup, custody, payment and single-writer gate.

The fresh native schema also preserves SQLite's historical source-item retention.
The original Supabase `source_items` cascade is not present in SQLite and cannot
erase retained items or force a fabricated parent during import. Current source
lookup remains mandatory before paid bundle/article delivery; live registry terms,
source claims and settlement still provide their existing independent gates.

### Source metadata and original-key cold factory

The same development controller follows public-cell verification with eight
private projection imports: history, ownership, privacy, usage, public ledger,
decision reviews, topic watches and acceptance originals. Producers read the
original SQLite transaction; no derivative is reconstructed from normalized
target data. Preserve the original acceptance store and old fingerprints.
Parameterized insertion and actual re-read compare every field, including
bytea, JSON null and SQL NULL. Refuse existing derivative rows. A synthetic
native-original mismatch after earlier domain inserts must roll back all eight
tables before the unchanged Source can be imported successfully.

The snapshot child authenticates the existing cache and passes only its digest,
counts and Source logical identity to a separate compiled read-only runtime
child. A retained trial requires the existing `CONTENT_MASTER_KEY`; the key
travels through bounded stdin and is never logged or copied into an image.
Synthetic trials generate their own isolated key and encrypted fixture row.
This qualification requires a nonempty authenticated cache with no NULL rows;
public-cell fidelity separately preserves all original cache cells.

The cold child uses real root-private Linux credentials and the actual
zero-argument `createReadonlyApplicationStorage` factory. Its wrong-key attempt
must refuse, then the original key must authenticate every native envelope.
Compare Source and native source IDs, ciphertext hashes and plaintext hashes,
preserving their original identity-bound AAD. Do not rewrap, mint an identity,
read target identity as an expected value, or claim settlement from cache.
HTTP is denied and the network namespace has no outbound route.

The cold process retains the existing read-only runtime limits: 512MiB memory,
no swap, 256MiB JS heap, one CPU, 64 PIDs and a 16MiB compiled-code cap. It runs
after the separate 512MiB intake child exits; their resource profiles are not
combined or relaxed. Its hard deadline is three minutes. The isolated target
is active only for the read-only experiment, then is held again with no remaining
application/reader connections. The complete application writer stays closed.
Successful rehearsal still requires fresh live data, actual production load,
every-role startup admission and authorized ROOT cutover before delivery.
