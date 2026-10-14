# Same-store native private bibliography source — 2026-10-14

This outcome adds `createEnrolledSqlitePrivateBibliographies(db)` for internal
composition on the already selected verified SQLite connection. The reviewed
helper source is committed at `1ca0c6bf91b46721270ce45c816611cbd5f70285`.
Core477 is merged on `origin/main` at
`b54710b0585e5398070e8da87092a72ce856ceed`; the pending local merge parent is
its reviewed source commit `f2fa7d3ff82203e32e560adac73d6206910c1e48`.
The profile260 merge and ROOT-owned facade binding remain necessary before this
becomes a coherent feature candidate. No production migration, activation, issue
closure, publication or delivery is established by this document.

## Admission and lifetime

The factory requires the reviewed profile R87/P2 WeakMap APIs:
`assertVerifiedSqliteConnection(db)` and `assertVerifiedSqliteWritePolicy(db)` in
`lib/db/storage-identity-connection.ts`. They were missing from the original base
`5136a4a10a34230e1eceb6bac2f7a60b8252e9e5` and are present in Core477's
current local composition. The factory has exactly one argument;
raw/ordinary connections, extra arguments and supplied callbacks cannot issue
this native port. There is no connection registration or raw capability escape.

Construction validates without target DDL or seed. The entire application schema
must match `supportedSqliteApplicationProfiles`, excluding only the separately
verified identity marker and exact shared fences. The domain must match the
existing `PRIVATE_BIBLIOGRAPHIES_SQL` table and both implicit unique indexes. Its
INSERT, UPDATE and DELETE identity fences must each match the shared authority.
Only an exactly supported absent domain returns `undefined`. Partial, foreign,
unknown or inexact shapes refuse without repair.

Each operation checks the admitted full profile and genuine native identity,
fences, held-file and runtime manifest guard before/inside/after its transaction.
A guard failure latches the port revoked and closes its native connection. Schema,
fence, identity, manifest or file restoration cannot revive the old port. A new
verified connection and constructor are required. Drift before a writable call
is checked before input parsing. A pre-commit guard failure rolls back through the
transaction or connection close. A failed post-commit check is an uncertain write:
the row may already have committed, the old connection stays revoked, and no
successful acknowledgement or automatic retry is produced.

Actual readonly connections permit owner `list` and token `read`. All mutations
first call the metadata-only WeakMap write-policy API, refusing before SQL while
keeping healthy readonly readers usable. A native SQL failure on an otherwise
intact connection is reusable only for an `Error` with native `ERR_SQLITE_ERROR`
and numeric `errcode` 5 (BUSY) or 6 (LOCKED), after successful rollback if a
transaction was acquired and intact guard checks. Only explicit not-found,
conflict and limit domain refusals retain their original errors after cleanup.
Every other transaction error immediately revokes and closes the connection,
including a guarded prepare/exec refusal whose manifest restores before cleanup.
Unavailable, malformed stored metadata and arbitrary JavaScript errors do not
qualify as contention. There is no automatic retry or deadline change.

## Existing product contract

The unchanged bibliography contract and exact BibTeX formatter remain authoritative:

- Owner wallets normalize to lowercase. Owner lists expose only ID, title,
  reference count, revision and timestamps; token hashes and content stay private.
- Creation returns a random 32-byte token once. Only the existing domain-separated
  SHA-256 hash (`keryx-private-bib-v1:`) persists. A token deliberately grants
  bearer read access to that one metadata snapshot, without a wallet selector.
- Replace preserves the token, ID and creation timestamp. Revoke deletes the row
  and invalidates the token. Missing bearer reads return `null`.
- The existing twenty-per-owner, fifty-paper, content-byte and signed-int revision
  caps remain. Immediate write transactions serialize cap/CAS/revoke decisions;
  updates and deletes additionally bind owner, ID and revision in their SQL.
- Reference exports contain the existing metadata provenance and stable exact-link
  keys, excluding owner titles, research history and private workspace fields.

The existing session-only management routes retain same-origin, live interactive
session, expected-owner and quoted `If-Match` preconditions. Historical API keys
gain no private management authority. Existing deliberate bearer downloads retain
their fixed filename and privacy/cache/referrer headers. No auth or route file is
changed here. The new port writes only `private_bibliographies`.

## Remaining composition and publication gates

Core477 supplies the genuine connection APIs, shared table/fence inventory,
complete native-user-domain bundle and migration, and the fixed four mainnet
profiles: archive absent/present crossed with the entire bundle absent/present.
The immutable declarative descriptor from the helper commit still imports the
exact ordinary SQL. Partial subsets remain inadmissible; this outcome adds no
separate installer, production profile family or bibliography seed.

1. Compose current accepted `origin/main` with Core477's complete native bundle.
   Profile260's separate factory is not a runtime dependency of this helper.
2. ROOT has bound the optional non-enumerable `privateBibliographies` port to the
   same selected native connection in `lib/db/enrolled-sqlite-adapter.ts`.
   The focused controls establish genuine writable/readonly facade CRUD; live
   mounted and delivered acceptance remains a release gate.
3. Refresh relevant failed cases and changed-input checks, reusing applicable
   unchanged helper review and native/type evidence. Any new composition delta
   needs independent review, and required aggregate/domain CI must actually pass.
4. Only after dependency and facade composition is final, run the existing
   offline48 study once on that input source. Retain its actual zero outbound
   result and precise source/lock binding. The current archived study omits this
   helper from its runtime-source graph and cannot accept this feature.
5. Publish one conventional focused outcome PR. ROOT serializes the merge and
   owns final-main acceptance and the one combined deployment. Original deployed
   owner-visible criteria remain open. Broader #285, Zotero account linking and
   sync acceptance are not established by this bibliography increment.

Web/API session management and deliberate bearer downloads use the existing
optional database port. Desktop, CLI, remote/stdio MCP, extension and bots retain
their established metadata/export or web handoff roles; they gain no private
enumeration or management authority. Deployment and package/installer acceptance
belong to ROOT's release batch.

No additional immutable helper extraction is required for this outcome. The
existing schema constant, contracts and formatter are imported directly. The
private ordinary helper logic for hash/snapshot/metadata is reproduced locally
with the same contract; the ordinary factory and its enrollment refusal stay intact.

## Actual retained native results

`private-bibliographies-enrolled-sqlite.test.ts` now uses Core477's actual fixed
four-profile full19 family without a profile mock. Historical synthetic originals
precede explicit bundle installation and enrollment; the corrected A2A original
carries the required network in `request_data`. There is no privacy backfill.

The original first native invocation at
`output/resume-distribution63-audit-20261012/first-core-native-checks-20261014/bibliography`
exited 1 with 0 passes and 36 failures in 10,092 ms. The corrected invocation at
`output/resume-distribution63-audit-20261012/native-first-dependency-recovery-20261014/bibseed`
exited 1 with 28 passes and 8 failures in 740,518 ms. Both captures observed natural
exit/close, complete stdout/stderr and no outer timeout or overflow. Neither is
a passing suite.

The five corrected-run raw SHA-256 pins bind that historical invocation, not
the later ROOT correction and current-main composition. Its helper pin was
`035962fd8e054e9c8e2e24f03e1bcedb452b6a4b58ec77e8cf93b25eff24eb7b`;
the corrected test pin was
`1267aca886a1e59676ed6eeb867ddf5f64ae7d0a4d4278b536ccbb0aa33bbe7e`.
The accepted R94 source review covers the R91/P2 helper correction; it does not
accept the later fixture composition or replace actual required CI.

Eight failures cover CRUD with both archive variants, malformed inputs,
two-connection CAS/revoke/caps, foreign fence/deleted domain, held BUSY at BEGIN
and COMMIT, and session management/bearer routes. Recorded durations range from
20,558.886 to 132,506.410 ms under unchanged 20,000 ms test/hook deadlines.
JSON failure messages contain `STACK_TRACE_ERROR`; the retained capture alone
does not establish a more specific cause. Retain these failures and timing
qualifiers until actual refreshed checks resolve them; preserve assertions and
deadlines.

The authored cases cover native CRUD and routes, owner isolation, token hashing/
revocation and metadata privacy, actual readonly pre-SQL refusal with healthy reads,
malformed input/token/revision and oversized content, two-connection CAS/revoke/caps,
maximum revision, absent/partial/foreign/full schema, all three domain fences,
write-first manifest/identity/schema/fence drift and permanent refusal after restore,
file substitution or OS prevention, close/raw/ordinary refusal, rollback on guard/
SQL failure, and original schema plus all original/economic typed-byte preservation.
The R91/P2 correction adds real within-transaction prepare/exec manifest refusals
after an actual UPDATE, restoring the manifest before the error reaches cleanup;
all old methods must stay revoked and a fresh connection must see the old snapshot.
Injected arbitrary/non-contention/nonnumeric/nonnative SQL errors must also revoke.
Held competing verified connections force genuine native BUSY failures both before
BEGIN acquires a transaction and at COMMIT after mutation. An observational exec
spy records the actual `ERR_SQLITE_ERROR`/numeric errcode 5 and acquired-transaction
rollback. After lock release the same intact port must read the unchanged snapshot
and accept a different owner's new write. No native error or guard is fabricated
by these held-lock fixtures, and existing deadlines remain unchanged.
Concurrent port calls use two genuine connections in one process. Additional
workers import the real verified connection module and use exact owner/revision
UPDATE/DELETE CAS through a shared start barrier. They assert one SQL winner;
the barrier does not guarantee overlapping lock attempts. The new held-lock cases
exercise refusal/recovery through the complete domain port. Final bundle/facade
contention acceptance remains ROOT-owned; numeric LOCKED (6) is classified in
source but is not established by the BUSY fixtures.

The original source author did not run tests, modules, compiler, build, app,
producers or target operations under its source-only assignment. Parent native
invocations above are subsequent evidence with their failures retained. No new
compiler/build/study pass is claimed by this documentation refresh.

The original R89 capture retains its additive patches and deletion inverses. The
R92 correction capture records raw before/after source, the minimum correction
patch and whole-file restoration inverses, old-authority byte equality, and exact
next actions in `source-handoff.md`. Shared instructions, facade, schema, inventory,
migration, ordinary factory, auth, financial code and foreign worktrees stay owned
by their existing coordinators.

## ROOT delegated native correction, October 14

The observed CRUD path repeatedly scanned the complete schema through a connection
that already guards every SQL operation. Constructor admission and genuine BEFORE
absence remain unchanged. Present ports now require the existing full user-domain
policy captured at opening; each subsequent check uses that metadata and one full
connection guard. SQL proxy guards, journals, transaction boundaries and readonly
pre-SQL denial remain intact. Exact native 5/6 guard contention becomes a privately
branded fixed bibliography refusal; arbitrary failures still retire the port.
Rollback or uncertain transaction cleanup retains its permanent refusal rules.

The genuine frozen facade now attaches an optional, non-enumerable native
`privateBibliographies` port. Its one legitimate closed-schema import edge is
explicit in the existing graph assertion; all negative/funding checks remain.
New controls cover missing captured full policy, actual EXCLUSIVE contention and
healthy recovery, and writable/readonly facade CRUD with original typed bytes.
Prior failures remain retained; refreshed checks must establish acceptance using
the existing deadlines before publication. This enables no provider, funding,
custody or scheduling operation; the coordinator owns the batched release.

The delegated focused run passed 22 controls, including all eight previously
failed classes and the new native policy, EXCLUSIVE and facade cases; 17 unchanged
cases were skipped. It exited naturally 0 with both EOFs in 152,331 ms. Focused
types passed naturally 0 in 20,455 ms. The one changed graph case initially hit
the unchanged 20-second deadline; one unchanged verbose diagnostic then passed
that case with 11 skips in 7,212 ms. Both captures remain retained. These results
do not claim full hosted CI, production activation or live issue acceptance.
