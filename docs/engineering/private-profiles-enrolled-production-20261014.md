# Same-store enrolled private profiles — October 14 source repair

Issue [260](https://github.com/tang-vu/keryx/issues/260) remains open pending
acceptance and live delivery. ROOT assigned this repair against
`76106089a78989d04aeb50f67a9d76241746d6f5` after the deployed app64 AE
`/me/profile` path returned 503: its selected enrolled SQLite facade omitted
`privateProfiles`. This source adds that optional domain to the same verified
mainnet-real store. All new tests, types, review, CI and rollout remain **UNRUN**
at the author's handoff. Production, main, versions and release64 are unchanged.

## Runtime and private authority

[`private-profiles-enrolled-sqlite.ts`](../../lib/db/private-profiles-enrolled-sqlite.ts)
accepts the existing verified connection provenance, with no raw connection
escape or configurable callback. The production factory supplies the same
selected connection and pinned runtime guard used by the core. The optional
port is frozen, non-enumerable and attached before the facade freezes. Its
methods are separate from the unchanged core/financial method inventory.

The factory performs no target DDL. Exact source schema references are built in
isolated memory by the existing schema-profile mechanism. Mainnet profiles are
archive absent/present × private profiles absent/present: four, preserving the
connection's existing maximum of four. Legacy/testnet profiles retain their old
shapes. Missing domain leaves the port absent and the existing route returns
honest 503. Partial/unknown schema refuses without repair or fallback.

Every operation validates verified provenance, runtime manifest, held target,
identity, exact fences and full admitted application/domain shape before and
after work. Mutations also check actual readonly provenance before any SQL,
including deletes for absent owners. Reads and writes use the existing native
transaction boundary. The port pins its initial application shape, checks both
implicit unique indexes, and excludes only exact independently verified fences
from the private table comparison. It avoids the ordinary `LIMIT 5` shape trap.
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
Public profile publication and personalHistory are separate domains. This repair
does not install them or grant financial authority.

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

The only new schema is exact `PRIVATE_PROFILES_SQL`, its two implicit indexes
and the three existing INSERT/UPDATE/DELETE writer-identity fences. Existing
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

## Acceptance and delivery still required

Native `ERR_SQLITE_ERROR` with exact `errcode` 5/6 refuses the affected request
without retiring a healthy shared connection. A failed BEGIN owns no transaction;
an acquired transaction requires successful guarded rollback. Guard, fence,
identity, file, manifest and unclassified internal failures still permanently
retire the old port, even if their inputs are restored before cleanup. This adds
no retry or timeout change. Three genuine held-lock regression cases are authored
and remain UNRUN until their focused parent validation.

The authored fixtures cover native migrated CRUD/full activity, actual readonly
refusal before SQL, two-owner isolation, unique-handle contention on separate
native worker connections, deletion preservation, manifest/file/fence/schema/
close drift, malformed activity and SQL failures. Migration fixtures cover both
archive variants, typed old rows/schema/backup equality, idempotence with rows,
middle-DDL rollback, unknown/partial schema and identity refusal, admission SQL
scope, stopped-writer/digest prerequisites, manifest drift and postcommit
acknowledgement uncertainty. All are **UNRUN** at this checkpoint.

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
