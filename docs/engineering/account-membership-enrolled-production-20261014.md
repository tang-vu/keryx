# Enrolled account membership source partition — 2026-10-14

This partition adds `createEnrolledSqliteAccountMembership` beside the ordinary
constructor in `lib/accounts/sqlite-store.ts`. It changes only that file, the new
`lib/accounts/enrolled-sqlite-store.test.ts`, and this document. Base is
`f816d5e0f8c006569a68a0b81f7cbc7f269a71de`. It is an uncommitted, unrun source
handoff; it is not installed capability or completed #267 delivery.

## Authority and preserved journal

The exported native constructor accepts exactly one genuine connection registered
by `openVerifiedSqliteStorage`. Raw databases, forwarding proxies, extra arguments,
callbacks and caller mode flags cannot qualify. The journal is factored into a
private same-file function. Ordinary admission still rejects the identity marker
and requires `busy_timeout <= 1000`; its `BEGIN IMMEDIATE` transaction body stays
unchanged. Every membership SQL statement, consent/protocol check, revision and
generation comparison, durable session equality, retention limit and action body
is retained. Only offer, resolve and assertCurrent select the private read lane;
the ordinary transaction ignores that private selection and keeps its old behavior.

The native constructor returns `AccountMembershipStore | undefined`. General
admission first qualifies genuine positive FK metadata, then checks mainnet-real
identity, the actual runtime/file/manifest guard and identity fences. When all
nineteen native domains are absent, only an exact supported BEFORE profile
(archive absent or present) returns `undefined`, preserving the same healthy
connection for the facade. The existing whole-schema matcher and authoritative
mainnet profile helper compare the schema after excluding only verified identity
objects; unknown or partial shapes never become optional absence. The source
profile helper owns its existing lazy reference generation; no new generator or
caller-supplied profile authority is introduced here.

Full19 AFTER admission still requires ROOT's fixed positive native policy helper,
the entire nineteen-table family, exact existing six account tables and
web_sessions (including their indexes and immutability triggers), and all identity
fences. Only the three exact verified identity fences for each of those seven
tables are excluded from the account shape comparison. No target DDL, file open,
repair, backfill or fallback occurs in the native constructor or journal. The
genuine constructor fixes `busy_timeout=5000` before restricting SQL; its
authorizer forbids later PRAGMA reads/changes to that policy. The ordinary limit
is not raised and no raw SQL escape is added.

Offer/resolve/assertCurrent use genuine read transactions. Resume/issue/take/
complete/unlink/revokeSession retain atomic immediate write transactions. The
readonly write policy reads genuine private metadata before request SQL or runtime
guard execution; refused writes do not retire a healthy reader. Foreign/raw
constructor arguments are never closed. Once genuine metadata qualifies,
construction failures and later native non-contention guard/SQL failures
permanently latch the port and retire its borrowed
connection. Restoring a file, manifest, identity, schema or runtime guard cannot
revive it. The private SQL observer catches failures inside take's intentionally
swallowed invalid-proof projection; that operation cannot report fallback success
or commit a consumed marker after such a failure.

Only exact `ERR_SQLITE_ERROR` with numeric errcode 5/6 can follow the contention
path. It returns account_unavailable without retiring the connection only after
successful rollback/no-active-transaction and a valid full guard. Cleanup failure,
uncertain COMMIT acknowledgement and other errors retire admitted authority. There
is no automatic retry, expiry extension or nonce recreation. Account semantic
refusals preserve a healthy connection after valid cleanup. No wallet membership
confers payer, signer, API-key, custody, spending, creator or claim authority.

The existing 300000 ms challenge, consent digest, durable current-wallet/hash/
issued/expiry equality, origin/network binding, account revision, membership and
credential generations, single consumption/lease, MAX8 and retention bounds remain
the sources of account authority. Unlink still bounds pending challenge and live
session work before mutations, cancels old live generations, preserves expired
evidence and refuses removing the last credential. History projection remains
request-local and requires current private-history consent plus the existing
privacy/ownership fences. Wallet-free entry still depends on the existing
authenticated Circle account ceremony; this store never creates or inherits one.

## Reviewed ROOT dependency and optional BEFORE correction

R95 requested only the supported BEFORE absence correction. Reviewed Core477
`f2fa7d3ff82203e32e560adac73d6206910c1e48` was inspected read-only via `git show`.
It supplies full19/four-family/MAX4 migration, genuine immutable FK/write policy
and `assertVerifiedSqliteNativeUserDomainPolicy(db: DatabaseSync): void`.
The latter remains a fixed zero-SQL positive assertion of genuine source-known
full19 admission, FK and 5000 ms timeout; it continues refusing BEFORE, partial,
foreign and closed policy. The optional BEFORE branch uses general admission and
exact source-profile comparison before that assertion. All failures still throw
`account_unavailable`; there is no catch-to-`undefined`. Qualified genuine
construction failures retire their connection, and raw/foreign arguments are
never closed.

This worktree's base still lacks those ROOT exports and native family data. No
ROOT helper, policy, schema or migration was changed or composed by this worker.
ROOT must compose the reviewed core before the first native/ordinary/type checks.
No ordinary-only result accepts the new native store. The selected verified
facade still needs its separately owned nonenumerable accountMembership assembly,
including healthy optional BEFORE absence. This worker does not change facade,
authentication, profile, bibliography, identity, privacy or global inventory files.

## Authored genuine fixtures and remaining acceptance

All new tests are **AUTHORED, UNRUN**. They provision disposable source-generated
mainnet-shaped SQLite files, install genuine full19 tables/fences, and open them
through the actual verified constructor. No WeakMap or native factory is mocked.
The only method instrumentation observes actual transaction calls or injects a
lost acknowledgement/internal guard failure while retaining genuine SQL and
connection provenance. Fixture provisioning invokes existing source-profile
generation explicitly; fixtures supply no substitute factory or policy helper.

Cases cover both archive profiles; positive FK and forbidden policy changes;
raw/foreign/extra authority refusal; absent full-native policy; exact optional
BEFORE with the same healthy connection; partial family, unknown trigger, BEFORE
fence/manifest failures and restoration refusal without repair;
consent/create/link/resolve/reopen/resume; actual EOA proof failure and
nonce replay; substituted durable rows and revoked sessions; canonical binding,
consent, session commitment, TTL, expired proofs and leases; stale snapshots and
final completion; fenced private history; unlink/relink/last credential; immutable
session expiry and revocation; MAX8, eight live challenges, retained proof/event
caps and live-vs-dead session capacity; old generations, foreign same-file account
evidence and oversized unlink refusal; genuine readonly read transactions and
pre-SQL write denial; actual native fixed-timeout lock contention; permanent guard/
schema/identity/file refusal and swallowed branch failure; and uncertain final
COMMIT both before and after persistence. Every case hashes all existing original
application tables outside the native family/web_sessions before and after, with
nonempty synthetic order/payment/authorization originals. These rows are explicitly
synthetic and establish no real settlement or funding.

File replacement uses a real pathname replacement with the original held handle;
if Windows denies that rename, retain the exact parent platform result rather
than substituting a mocked guard pass. No platform, execution or compiler result
is claimed. Existing ordinary test files remain unchanged.

The parent owns focused genuine native and unchanged ordinary tests, final typing,
a different security review, coherent PR and required aggregate/domain CI. ROOT
then owns prompt serialized merge and one deployment for the accepted batch.
No tests, compiler, modules, DB, build, provider, ENV/credentials, activation,
spend, producer, Git writer, PR or target operation ran in this worker. No denial
retry occurred. Raw before/after pins, byte snapshots, minimal patch, full inverse
and handoff were retained in ROOT's assigned round93 worker output directory.
The bounded R95 correction, its frozen before/after raw files, minimal patch and
complete inverse are retained in the assigned round96
`worker-repairNativeAccountOptionalBefore` output. First native, ordinary, final
types and genuine facade checks remain parent **UNRUN** gates.

Web/API's private account flow, hosted/native desktop, CLI, remote/stdio MCP,
extension and bots gain no selected producer from this source partition. Actual
wallet-free stable account/profile, multiwallet owner history, different-target
signing/custody negatives and composed privacy/session/history acceptance remain
open until delivered through their genuine surfaces. Original #267 stays open;
App54 UNBOUND, private holds, spending limits and the existing production release
remain unchanged.
