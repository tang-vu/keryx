# Same-store enrolled private profiles — October 14 source repair

Issue [260](https://github.com/tang-vu/keryx/issues/260) remains open pending
acceptance and live delivery. ROOT assigned this repair against
`76106089a78989d04aeb50f67a9d76241746d6f5` after the deployed app64 AE
`/me/profile` path returned 503: its selected enrolled SQLite facade omitted
`privateProfiles`. This source adds that optional domain to the same verified
mainnet-real store. All new tests, types, review, CI and rollout were **UNRUN**
at the original author's handoff. The PR480 correction and its pending validation
are recorded below; it makes no production, version or release acceptance claim.

## Runtime and private authority

[`private-profiles-enrolled-sqlite.ts`](../../lib/db/private-profiles-enrolled-sqlite.ts)
accepts the existing verified connection provenance, with no raw connection
escape or configurable callback. The production factory supplies the same
selected connection and pinned runtime guard used by the core. The optional
port is frozen, non-enumerable and attached before the facade freezes. Its
methods are separate from the unchanged core/financial method inventory.

The factory performs no target DDL. Exact source schema references are built in
isolated memory by the existing schema-profile mechanism. Mainnet profiles are
archive absent/present × the entire native user-metadata bundle absent/present:
four, preserving the connection's existing maximum of four. The initial private-only
after-shape was never deployed and is retired by the reviewed Core477 family.
Legacy/testnet profiles retain their old
shapes. Missing domain leaves the port absent and the existing route returns
honest 503. Partial/unknown schema refuses without repair or fallback.

Every operation validates verified provenance, runtime manifest, held target,
identity, exact fences and full admitted application/domain shape before and
after work. Mutations also check actual readonly provenance before any SQL,
including deletes for absent owners. Reads and writes use the existing native
transaction boundary. Constructor admission checks the exact application shape,
both implicit unique indexes, and excludes only exact independently verified
fences from the private table comparison. The genuine Core connection pins that
complete source-known shape at opening and rechecks it on every full guard.
It avoids the ordinary `LIMIT 5` shape trap.
Manifest/file/fence/schema drift or close invalidates retained ports; a failed
in-transaction guard closes the native connection, rolling back outstanding work.
A failure after commit returns unavailable and requires observation of the
accepted row before deciding a further action; it is never a retry promise.

Ordinary profile initialization retains its enrolled refusal and automatic
ordinary DDL. Shared helpers expose immutable activity SQL and a pure row decoder,
with no raw-DB constructor or guard callback. The same owner-bound activity SQL
reads full users/query_runs/query_memories/payment_events aggregates. Creator
counts still require selected network, positive fetch/citation amounts, settled
flag/status and a nonempty recorded transfer reference. Pending, prepared,
simulated, fee, anonymous, other-owner and other-network rows do not become
settled creator counts. Attribution does not prove who funded a payment.
Malformed/oversized projections and native SQL errors return unavailable.

Owner selection, SIWE revocation, explicit key scopes, same-origin cookie writes,
expected-wallet comparison, field validators and private/public separation are
the existing contracts. CRUD touches the owner's profile row only. Deletion
releases the handle while preserving account, research and financial originals.
Public profile publication and personalHistory remain separate capabilities. This
factory installs no domain and grants no financial authority; the shared explicit
Core477 migration installs the reviewed metadata bundle once.

## Explicit migration and compatible rollout

[`private-profiles-storage-migration.ts`](../../lib/db/private-profiles-storage-migration.ts)
uses the existing public-archive migration's bounded typed snapshots, including
raw TEXT bytes, rowids, integer/real/blob/null types and schema admission.
[`private-profile-storage-migrate.mts`](../../scripts/private-profile-storage-migrate.mts)
adapts the existing source-archive operator flow: protected held targets,
no-replace mode-600 backup and receipt, native backup readback, file/directory
fsync, exact manifest/identity rechecks, mandatory backup admission inside
`BEGIN EXCLUSIVE`, commit and positive postflight readback. It supports only the
two known mainnet source pairs, with the public archive absent or present.

The reviewed Core477 installer supplies the entire nineteen-table native metadata
bundle, including exact `PRIVATE_PROFILES_SQL`, its two implicit indexes and the
three existing INSERT/UPDATE/DELETE writer-identity fences. There is no independent
private-only rollout or historical privacy backfill. Existing
identity/provenance markers, old rows, old schema and economic policies are
compared and preserved. Backup admission normally permits only snapshot reads;
callback mutation also refuses on transaction, changes, schema and typed-snapshot
comparison. A middle-DDL failure rolls back the entire additive domain. An
already-current domain is preserved, including existing profile rows.

ROOT must actually stop every writer and hold the existing deployment lease
before invoking migration. `writersStopped:true` / `--writers-stopped` is an
assertion of established evidence; it neither discovers processes nor acquires
a lease. These are operator command forms for later accepted code, **not commands
executed by this author**:

```text
node --import tsx scripts/private-profile-storage-migrate.mts inspect --manifest <protected-manifest>
node --import tsx scripts/private-profile-storage-migrate.mts migrate --manifest <protected-manifest> --expected-manifest <digest> --expected-identity <digest> --backup <fresh-protected-backup> --receipt <fresh-protected-receipt> --writers-stopped
```

No automatic restore or evidence deletion follows failure. A failed postflight
or receipt acknowledgement after commit leaves a potentially migrated store,
protected backup and stopped writers. ROOT must resolve actual target/schema/
receipt state. Old actors accept the old exact shape, so ROOT must coordinate
the accepted compatible code and domain change in one stopped-writer rollout;
restarting old actors against the migrated schema is not supported.

## PR480 guard-cost correction — source only

Required Unit 3 job `115739922200` failed on published HEAD
`b79c9120a183a0ec001ec2e69b1018a894affd4e`: 4054 tests passed and two
unchanged 10-second tests timed out. They are the archive-absent native facade
CRUD/close case and the two-native-port handle collision, loser-field preservation
and released-handle case. Their assertions, deadlines and async behavior remain
unchanged. The retained raw failure log remains evidence of failed CI.

The local `schema()` scan used wrapped fence/profile/domain SQL, so each SQL
primitive invoked the complete Core guard again. This correction keeps the exact
existing constructor scan once, including healthy BEFORE absence, and requires
the genuine zero-SQL full19 connection policy only for a present mainnet port.
Repeated operation checks now use the retirement latch, that fixed policy and
one full verified-connection guard. Core still rechecks runtime/manifest, held
file, identity, exact fences and the exact captured source profile; wrapped
prepare/get/all/run/exec retain their full guard per SQL primitive. This is a
source-backed reduction in redundant guard calls, not measured production latency.

Readonly denial remains before SQL/full guards. Transaction, rollback, contention,
handle-conflict, owner/network/activity/economic and permanent-retirement behavior
is unchanged. A new regression checks that moving to another supported full19
archive shape refuses the old port permanently even after restoration, while a
fresh connection accepts the restored shape and originals remain intact.

The optimized source and new regression are **UNRUN** by this author; their first
focused validation and a different narrow reviewer remain pending with the
parent. The prior genuine 427-input/48-case artifact is retained but **STALE**
for this changed factory until the parent performs one genuine final-source
reproduction. Its historical 48 results do not establish acceptance of this
delta. The parent owns focused failed-case/refusal checks, types, changed-input
reproduction and one same-PR480 push; the sole coordinator owns merge and the
deployment batch. No timeout waiver, blind CI retry, producer run or live issue260
closure is claimed.

## Acceptance and delivery still required

Native `ERR_SQLITE_ERROR` with exact `errcode` 5/6 refuses the affected request
without retiring a healthy shared connection. A failed BEGIN owns no transaction;
an acquired transaction requires successful guarded rollback. Guard, fence,
identity, file, manifest and unclassified internal failures still permanently
retire the old port, even if their inputs are restored before cleanup. This adds
no retry or timeout change. Parent validation observed genuine writer contention
for update/delete and genuine EXCLUSIVE read-guard contention on the corrected
Core477 dependency. Numeric 6 remains an exact classifier branch rather than an
observed positive lock result.

The authored fixtures cover native migrated CRUD/full activity, actual readonly
refusal before SQL, two-owner isolation, unique-handle contention on separate
native worker connections, deletion preservation, manifest/file/fence/schema/
close drift, malformed activity and SQL failures. Migration fixtures cover both
archive variants, typed old rows/schema/backup equality, idempotence with rows,
middle-DDL rollback, unknown/partial schema and identity refusal, admission SQL
scope, stopped-writer/digest prerequisites, manifest drift and postcommit
acknowledgement uncertainty. Those execution gates were **UNRUN** at the original
author checkpoint. Parent retains matching successful focused scopes and the
failed captures, with the current Core477 exclusive case and focused types passing.
The changed one-table-DROP fixture must refuse partial full19; its old-port,
unchanged-byte and unavailable-route assertions are preserved. Shared full-bundle
migration acceptance comes from Core477, not the archived private-only fixtures.

ROOT carries focused Vitest acceptance for the two new suites and changed
enrolled facade suite, existing ordinary-profile and owner/auth/scope regressions,
app/ops TypeScript, independent storage/auth review and required PR aggregate/
domain CI. Existing unchanged UI/MCP/stdio fixtures can retain their qualified
evidence. ROOT then promptly publishes and merges the focused PR through the
existing queue; deployment alone is batched, with final-main release acceptance.

After the actual compatible migration/rollout, verify the real deployed owner's
SIWE GET/PUT/GET/DELETE, unchanged original/account/payment data, another owner's
isolation and handle collision, revoked credentials, wrong expected owner,
explicit read/write key scope separation, and remote/stdio key delivery. Check
no private fields appear in public/research responses. Synthetic owner closures
and fixture settlement rows are not live SIWE or settlement evidence.

Web/API and remote MCP already consume this port; CLI/stdio uses the same scoped
HTTPS endpoint, and desktop hands off to the hosted authenticated page. ROOT
verifies applicable package/installer/host provenance in the release batch.
Extensions, bots, OpenAI/A2A research, exports and receipts retain their research
roles and carry no new profile fields. Enrolled Supabase remains unsupported and
must not fall back to ordinary storage. No App54 execution, spend, activation,
credential/ENV change, independent version bump or production DDL occurred here.
