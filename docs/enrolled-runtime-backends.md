# Enrolled application backend acceptance

**Source-checkpoint scope:** the earlier staged backend descriptions below are
preparation history. Production now uses sealed mainnet SQLite through the normal
[application storage boundary](mainnet-server-runtime.md#application-storage-boundary).
Optional Supabase mainnet remains staged; legacy testnet stores are not relabelled.

Design D-289, October 1, 2026, with selected-network application composition added
by the reviewed mainnet preparation. `getDb()` retains ordinary testnet adapters
and requires a sealed enrolled facade for selected mainnet application storage.
This source path is not evidence of production activation, store enrollment,
payment authority or completed M2/mainnet readiness. PostgreSQL implementation and acceptance are a
separate staged change; SQLite acceptance cannot prove that backend usable.

## Supported surfaces and release boundary

The public `KeryxDB` contract remains shared. Selected mainnet application storage
is reachable through `application-storage`; its verified deployment identity must
match the selected profile before publication. Production enrollment and cutover
still require the coordinated owner-operated migration and deployment gates.

| Surface | Authority retained by this change | Remaining release gate |
| --- | --- | --- |
| Web and HTTP API | `getDb()` selects ordinary testnet storage or the sealed selected-mainnet facade | Reviewed deployment enrollment, complete caller inventory and cutover |
| Remote MCP | Shared server research path and selected-network `getDb()` | Same server cutover; retain authentication, budgets and settlement evidence |
| CLI and stdio MCP | Existing buyer transport and private journal; server storage stays behind the API | Review local worker callers and server cutover before selecting an enrolled factory |
| Desktop | Existing Operator composition and packaged native engine | Separate storage enrollment and domain cutover; native and installer acceptance do not activate Supabase |
| Extension | Existing authenticated web/API transport | Server cutover and browser authorization acceptance |
| Telegram, Discord and Slack bots | Existing guarded server research path | Server cutover with each bot's authentication and result-evidence checks |

Factory imports are confined to acceptance fixtures and guarded internal
composition, including the explicit selected-network application boundary.
Read-only Operator composition admits the sealed selected store without ordinary
initialization or schema repair. Desktop smoke changes verify packaging and
uninstall behavior only. No public API,
package or installer version change, production deployment, synchronized
distribution or funded settlement is claimed by this candidate's acceptance.

## Runtime admission

The closed factories read `KERYX_STORAGE_MANIFEST` through the existing bounded
canonical manifest reader. They accept no caller path, expected identity, client,
transport or mode override. Missing configuration, an unavailable selected backend
or any conflicting manifest refuses; there is no backend fallback.

The manifest pins deployment, store, enrollment, network, profile, provenance and
real/offline mode. Actual backend metadata must match before publication. A marker
does not establish exclusive deployment history, ownership of a private query or
settlement. Retain those separate proofs and drain/restore requirements from
[storage isolation](deployment-storage-isolation.md).

The published facade has a literal reviewed method inventory and factory-private
provenance. Adding a public method requires review. Copies, fabricated objects and
verified connection cores cannot acquire runtime provenance. Native handles,
clients, registration functions and construction capabilities stay private.

Every permitted public call checks authority, including computed answers,
unsupported stubs and early returns. SQL and RPC calls retain their own guards.
Check again before returning an asynchronous result and before/after iterator
advancement, including completion. Changed configuration, identity, target or
schema refuses. A read-only factory denies the exact reviewed mutator inventory
before invoking the core; `verifyApiKey` is a write because it records last use.
Closing remains possible after authority drift.

Source verification CAS is also a reviewed write: it changes only verification
state while the observed payout/feed identity still matches. Historical provenance
lookup is a private metadata-only helper behind the guarded read surface, never
an unguarded published method. Synthetic provenance changes the exact SQLite
source schema, so prior enrolled stores need a reviewed migration/re-enrollment.
The Supabase schema-77 source contract stays pinned until fresh reviewed acceptance;
migration 0079 does not silently admit a changed enrolled PostgreSQL profile.

Initialization checks readiness only. It must not create missing tables, migrate
columns, remove counters, reseal cache rows, normalize controls, clear history or
activate the browser journal. Legacy initialization remains its existing separate
path. A committed write followed by failed publication is an uncertain result
requiring reconciliation, not proof of no write or permission to repeat it.

## Backend boundaries

SQLite reuses the existing adapter core with the verified connection. Compare its
actual application tables, indexes and protocol triggers with a reference profile
built from the same source installer. Only explicit immutable identity and storage
fence objects are excluded, and their existing guards still apply. A different
schema needs an operator migration under drain; runtime does not repair it. Guard
the retained native target and each SQL execution without reopening its path.

Compose a separately reviewed complete installed funding-domain schema where
present. Accept its exact supported tables, indexes and triggers as a full profile,
rather than learning arbitrary objects from the target. Partial domains, tampered
objects and unknown additions refuse. Funding policy and ledger provenance remain
independent checks; recognizing their schema does not authorize a funding operation.

The PostgreSQL candidate reuses domain validators and row codecs through named,
bounded, identity-checked RPCs. Fixed arguments are evaluated once; legacy query
closures execute only in the legacy lane. An error or missing enrolled RPC never
falls back to raw table access. Private transaction writer capabilities compose
with existing browser, session and treasury guards, rather than replacing them.
An enrolled RPC error must refuse the operation before legacy fallback result
construction. An error cannot become an empty read or a synthesized successful
write; retained database evidence must establish the resulting state.

Dormant installation must preserve existing legacy privileges until explicit
owner cutover. Cutover must atomically verify the reviewed snapshot and actual
schema/privilege inventory, retain unresolved authority, install all fences and
publish identity. Failed admission leaves the store unchanged. All service-role,
authenticated, anon and unchecked legacy RPC paths need native acceptance after
cutover. DB-owner, host and configured HTTPS endpoint trust remain explicit.

The PostgreSQL 17 source profile is bounded and sealed independently of the
enrollment target. Validate raw trigger field sizes before hex encoding or
deparsing. Fresh native source exports must match the reviewed PRE/POST digests
before target acceptance. Snapshot CAS excludes only `pg_class` maintenance
fields `relpages`, `reltuples`, `relallvisible`, `relfrozenxid` and `relminmxid`;
it retains OIDs, file mappings, structural metadata, privileges, logical rows
and sequences. Maintenance alone must not appear as a financial write.

Read-only PostgreSQL operations must actually run in a read-only transaction:
fixed identity/mode checks and SELECT projections, with no writer-capability row
or locking query that requires writes. Audit transitive function bodies instead
of guessing from names. Write operations retain their locked identity and private
capabilities. The actual outer SQL statement deadline must be bounded before lock
work; a function-local timeout declaration is insufficient evidence.

Native acceptance runs cohesive independent cases under unchanged child and
parent deadlines; every case retains startup, operation and publication guards.
Measured guard cost in the resource-bounded PostgreSQL fixture is an operational
cutover gate, not a deployed latency measurement. Before caller activation, prove
that complete guarded workflows fit their actual catalog-token and payment
deadlines. Do not lengthen those deadlines or omit authority checks to make an
acceptance fixture pass.

The authority-verification RPC checks fences through `read_operation` and
`require_identity_read`. Omit its former second identical fence invocation:
the STABLE path uses one SQL statement snapshot and performs no intervening
writes. Retain the nested fence check, identity/deadline checks, mode policy
and every separate operation/publication guard; this is no cross-call cache.

Enrolled dashboard metrics read the four fixed metric scans sequentially. Each
scan retains its full authority verification, pagination and statement deadline.
This bounds competing verification work within one metrics call; the ordinary
adapter retains its existing parallel reads. Metrics are not an atomic snapshot
across the four statements and do not establish payment settlement evidence.

For enrolled browser source admission, use one private, fixed catalog read of
source, item and current offer in a single protected STABLE statement snapshot.
Separate guarded reads exhausted the unchanged five-second observation lifetime
in native acceptance. Begin that lifetime before the coherent read; retain the
identity/schema check, existing row codecs, content/version and offer validation,
registry observations and admission expiry checks after SQL locks. Missing or
foreign records refuse. This improves read coherence without eliminating the
catalog-to-admission race; authority remains bounded to its recorded observation.
The coherent reader adds no public database method or caller-selected transport,
and requires a fresh independent SOURCE profile before native acceptance.

The catalog preflight bounds raw fields to 2 MiB, tag and author arrays to 64
entries, intermediate JSON to 16 MiB and response bytes to 4 MiB. Shape checks
precede string decoding, with a separate allowance for numeric weight expansion.
Compressed legacy JSONB tags/authors refuse because their stored size does not
prove the expanded bound; legitimate compressed metadata can therefore block
enrolled source admission. Preserve that data and resolve the limitation before
cutover if the intended source set requires it. Text content uses its raw byte
length metadata, and ordinary adapter behavior remains unchanged.

## Cache format and limits

`enc:v3:` is a distinct enrolled cache envelope. Bind source ID, complete storage
identity digest and format as authenticated associated data for both the per-item
body and wrapped data key. Require canonical bounded wire encoding and exact IV,
tag and wrapped-key lengths. Real readiness requires a valid content key even for
an empty cache, then authenticates every retained non-NULL row under a coherent
bounded read. Missing keys, malformed envelopes, legacy/plaintext real rows and
wrong source/store refuse without rewriting them.

Preserve existing no-AAD `enc:v2:` behavior for legacy callers. The legacy reader
must refuse reserved `enc:v3:` rather than return ciphertext as plaintext. An older
binary does not thereby gain enrolled format support; rollback requires the
reviewed maintenance and data-format gate. No automatic backfill is authorized.
Explicit offline stores use the bounded plaintext format and remain separate.

The candidate policy bounds plaintext to 1 MiB per value, encrypted wire to
2 MiB, and retained non-NULL cache to 512 rows / 8 MiB wire. Admitted writes must
preserve these same limits atomically, including replacements. Refusal leaves the
prior state intact; a successful write must not create a state that fails the next
readiness check solely because of its quota. PostgreSQL counter/trigger and stale
snapshot behavior, and SQLite native transaction behavior, require separate proof.

These are source-keyed cache entries. Their envelope version is not an article
version, immutable paid-read lineage, owner access grant or settlement receipt.
Future private delivery artifacts use their own publication and access boundary.

## Release and remaining cutover gates

Acceptance remains unproven until the exact candidate has evidence for:

- Native full-schema admission and complete method inventory, including real
  authentication/private treasury/browser v3 helpers and canonical callbacks,
  plus the complete installed funding domain and partial-domain refusal.
- Missing, malformed, wrong-backend and replaced-target refusal before authority
  access; unchanged bytes/logical state for refused startup and enrollment.
- Raw writer, role and unchecked-RPC refusal; exact nonce/cap preservation, races,
  crash/restart, deadline and uncertain-commit behavior.
- Computed/early-return/iterator drift, fabricated provenance and every read-only
  mutator; actual read-only PostgreSQL transactions where claimed.
- Actual AEAD tamper/source/store/wrapped-key tests, unchanged legacy compatibility,
  byte/count boundaries, concurrent quota writes and restart readiness.
- Appropriate TypeScript, lint, production build, native platform/backend CI and
  independent review for the exact release candidate.

Controlled selector/worker/CLI integration, complete caller inventory, migration,
backup/restore lineage, verified drain and rollback rehearsal remain separate
work. Funded production rehearsals and deployment enrollment need their own
authorization. Browser callbacks retain a payment-header hash rather than the
bearer header: private live handoff, actual paid-body verification/publication and
immutable citation plans remain required before issuing delivery evidence.

## Retired prototype PRs

Drafts #70–#83 and #85 were retired on 2026-10-01 after consolidation;
branches and commit history remain available. Reviewed dormant funding parts
were integrated in #86 and PostgreSQL acceptance in #88; browser/storage schema
acceptance was merged in #104. This does not mean every prototype change shipped.

The old runtime/adapter and production migration prototype (#70), rollout
rehearsal (#72), production funding SQL (#75), and persistent treasury wallet /
RealGateway integration (#79) were not integrated wholesale. Their remaining
requirements are covered by the release gates above and the current dormant
funding/mainnet documentation. No production enrollment, custody replacement,
selector activation or mainnet readiness follows from closing those drafts.

Core assembly is an internal composition seam rather than runtime provenance.
The closed factory validates the guarded connection before assembly and alone
issues private facade provenance. An ordinary or fabricated assembled core cannot
qualify as an enrolled runtime. The legacy adapter import graph must not pull in
the dormant funding engine or select the pinned runtime manifest.
