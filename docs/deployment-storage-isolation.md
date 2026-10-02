# Testnet deployment and storage identity

Proposed M2 preparation, October 1, 2026. Source baseline
`57aef9fada210e2de4db2da24f966d716ffde456`. This document defines implementation and
operator acceptance work; no storage identity, enrollment command, migration or
cutover described below exists yet. M2 remains open. Mainnet runtime selection,
signing, keys, funding and deployment are outside this proposal.

## Existing authority and the gap

[D-264](../DECISIONS.md) and [configuration](../lib/config.ts) already pin the Arc
testnet contract profile and reject conflicting network/address overrides.
[RPC attestation](../lib/arc-rpc-attestation.ts) checks the remote chain; browser
[admission](../lib/db/browser-authorization-admission.ts), the
[worker signing policy](../lib/session/session-signing-policy.ts) and the
[buyer protocol](../lib/buyer/protocol.ts) independently pin testnet authority.
Reuse these safeguards; do not consolidate independent signer checks into an
operator-controlled network selector.

The [SQLite adapter](../lib/db/sqlite-adapter.ts) opens its supplied path or
`data/keryx.sqlite`, then `init()` runs WAL settings, schema installation, column
migrations, legacy counter removal and cache encryption. The
[Supabase adapter](../lib/db/supabase-adapter.ts) uses generic project credentials;
its `init()` may read and encrypt existing caches. Neither checks a deployment
identity before these operations. [DB selection](../lib/db/index.ts) depends on
Supabase credential presence and otherwise selects SQLite. Direct adapters and
raw SQLite scripts also exist; protecting only `getDb()` would leave bypasses.

Payment rows and browser intents carry a network; `session_grants`, login
challenges and web sessions do not. A random nonce or grant epoch does not identify
its deployment. Journal [SQLite controls](../lib/db/sqlite-browser-journal.ts) and
[PostgreSQL migration 0069](../supabase/migrations/0069_browser_authorization_journal.sql)
already retain original epochs, signer consumption and writer capabilities.
Storage enrollment must not activate that journal, reset spend, delete exposure,
infer settlement, or alter these independent fences.

## Identity contract

Introduce one immutable, versioned identity record per application store, with
exact comparison against an operator-managed expected identity:

| Field | Meaning |
| --- | --- |
| `format` | Fixed storage-identity version; unknown versions refuse. |
| `deploymentId` | Random nonsecret UUID identifying one logical deployment, retained across its releases/restarts. |
| `storageId` | Random nonsecret UUID identifying its authoritative store, retained in backups and restore lineage. |
| `network` | Literal `eip155:5042002`; no supported mainnet value. |
| `authorityMode` | Exactly `testnet-real` or `testnet-offline`, fixed at enrollment. |
| `profileDigest` | Canonical digest of the pinned chain ID, token, Gateway Wallet/Minter, Circle environment and profile-format version. No secrets, URLs with credentials or volatile RPC provider choice. |
| `enrollmentId`, `enrolledAt`, `provenanceDigest` | Identity of the explicit enrollment and digest of its private evidence manifest, not a payment or audit claim. |

Expected `deploymentId`, `storageId`, mode and profile come from a dedicated
nonsecret deployment manifest. The profile remains code-pinned testnet; configuration
can select neither mainnet nor arbitrary addresses. Missing, partial, malformed or
conflicting configuration refuses authority. Public diagnostics expose a bounded
status/reason and release commit, not the private provenance manifest or row counts.
Environment variable names and manifest packaging should be fixed in implementation
review; do not invent undocumented variables as existing operational controls.

Real and offline testnet need **different stores and deployment IDs**, even though
their chain label is identical. Offline simulation must not gain access to real
grants, pending payments or encrypted delivery state. An enrolled real store may
retain historical explicitly simulated rows unchanged; enrollment does not relabel
them or permit new offline financial writers. An offline store accepts only explicitly
simulated financial records and rejects browser/treasury signing and settlement paths.

[Gateway selection](../lib/payments/payment-gateway.ts) currently forces offline
when `KERYX_FORCE_OFFLINE=1` and also falls back to offline when no treasury key is
available. That fallback cannot remain an implicit mode change against a real
store: refuse the unavailable treasury operation while preserving independently
authorized browser sessions. Mode is not inferred from LLM availability or secret
presence. A build or operator inspection is not permission to change store mode.

## Admission and backend guarantees

Check identity before normal schema changes, cache reads/encryption, authority
reads, reconciliation, signer construction or outgoing settlement work. Publish a
shared adapter only after initialization succeeds; initialization concurrency/failure
is handled by the separate DB-selector fix. Every public adapter entry point needs
the initialized-identity guard, including direct constructors used by CLI/worker
paths. No operation can call `init()` implicitly to repair an identity mismatch.

For an existing SQLite file, open without creation and inspect only the identity
table before enabling WAL or running `SCHEMA`/`ensureColumns`. Missing identity is
an enrollment requirement, not an empty database. Unknown files, missing paths,
symlinks and replaced file identities refuse; explicit creation is a separate
operation. Retain an open verified handle and do not reopen by pathname behind it.
Read-only inspection uses a separate restricted interface, never a writable adapter.

For Supabase, identity metadata is owner-managed and inaccessible to anon or
authenticated clients; service-role access may read the bounded identity but may
not insert, update, delete or enroll it. Use owner-installed constraints and revoked
privileges, with carefully reviewed fixed-search-path functions where necessary.
The adapter must check it before its current cache scan. Owner migration tooling
checks identity before all normal future migrations; applying a bootstrap identity
table alone never labels a populated project. An unavailable project or forbidden
identity read refuses; never fall back to SQLite after Supabase selection.

Do not claim that an application preflight fences old/raw writers. The active
cutover requires every DB caller to use a checked entry point; stronger database
write protection must be part of implementation acceptance. SQLite write triggers
can require a connection-local code capability bound to the expected identity
(not a caller-writable table flag); old connections lacking it refuse. PostgreSQL
authority mutations must compare the expected identity inside the same transaction,
using restricted RPC capabilities rather than a caller-settable GUC. Preserve and
compose with existing browser-journal capabilities. Review every financial/auth/
source-authority table and its SQL/RPC entry points explicitly; unrestricted
service-role CRUD cannot remain an undocumented mutation bypass.

Authority reads also need a checked adapter and, for PostgreSQL RPCs, the identity
check in the same transaction as returned authority. Until table-read callers are
routed through that boundary, label the stage application startup isolation only.
Dedicated project credentials, a fixed trusted HTTPS project endpoint and DB-owner
trust remain necessary. A marker is not cryptographic proof against a malicious
DB owner, transport or host administrator.

## Explicit legacy enrollment and provenance

Provide a separate keyless operator tool with two phases: bounded read-only inspect
and explicit enroll. It must not use the normal adapters, initialize caches, construct
signers, contact Circle/RPC, schedule work or submit payment. Retain evidence privately
outside Git/public health. It may access only the explicitly selected store and identity
metadata, using bounded paging/timeouts and backend-specific transaction limits.

The inspection manifest records the exact target identity, source release/schema
fingerprint, backend, integrity result, consistent snapshot digest/identifier, and a
canonical digest of financial/auth/journal provenance. Include counts and exceptions
for network-bearing payments/intents/withdrawals/private orders; exact requirements,
token/Gateway bindings, retained epochs/capacity and journal activation state. Inspect
serialized requirements as well as top-level network columns. Do not retain secret
values, cookie bearers, payment headers or decrypted paid content in that manifest.

Known foreign-chain, conflicting tuple or malformed authority evidence refuses
enrollment. Missing legacy network evidence stays unknown. A network column, domain
26, token address shared by both networks, familiar filename or SDK version cannot
prove an unlabelled row's origin. The operator must attest historical deployment/
backup provenance and identify every unknown class and its retained restriction.
For funded grants/journals whose origin or consumption cannot be established, pause
that authority and resolve it under the existing recovery policy; never delete it,
reset caps, invent missing nonces or relabel payments to make enrollment pass.

Enrollment consumes the reviewed manifest digest and the exact expected identity.
Under exclusive SQLite `BEGIN IMMEDIATE` or a PostgreSQL owner transaction with a
fixed enrollment lock, recheck that no substantive state changed since inspection,
then insert the one identity record and install the reviewed storage fences atomically.
Different concurrent identities refuse; repeating the identical completed enrollment
acknowledges it without mutation. A crash is either no enrollment or that complete
enrollment; an uncertain acknowledgement requires inspection, never a second identity.
Identity records cannot be relabelled through normal application or enrollment APIs.

An explicitly created empty store may be enrolled atomically with creation by the
same tool. "Empty" means a new exclusively created file/project/schema with no
application authority rows, not merely zero payments. Persistent local/offline and
CI stores use this explicit provisioning; an isolated in-memory test helper may
create and enroll an ephemeral offline fixture. Do not give production constructors
an `ignoreIdentity` option or a missing-marker compatibility path.

## Operator rollout, recovery and rollback

1. Implement and review the candidate plus both backend gates. Rehearse first with
   synthetic populated legacy stores, copied funded journal shapes and isolated
   snapshots. Pin the release, profile and expected identity. Keep current production
   unchanged until that evidence passes; this document supplies no runtime rollout.
2. Inventory every web/worker/relay/upkeep/indexer/admin writer, direct-adapter CLI,
   raw SQLite maintenance command, backend credential and migration entry point.
   Unfenced generations cannot coexist during enrollment. Stop new admission using
   a verified ingress/route maintenance gate; an environment flag ignored by the old
   build is insufficient. Drain/stop all writers and confirm their processes exited.
   Keep signing paused while preserving original in-memory/durable uncertainty.
3. Take the existing consistent, encrypted backup and retain its original evidence.
   Produce/review the private legacy manifest with writers stopped; perform the one
   explicit enrollment. Install expected identity in every compatible process without
   changing database path/project, keys, browser derivation, receipt IDs, grants,
   journal activation, pending states or signer consumption. Preserve existing funds.
4. Start compatible processes with admission still paused. Verify identity/mode and
   all checked readers, journal inspection, encrypted content access and read-only
   recovery. Reopen new admission only after private operator acceptance. No automatic
   signing, requeue, retry or treasury fallback is allowed by a successful identity check.
5. Roll back to the pinned **identity-aware** predecessor candidate with signing
   paused. Never remove the marker/fences or reinstall an unfenced writer against the
   enrolled authoritative store. Restoring the pre-enrollment copy is a recovery review,
   not permission to resume with discarded post-snapshot grants/payments. A mandatory
   maintenance interval is preferable to an unsafe rolling mixed-generation cutover.

[Backups](../scripts/backup-db.mts) preserve the identity record in the SQLite
snapshot. [Restore](../scripts/restore-backup.ts) remains keyless after decryption and
does not authorize signing. Read-only inspection may report a real-store identity
while the inspecting process itself has no real authority. This is an explicit
inspection capability, not `testnet-offline` writable access to a real store.

A restored copy retains `storageId` and deployment lineage, and stays isolated and
unable to sign. Recovery into the same logical deployment requires exact identity,
original private keys supplied separately, original journal/capacity preservation,
old-writer shutdown and the normal funded-recovery gates. Cloning a marker does not
prove that the original deployment is stopped or make two copies safe to operate.
An independent offline experiment gets a new empty offline store; never relabel a
funded backup. Retain unknown historical provenance and unresolved payments indefinitely
when evidence is unavailable. Apply equivalent restore admission to Supabase snapshots.

Build/CI preparation must use explicitly provisioned isolated offline stores whenever
it exercises DB reads. Production preparation that requires real-store reads uses the
verified real identity and read-only capability; it must not initialize/migrate live
storage during static generation. The current [deployment flow](deployment-guide.md)
must be rehearsed with this change, not assumed compatible from a successful unit test.

## Implementation ownership and acceptance

The SQLite enrollment inventory includes the browser signing v2 controls,
barrier and writer, retained namespaces, queries and originals, and v3 writer.
These tables receive the same identity-bound storage fences as the rest of the
application; their existing protocol and immutable-original guards still apply.
An unknown application table continues to refuse enrollment rather than gain an
implicit exemption. The verified connection exposes a guarded, read-only
transaction-state property so the existing browser admission helpers can check
their transaction without receiving native registration or extension access.

Supported schema is not historical authority provenance. Nonempty browser
signing writer markers, namespaces, queries or originals must refuse legacy
enrollment; an unknown-metadata attestation cannot waive those states. Control
and barrier rows need a bounded initial-state check rather than blanket metadata
classification. Preserve unknown or previously activated history for its separate
recovery review instead of clearing it during enrollment.

This compatibility boundary does not enroll a running deployment, initialize
schema through a guarded connection, or make `getDb()` and ordinary adapters
use the verified connection. Their runtime integration, exclusive deployment
history and cutover acceptance remain required. A browser journal retains only
the payment-header hash; a future controlled paid-delivery producer also needs
a private canonical-callback handoff, rather than reconstructing a bearer
header from the database.

Stage the work with concrete ownership; merge/deploy only a usable, reviewed boundary,
not a disabled marker that appears to close M2. No generic mainnet profile is added.

| Owner slice | Files and required evidence |
| --- | --- |
| Identity/config + keyless enrollment | New focused `lib/db/storage-identity*` and `scripts/storage-identity*`; `lib/config.ts`. Pure exact-version/profile/mode tests; bounded private manifests; zero signer/network/payment imports; separate inspect/create/enroll authority. |
| SQLite authority | `lib/db/sqlite-adapter.ts`, `lib/db/sqlite-browser-journal.ts`, backend helpers/tests. Identity before any schema/cache mutation or authority read; all direct-adapter methods guarded; atomic enrollment/fences; preserved grants/journal capability; separate readonly inspector. |
| PostgreSQL authority | `lib/db/supabase-adapter.ts`, next owner-reviewed migration after `0069`, isolated PostgreSQL evaluator. Owner-only enrollment; anon/authenticated/service-role mutation refusal; in-transaction expected-identity checks; existing RPC/writer-fence parity. Do not share SQLite helper ownership concurrently. |
| Runtime/operations integration | `lib/payments/payment-gateway.ts`, DB-selector integration after its separate initialization fix; direct-DB scripts, backups/restores and deployment preflight. Mode mismatch before signer/settlement, no selected-backend fallback, complete caller inventory, verified drain and identity-aware rollback. |

Release evidence must include:

- Missing/foreign/partial identity refusal **before** WAL/schema/counter/cache writes,
  authority reads or any outgoing signing/payment call; unchanged legacy store bytes/
  logical contents. Read-only inspection remains usable and cannot mutate or authorize.
- Same/different concurrent enrollment and process starts, crash-before/after commit,
  uncertain acknowledgement, restart, malformed marker, replaced SQLite path and unavailable
  Supabase evidence. Real SQLite and isolated PostgreSQL tests, not mocked parity alone.
- SQL/raw legacy writes and Supabase anon/authenticated/service-role paths refuse after
  cutover; compatible grants/admissions/reconciliation retain original nonce, exact
  micro-USDC consumption, pending holds and separate journal activation.
- Offline-on-real and real-on-offline refusal, no-secret treasury fallback refusal,
  successful independently authorized browser paths, legacy simulated-row preservation,
  and no new simulated financial rows in a real store. Never infer mode from keys.
- Backup/restore lineage and wrong-deployment refusal; cross-store grant/receipt imports
  cannot reset capacity or become settlement evidence. Lost provenance remains unknown.
- The actual secret-free build/start/worker/maintenance entry points, TypeScript including
  MTS, focused backend tests, production build, CI/review and a timed paused-candidate
  rollout/rollback rehearsal. Funded or production drills require separate authorization.

Open release choices are the exact manifest/credential delivery mechanism, complete
legacy provenance exception inventory, and operator maintenance-window/recovery ownership.
No missing historical evidence is waived. Broader M2 still requires distinct real
deployment secrets/origins, browser-key/auth namespaces, portable receipt boundaries,
bounded funds and independent review; this storage stage does not satisfy them.
See the [mainnet acceptance map](mainnet-delivery-plan.md) and
[browser journal cutover](engineering/browser-authorization-cutover.md).
