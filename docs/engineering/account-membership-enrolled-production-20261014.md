# Enrolled account membership source partition — 2026-10-14

This partition adds `createEnrolledSqliteAccountMembership` beside the ordinary
constructor in `lib/accounts/sqlite-store.ts`. The current correction also changes
`lib/accounts/enrolled-sqlite-store.test.ts`, this document, the optional account
attachment in `lib/db/enrolled-sqlite-adapter.ts`, and the exact account-store
profile edge in `lib/operator/gateway-funding-composition.test.ts`. Original base
is `f816d5e0f8c006569a68a0b81f7cbc7f269a71de`; this source-only correction starts
at `915af0ec6f984cd7bb01b367d45cb538d1098fba`. Its actual R104 validation is recorded
below. R114 focused types passed on its pinned source; its measured MAX8 case
still failed. The R116 synthetic population transaction correction is uncommitted
and **UNRUN**; it is not installed capability or completed #267 delivery.

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

Full19 AFTER constructor admission still requires ROOT's fixed positive native policy helper,
the entire nineteen-table family, exact existing six account tables and
web_sessions (including their indexes and immutability triggers), and all identity
fences. Only the three exact verified identity fences for each of those seven
tables are excluded from the account shape comparison. No target DDL, file open,
repair, backfill or fallback occurs in the native constructor or journal. The
genuine constructor fixes `busy_timeout=5000` before restricting SQL; its
authorizer forbids later PRAGMA reads/changes to that policy. The ordinary limit
is not raised and no raw SQL escape is added. Constructor-only fence, full19 and
account/session catalog admission runs once. Present-store hot checks use the
private refused latch, the existing zero-SQL native-domain/FK metadata assertions,
and exactly one full `assertVerifiedSqliteConnection`. That core guard still pins
the exact admitted profile, identity, held file, manifest and fences. Every wrapped
SQL primitive retains its unchanged full guard; no new policy or cache is added.

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
successful rollback/no-active-transaction and a valid full guard. A failed BEGIN
under a competing writer stays usable only when that cleanup inspection succeeds;
an EXCLUSIVE lock that prevents inspection stays permanently latched. Cleanup failure,
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

At the R95 handoff, the worktree base lacked those ROOT exports and native family
data. ROOT subsequently composed the dependency before the first real controls;
the current source contains it. This worker changes no ROOT helper, policy, schema
or migration. No ordinary-only result accepts the new native store. ROOT's current
additive partition attaches the truthy frozen account store as a nonenumerable,
nonwritable, nonconfigurable property before freezing the selected mainnet facade.
Exact BEFORE leaves the property absent on the same healthy facade. No other port,
core assembly, constructor, financial wrapper or default configuration changes.
The graph permit adds only `lib/accounts/sqlite-store.ts` to
`lib/db/enrolled-sqlite-schema-profile.ts`; funding, enrollment and other selector
rules remain in force. Authentication, profile, bibliography, identity, privacy
and global inventory sources remain outside this partition.

## Authored genuine fixtures and remaining acceptance

The original 45 genuine controls actually ran **28 PASS / 17 FAIL**. Sixteen failed
under the unchanged 15/20-second bounds; one failed on actual Windows `EBUSY` during
the held-file rename. The exact result and raw stdout/stderr remain in
`output/resume-distribution63-audit-20261012/native-account267-first-real-controls-20261014/`.
The `60a8` guard-amplification assessment is static source evidence, not latency
proof: the old hot check reaches 13 full guards and healthy transactions reach
57 plus business SQL. This correction reaches one hot guard and nine plus business
SQL without changing those primitive guards. No milliseconds or corrected pass
result is inferred. The original result is not relabeled or overwritten.

At the R104 source handoff, correction tests were **AUTHORED, UNRUN**; the subsequent
actual selective result is recorded below. They provision disposable source-generated
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

The fixture makes one actual rename attempt with all held handles intact. On
Windows it requires actual `EBUSY` prevention, unchanged original path/bytes/file
identity/schema and the same healthy guarded account store. It does not close a
handle, copy a substitute, retry or claim revocation when substitution was prevented.
On platforms permitting substitution, the original replacement and permanent
refusal after restoration remain. Added coverage observes the actual hot-guard
count, EXCLUSIVE cleanup refusal, selected-facade exact BEFORE absence in both
archive profiles, frozen hidden readonly account reads with pre-SQL write denial,
and permanent facade retirement after restored manifest failure. Original economic
snapshots and existing failure bodies remain intact. No corrected platform,
execution or compiler result is claimed. Existing ordinary test files remain unchanged.

The parent owns focused genuine native and unchanged ordinary tests, final typing,
a different security review, coherent PR and required aggregate/domain CI. ROOT
then owns prompt serialized merge and one deployment for the accepted batch.
No tests, compiler, modules, DB, build, provider, ENV/credentials, activation,
spend, producer, Git writer, PR or target operation ran in this worker. No denial
retry occurred. Raw before/after pins, byte snapshots, minimal patch, full inverse
and handoff were retained in ROOT's assigned round93 worker output directory.
The bounded R95 correction, its frozen before/after raw files, minimal patch and
complete inverse are retained in the assigned round96
`worker-repairNativeAccountOptionalBefore` output. The current five-file raw
before/after, minimal patch, whole inverse, pins and body-preservation record are
retained under round104 `worker-completeNativeAccountGuardAndFacade`. Parent owns
a different small review, selective failed-risk controls at the original deadlines,
ordinary focused validation, current-source types and graph/facade checks, then
the focused PR and required CI. New R114 correction acceptance checks remain **UNRUN**.

## R104 actual failure and R114 bounded diagnostics

ROOT's first changed validation at HEAD
`915af0ec6f984cd7bb01b367d45cb538d1098fba` selected 23 native cases: **18 PASS / 5
timeouts**, with 28 prior passes reused, over 394.044 seconds. The actual reports,
raw streams, capture receipts and `failure-handoff.json` remain in
`output/resume-root-release63-20261012/native-account267-r104-first-changed-validation-20261014/`.
Each capture observed natural exit/close and both EOFs, without an outer timeout.
The compiler reported TS7034 at old line 430 and two TS7005 uses at old line 441.
R114 changes only that array declaration to
`const proofs: Awaited<ReturnType<typeof other.service.prepareLink>>[] = [];`.
The existing `other` scope, eight-iteration issuance loop, proof payloads and result
assertions remain. This is a source correction, not a claimed compiler pass.

The graph case also failed its unchanged 20-second deadline (actual case duration
22.9140967 seconds). No failing selector-edge assertion appeared in its retained
stderr; that does not establish graph acceptance. It remains open and unchanged.
Runtime account source SHA256 `da1d8fcaa80c4e6fcffe923d9878b2078d010ffb9433ea40ab4f0918e52db580`,
facade `3dd11be8127c91d83d0fe0da14182882474c88f1e0c4db07eb60259ea78560d5`,
and graph test `4264af6b3c57a83cc17fec6b5da6e4696f4e67d3cc8cae737639444014b42703`
are immutable in this revision; their independent source review is retained.

The following counts trace the complete existing bodies statically. They are
service/journal transaction **entries**, including refusals, not measured SQL,
successful BEGIN/COMMIT totals or latency. Internal journal projections and the
core guard's own transactions are not additional entries in these counts.
`bootstrap` contributes one read and three writes (resolve, issue, take, complete).
Each genuine `link` contributes three reads and three writes (fresh resolve,
prepare's resolve and required-current resolve, issue, take, complete), plus actual
target EOA signing/verification. A standalone `prepareLink` contributes two reads
and one write even when issue refuses.

| Remaining journey | Actual R104 case duration / deadline | Static entries and fixture work |
| --- | --- | --- |
| Unlink revocation, dead evidence and last credential | 21.6006572s / 20s | 12 reads, 15 writes; one bootstrap, two genuine links, one pending proof, two resume attempts and five expected refusals |
| Oversized retained unlink challenges | 23.4774284s / 20s | 7 reads, 8 writes; one bootstrap, one genuine link, one pending proof, 1025 synthetic challenge INSERTs, unlink refusal and fresh resolve |
| Oversized retained unlink sessions | 22.9917943s / 20s | 7 reads, 8 writes; same ceremonies, 1025 synthetic session INSERTs, unlink refusal and fresh resolve |
| MAX8, live challenges, retained challenges/events | 94.1043846s / 20s | 49 reads, 44 writes; three bootstraps, seven genuine links, eight genuine live proofs, three prepare refusals and final event-cap completion refusal |
| EXCLUSIVE cleanup refusal | 18.2771748s / 15s | Three read entries, three writes, including bootstrap; one locked resolve and one already-latched resolve; one real blocker BEGIN EXCLUSIVE/ROLLBACK |

Unlink retains four genuine issued nonces, four take attempts and three completion
calls across bootstrap, initial link, pending proof and relink. After the first
link it obtains a fresh durable login and consenting resume, captures the removed
session, then unlinks. It still checks revision/member count, revoked session
bytes/immutable expiry, stale snapshot refusal, consumed pending nonce and replay
refusal, fresh initiating-wallet resolution, last-credential refusal with the
whole retained journal unchanged, a new linked generation and rejection of the
old session. The credential login-after inspection/wait and two durable session
INSERTs remain. None of these ceremonies is replaced by seeded link authority.

Each oversized case retains three genuine issued nonces, two take/completion
pairs and its genuine link. In R114 the 1025-iteration fixture loop used a separate
synthetic setup connection and performed individual INSERTs without an explicit
batch transaction. The challenge branch retains the actual pending challenge's
payload/expiry; the session branch retains live old-generation rows. Two whole
journal snapshots bracket the refusal, the SQL observer still forbids any
INSERT/UPDATE/DELETE from unlink, and a fresh native resolve checks the unchanged
membership. Static INSERT counts cannot attribute the observed duration to those
inserts or to preparation.

MAX8 stays one case with all three independent fixtures. Seven real EOA links
fill the first account before its ninth-wallet prepare refusal. The second
account genuinely issues eight live proofs before the ninth live-proof refusal.
There are 19 `prepareLink` attempts overall: seven link preparations, the full
account refusal, eight live issuances, live/retained-cap refusals and the event
proof. Together with three create challenges, 19 nonces are genuinely issued;
there are 11 take and 11 complete calls, including the final refused completion.
Retention setup still consumes the eight live proofs with one UPDATE and inserts
1016 retained copies (`i = 8; i < 1024`); including the consumed create challenge,
that fixture retains 1025 challenges. The third fixture takes its genuine event
proof, then adds 1023 event copies to its existing create event for 1024 events.
All six retained snapshots and their three refusal comparisons remain. No
population bound, nonce/lease/revision check or no-resurrection assertion is split
away or replaced with synthetic positive proof.

EXCLUSIVE cleanup still locks the actual file with all genuine handles intact.
The wrapped `isTransaction` read runs a full core guard; its failure can reach a
second guarded `isTransaction` read during mandatory cleanup inspection. Both
paths retain the fixed 5000 ms policy. That reachable source path is not a claim
about which waits occurred in R104. ROLLBACK remains in `finally`; post-release
resolve, verified-connection refusal and exact retained-journal equality still
assert permanent retirement. No retry, pre-release unlock or healthy-reader
fallback is introduced.

These counts do not prove unrelated repeated preparation dominates, so R114 makes
no synthetic preparation substitution. It adds `[native-account267-phase]`
checkpoints only to these five failed bodies for the parent's **one changed
observation**. Fixed public journey/phase labels report rounded interval and
cumulative milliseconds, with at most 11 unlink, eight per oversized case, 13
MAX8 and six EXCLUSIVE lines (46 total). There are no per-row/per-SQL logs, data
values, wallets, nonces, paths or timer changes. Boundaries distinguish bootstrap,
genuine links/live issuance, fresh login/resume, population, snapshots/refusals
and exclusive acquisition/cleanup/release. Intervals include intervening assertions;
beforeEach/afterEach and module loading remain outside these phase intervals.
These were unobserved diagnostics when R114 was authored; the parent's subsequent
single MAX8 observation is recorded below. All five case failures and graph
failure remain open at their original 15/20-second bounds.

R114 edits only this document and `lib/accounts/enrolled-sqlite-store.test.ts`.
Protocol, consent, durable sessions, generations/revisions, retained evidence,
no-inherited-payer boundaries, readonly denial, uncertain-COMMIT controls and
financial-original hashes remain asserted. No module, test, compiler, DB, build,
producer, browser, Git writer, provider, target or operational action ran here.
The prior 28 and R104 18 source-bound passes are retained without claiming that
they accept this new revision. ROOT owns the changed observation, focused types,
unresolved graph acceptance, required PR/CI and serialized merge/release. At that
handoff new checks were **UNRUN**; the later R114 types result below applies only
to its pinned source. #267 and product/surface acceptance remain open. R114 before/
after files, hashes and incremental patch are retained only in the assigned
`output/resume-root-release63-20261012/refill-successors-20261013-114/worker-repairNativeAccountTypesAndBoundedFixtures/`.

## Measured R114 result and R116 synthetic population correction

ROOT's actual `native-account267-r114-max8-phase-types-20261014/failure-handoff.json`
and `actual-result.json` record one MAX8 case at 92.1023324 seconds, failing its
unchanged 20-second deadline: 0 PASS / 1 FAIL / 50 SKIP. The outer capture naturally
exited 1 after 100.397 seconds with full stdout/stderr EOF and no forced timeout.
Focused types actually passed in 19.556 seconds on R114's unchanged pins, including
the explicit `Awaited<ReturnType<typeof other.service.prepareLink>>[]` annotation.
That compiler pass is retained source-scoped evidence, not acceptance of R116.

The measured retained-challenge and retained-event population phases took
10.830 + 10.628 = **21.458 seconds**. Seven genuine links took 34.405 seconds;
eight genuine proof issuances took 16.418 seconds. These phase intervals include
intervening assertions, so they do not attribute costs to individual SQL calls.
Even subtracting the entire 21.458-second population interval leaves about
70.644 seconds arithmetically; this is not a measured new runtime or evidence
that batching can satisfy the 20-second deadline.

R116 changes only this document and the test file. A separate
`syntheticPopulationTransaction` wrapper uses the existing disposable raw setup
actor, explicit `BEGIN IMMEDIATE`/`COMMIT`, rollback on actual failure while a
transaction remains active, and the existing `edit` helper's `finally` closure.
Only three existing bulk callbacks use it: the 1025 oversized challenge/session
loop, the retained-challenge UPDATE plus 1016 copies, and the 1023 event copies.
Every loop count, payload, expiry, amount and refusal comparison is unchanged;
the common `edit`, session setup and other fixture cases are unchanged. This
does not alter native guard/fences, journal/store/service, genuine EOA signing,
consent, nonce/revision/generation rules, MAX8/eight-live/1024 limits, positive
ceremonies, no-resurrection or no-inherited-payer checks, or original financial
and whole-journal comparisons. MAX8 remains one aggregate case at 20 seconds.

One new synchronous control writes two synthetic sessions, then triggers an
actual SQLite duplicate-key failure. It asserts exact retained-journal rollback,
unchanged financial-original hash, actual BEGIN/ROLLBACK calls with no COMMIT,
and closure of the raw setup connection.
At the R116 source handoff, the control, changed fixture checks and changed-source
types were **UNRUN**. ROOT subsequently completed the three affected controls and
focused types on unchanged source pins; the actual results are recorded below.
ROOT owns a tiny independent peer review, selective oversized/rollback and
committed-population checks, and the remaining runtime-phase assessment without
splitting/skipping MAX8 or raising timers. Other four timeout cases, graph,
original #267, genuine product/surface acceptance and required PR/CI remain open;
the sole coordinator owns merge/release. No timing improvement or issue closure
is claimed. Raw before/after files, incremental forward/full inverse patches and
pins are retained only in the assigned
`output/resume-root-release63-20261012/refill-successors-20261013-116/worker-completeAccountSyntheticPopulationTransactions/`.

The source now connects the account journal to the existing selected mainnet
SQLite facade. Web/API's private account flow, hosted/native desktop, CLI,
remote/stdio MCP, extension and bot delivery remain parent acceptance work.
Actual wallet-free stable account/profile, multiwallet owner history,
different-target signing/custody negatives and composed privacy/session/history
acceptance remain open until delivered through their genuine surfaces. Original #267 stays open;
App54 UNBOUND, private holds, spending limits and the existing production release
remain unchanged.

## R120 exact ceremony trace and remaining owned dependency

The R116 independent source review at
`output/resume-release-library-review-20261012/native-account267-r116-population-independent-source-review-20261014.json`
(SHA256 `3e2ce67b3bc8e7a53d2463fd44e657f9721f0cf58ef8b3aec6c8ca21e359ea7f`)
accepted only the synthetic population correction. The actual
`output/resume-distribution63-audit-20261012/native-account-r116-three-population-controls-20261014/actual-result.json`
records **3 PASS / 0 FAIL / 49 SKIP**, natural exit 0, both EOFs and unchanged pins.
The rollback control took 0.3517686 seconds, oversized challenges 12.6743151
seconds, and oversized sessions 12.9166928 seconds; the outer capture took
34.429 seconds. `types-result.json` records actual focused types PASS in
21.020 seconds, natural exit 0 and both EOFs. The two 1025-row population intervals
were 112 and 81 ms. These accept the selected R116 controls, not MAX8, unlink
revocation, EXCLUSIVE cleanup or the graph case. MAX8 was not selected or rerun.

R120 inspected HEAD `915af0ec6f984cd7bb01b367d45cb538d1098fba` with account runtime
`da1d8fcaa80c4e6fcffe923d9878b2078d010ffb9433ea40ab4f0918e52db580` and test
`0601ac7f31e82bd014582b7af1121957e7f6552d9f4b21f973eefc7301cd7876`, matching
R116's accepted runtime/test pins. It changes documentation only. The ordinary
constructor, shared journal, native transaction/cleanup/SQL observer, service,
fixture bodies, facade and graph source remain byte-identical. No new timing,
test, compiler, module, DB, producer, Git writer or operational result is claimed.

The reachable chain is `enrolled-sqlite-store.test.ts:link` ->
`service.ts:prepare/required/completeLink` -> `sqlite-store.ts:accountMembershipJournal`
-> the native `transaction` and private SQL observer ->
`storage-identity-connection.ts:wrapped/guardStatement/assert`. The fixture's fresh
resolve, prepare's initial resolve and required-current resolve are three separate
read transactions. Issue, take and complete are three write transactions. Take
commits nonce consumption before awaited EOA verification; complete rechecks the
durable challenge, initiating session, membership revision and capacity after that
await. Reusing an earlier service snapshot would change those decision inputs.

For a healthy native transaction, the fixed overhead is **nine full core guards**:
`isTransaction`, four `check()` calls, BEGIN, clock prepare/get, and COMMIT. Each
business SQL prepare and each get/all/run adds its own full core guard. These
are source counts, not observed SQL timings. An authenticated resolve has seven
business statements: exact web session, account session, initiating member,
initiating credential, account row, full member rows and full credential rows.
The cohort credential read also checks cardinality, generations, login times and
active credentials; it is not replaceable by the initiating credential row.

| Successful path | Business statement executions | Full core guards |
| --- | ---: | ---: |
| Unbound resolve | 2 | 13 |
| Bound resolve | 7 | 23 |
| Create issue / take / complete | 7 / 4 / 20 | 23 / 17 / 49 |
| Link issue / take / complete | 13 / 10 / 23 | 35 / 29 / 55 |
| Bootstrap: one read, three writes | 33 | 102 |
| Genuine fixture link: three reads, three writes | 67 | 188 |
| Standalone prepareLink: two reads, one write | 27 | 81 |

Consequently seven successful links reach **1,316** guards and eight successful
proof issuances **648**. The intact MAX8 body reaches 49 read and 44 write entries,
914 business statement executions and **2,669** full guards on its intended
successful/refusal branches. That last count uses nine fixed guards for 89 healthy
transactions and ten for four semantic refusals inside transactions: full-account
issue, live-cap issue, retained-cap issue and event-cap completion. The ten include
the existing guarded rollback and cleanup inspections. A refused event completion
executes its existing writes before the event cap check, then rolls them back.
These totals exclude connection opening/admission, raw population/snapshots,
financial hashes, fixture provisioning, EOA signing/verification and test hooks.
They are not a profiler result or attribution of the measured 70.644-second
arithmetic remainder.

Each core `assert()` calls the runtime callback, verifies the held file twice,
reads and compares the exact identity, regenerates/checks all fences, and compares
the exact opening application profile. With funding tables absent its healthy
source path executes eight internal statements: two identity reads, funding-table
presence, application-table inventory, exact fence match, exact marker match, and
profile size/shape reads. A present complete funding bundle adds its own exact
schema match. Thus the above MAX8 path reaches **21,352 internal statement
executions with funding absent**, plus any funding matches; this count excludes
the core guard's own BEGIN/COMMIT and application statements. The repeated fence
and marker matches enter `sqlite-schema-match.ts:sqliteSchemaMatches`, whose
current materialized expected relation uses a correlated `sqlite_schema` lookup
for each expected name/type. The account policy helper is already metadata-only;
replacing it with another zero-SQL helper removes none of this work. Source proves
this repeated path, not which matcher, file check or profile step dominates latency.

Unlink's `current()` reaches the same seven-statement resolve. The pending proof
and live session reads must both finish and enforce the original 1024 limits
before any mutation; its per-row revocation/cancellation statements retain their
individual guards. The remaining revocation/relink/last-credential journey still
has two genuine links, a genuine pending proof, fresh-login/resume and stale/dead
refusals. R116 already accepted the two oversized branches; no replay of them is
needed for this documentation-only revision.

EXCLUSIVE refusal reaches two potentially blocking core inspections: the first
guarded `db.isTransaction` before account BEGIN, then the catch body's guarded
`db.isTransaction` before cleanup qualification. The first core guard's own
transaction rolls back after its failed identity read; the second inspection can
fail under the still-held lock and permanently latch the port. Each retains the
fixed 5000 ms connection policy. This is a reachable wait path, not proof that
R104 experienced exactly two five-second waits. Skipping the cleanup inspection
would change an explicitly frozen accepted body; releasing the blocker earlier
would remove the tested failure. Neither was changed.

No justified native-only implementation within the immutable bodies materially
addresses the measured gap. Removing duplicated live/session projections would
require changing the shared journal or substituting a native projection with a
separate semantic proof. Suppressing SQL through the private proxy would elide
required primitive guards. No such patch, cache, new batch API or deadline change
was authored. The smallest concrete external dependency is the existing
`lib/db/sqlite-schema-match.ts` matcher, owned by the core storage partition:
evaluate the same exact expected-name/type/SQL predicate against the schema
without a repeated correlated lookup, retaining every caller and full guard.
Its equivalence and actual cost need core-owner evidence before claiming a fix;
this identifies a bounded dependency, not an accepted replacement or speedup.

ROOT retains the original MAX8 aggregate at 20 seconds, unlink at 20 seconds,
EXCLUSIVE cleanup at 15 seconds and unresolved graph acceptance. A meaningful
runtime correction must precede changed-source peer review and parent controls;
no same-source MAX8 repeat is requested. Required coherent PR/aggregate/domain CI
and sole-coordinator merge remain open. Current65, release/main/version, holds,
payment/registry/payTo authority and all production state remain untouched.
R120 raw before/after files, minimal documentation patch, complete inverse, pins
and remaining criteria are retained only under
`output/resume-root-release63-20261012/refill-successors-20261013-120/worker-completeNativeAccountMeasuredCeremonyGap/`.


## Native journal correction after current-helper measurement

The later current-helper MAX8 observation still failed its original 20-second
limit: the case finished in 44.926 seconds with explicit timeout, natural exit 1
and both EOFs. Seven genuine EOA links took 21.550 seconds and eight live proof
preparations took 10.200 seconds; retained setup took only 82 and 73 milliseconds.
That result supersedes no earlier failure and does not qualify performance.

The native constructor now retains private guarded prepared statements, not
rows, authorization decisions or guard results. Each get/all/run still invokes
the genuine connection's full runtime guard and the original SQL-failure observer.
The native read strategy executes bounded live/session/member/credential and
membership projections afresh inside the existing owned transaction. Independent
member and credential arrays each preserve wallet ordering and LIMIT 9; an extra
or missing credential cannot disappear through a join. Original validation of
session times, wallet, revocation, binding, consent, generations, revision,
credential uniqueness and active state remains mandatory before returning data.

The ordinary constructor/schema checks, three ordinary read function bodies and
all journal mutation/proof/consent/limit method bodies remain unchanged. Their
private read strategy defaults to those ordinary functions. Only the native
constructor selects the fixed same-file strategy; callers gain no callback,
configuration, raw statement, row cache or new authority. Native transaction,
readonly-before-SQL, checks, rollback and uncertainty/permanent-latch bodies are
unchanged. Cached statement objects are discarded when the native port retires.

The hot-guard assertion now expects nine full guards on a warmed resolve: four
explicit checks, transaction state/BEGIN/COMMIT, current-clock execution and the
single current fused read. This is a static/executable guard-count requirement,
not a measured latency claim. New genuine controls check repeated reads after a
durable session change and an independent extra credential. The swallowed-take
failure control injects drift after the actual consumed-marker execution, rather
than depending on a now-reused prepare call; its rollback, refusal and permanent
retirement assertions remain. All MAX8, eight-live, 1024, EOA, nonce, financial,
20-second and 15-second controls are preserved. These changes are UNRUN pending
different-source review and the owner's proportionate affected checks/types.


The first different review found a concrete P2 before execution: SQLite 3.53.4
can decode a valid JSONB BLOB in json_object, so a BLOB session origin could
become a matching JavaScript string although the original raw-row comparison
refused it. The retained initial source/review are not accepted runtime evidence.
The successor checks each projected SQLite storage class with CASE before JSON
construction. Unexpected types become explicit invalid markers, including array
entries; no row is filtered, cast or silently treated as optional absence. Every
text/integer/nullable integer field in the native projection is covered. A genuine
jsonb(origin) BLOB regression proves raw inequality and decoded string equality,
requires native refusal and then healthy admission only after TEXT restoration.
This successor remains UNRUN pending its different changed-block review.


The first corrected-source run passed focused types (18.971 seconds) and 21
meaningful controls, including JSONB refusal, current row rechecks, independent
credential completeness, readonly policy, all selected drift/uncertainty classes,
unlink, MAX8 and the graph. The complete original MAX8 case passed in 19.105
seconds at its unchanged 20-second limit; unlink passed in 6.171 seconds. This
is individual measured acceptance, not a general latency or Linux CI claim.

One case still failed: EXCLUSIVE cleanup took 16.572 seconds at its original
15-second limit. One bounded fixed-enum observation retained that failure and
recorded exactly nine primitive events: two actual marker reads returned native
BUSY5 after 7.463 and 7.470 seconds, each followed by a zero-millisecond Core
rollback; close took six milliseconds. Thus configured busy_timeout=5000 is
not an observed five-second wall-clock guarantee on this Windows runtime.
No timeout, SQL authority, lock or guard was changed for that observation.

The successor permanently retires the port when the initial full guarded
transaction-state inspection itself fails. No account BEGIN has been reached;
state and authority are unknown, so the code neither reuses the connection nor
pretends an account rollback succeeded. It avoids another blocking inspection
whose only purpose would be to try keeping that uncertain capability alive.
After a successful initial inspection, the complete existing BEGIN contention,
owned rollback, full cleanup guard and healthy-recovery path is unchanged.
Readonly policy remains before all SQL, and no guard result is cached to grant
success. Temporary primitive instrumentation was removed by exact raw inverse;
the original EXCLUSIVE assertions and 15-second limit remain byte-identical.
The proposed BEGIN IMMEDIATE spy was removed: this readonly resolve uses BEGIN,
so that assertion was vacuous. Only EXCLUSIVE, genuine BEGIN contention and relevant types need refresh;
the other accepted controls are retained. This successor is UNRUN at handoff.


The final entry-state successor passed focused types in 20.242 seconds and both
meaningful lock classes with natural exit 0 and both EOFs (27.329 seconds total).
The original EXCLUSIVE class kept its 15-second limit; genuine post-entry BEGIN
contention still refused once and recovered the same healthy store after unlock.
The prior 21 passing controls, including original MAX8 at 19.105/20 seconds and
the genuine JSONB refusal, remain scoped evidence for the unchanged paths;
only the initial unknown-state retirement branch changed and received the two
fresh controls. No unchanged native suite, model/provider trial or build ran.
The final different source review is `4d328eb5`; the initial JSONB P2, both failed
EXCLUSIVE captures and temporary diagnostic source/inverse remain retained.
Current-main composition, applicable canonical provenance, required exact-head
hosted CI, merge and deployment still remain separate pending delivery steps.

The candidate now includes actual main `5213bdf6`, retaining its complete Decision,
Core, profile, bibliography, identity and Usage source. The facade adds only the
previously reviewed Account import and hidden port; no migration or flag changed.
One existing canonical study completed naturally in 11.325 seconds: all 48 offline
trials and every field except the two changed runtime source hashes match the
incoming main artifact. All 431 physical source hashes match, with zero outbound
attempts. Required exact-head hosted CI, coordinator merge and the next deployment
batch remain pending; this record does not claim production Account activation.

Exact-head PR489's first Linux unit run passed 3,733 tests but failed the existing
combined MAX8/retention case at its unchanged 10-second limit. Its retained phases
show seven genuine links at 4.650 seconds and eight live proofs at 2.848 seconds;
the full journey still exceeded the Linux bound. No authority assertion failed.
The native transaction successor removes three redundant explicit full scans:
each is followed by a genuine guarded BEGIN, clock read or COMMIT. Positive
metadata policy is checked at entry; every primitive still checks the full pinned
domain/profile, identity, file, manifest and fences. The final post-COMMIT full
check and complete failure/cleanup paths remain. New genuine fault controls
change the runtime guard after actual BEGIN or the final fused read and require
the next guarded primitive to refuse, permanently retire and preserve originals.
This correction is UNRUN pending different source review; all original deadlines,
MAX8/eight-live/retention assertions and ordinary journal bodies are retained.

The three-scan successor passed different source review `83363d89`, focused types
in 20.032 seconds, and all nine affected native controls in 56.142 seconds with
natural exit 0 and both EOFs. Both new boundary faults reached their real SQL
hooks and permanently refused after restoration. EXCLUSIVE passed in 8.981 seconds
and BEGIN contention in 8.168 seconds at their unchanged 15-second limits. The
full MAX8 case passed on Windows in 17.331 seconds at 20 seconds; this does not
qualify the unresolved Linux 10-second gate. Required refreshed exact-head CI
will determine Linux acceptance; the original failure remains retained.
