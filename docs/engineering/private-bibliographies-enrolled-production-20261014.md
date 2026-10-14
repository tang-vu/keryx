# Same-store native private bibliography source — 2026-10-14

This four-file outcome adds `createEnrolledSqlitePrivateBibliographies(db)` for
internal composition on the already selected verified SQLite connection. It is
source preparation awaiting parent checks and ROOT's complete native-user-domain
bundle. No production migration, facade attachment, feature activation, issue
closure, publication or delivery is established by this document.

## Admission and lifetime

The factory requires the reviewed profile R87/P2 WeakMap APIs:
`assertVerifiedSqliteConnection(db)` and `assertVerifiedSqliteWritePolicy(db)` in
`lib/db/storage-identity-connection.ts`. They are missing from base
`5136a4a10a34230e1eceb6bac2f7a60b8252e9e5`. The factory has exactly one argument;
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

## ROOT integration prerequisites

1. Adopt the reviewed profile connection API/source dependency coherently; do not
   invent a local guard shim or treat base 5136 as compiling this outcome.
2. Add `private_bibliographies` to the shared storage table inventory. Its three
   fence definitions must come from the current `storageFenceStatements` authority.
   This is needed even for the scoped fixture's first native checks.
3. Compose `PRIVATE_BIBLIOGRAPHIES_STORAGE_DOMAIN` into ROOT's ONE fixed complete
   bundle target and migration. It imports the exact existing SQL and exposes
   deeply frozen schema/fence descriptors. It neither installs SQL nor generates
   another Boolean production schema family. No seed is required for this domain.
4. Replace the profile-only target with the complete bundle in the shared profile
   owner. Keep exactly four production mainnet profiles: archive absent/present
   crossed with entire bundle absent/present. Do not admit arbitrary partial subsets.
5. Attach the optional non-enumerable `privateBibliographies` port using the same
   selected native connection. Verify genuine facade and existing mounted callers;
   the scoped fixture does not establish final bundle/facade acceptance.
6. Parent carries first native tests, TypeScript, review, checkpoint and required
   PR CI. ROOT serializes merge and the one batched migration/delivery after final
   main acceptance. Original issues remain open until deployed owner-visible
   criteria pass. No independent deploy, production CLI or activation is added.

No additional immutable helper extraction is required for this outcome. The
existing schema constant, contracts and formatter are imported directly. The
private ordinary helper logic for hash/snapshot/metadata is reproduced locally
with the same contract; the ordinary factory and its enrollment refusal stay intact.

## Authored acceptance fixtures; not executed by this author

`private-bibliographies-enrolled-sqlite.test.ts` builds four fixed, scoped reference
profiles for this isolated domain (archive absent/present, bibliography absent/
present). Only the supported source-profile list is substituted in the test;
provenance/WeakMap policy, manifest/file/identity checks and fence generation/
validation are genuine. The fixtures are not a production family or a final-bundle
proof. Historical synthetic economic/original rows are seeded before enrollment.

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

Tests, imports/module execution, compiler, build, app, producers, DB/DDL/target
operations, Git writes, ENV, providers and financial calls were prohibited for this
source author and were not run. Read-only source/status/hash inspection is not a
test pass. Parent must resolve the explicit missing dependencies before first checks.

The original R89 capture retains its additive patches and deletion inverses. The
R92 correction capture records raw before/after source, the minimum correction
patch and whole-file restoration inverses, old-authority byte equality, and exact
next actions in `source-handoff.md`. Shared instructions, facade, schema, inventory,
migration, ordinary factory, auth, financial code and foreign worktrees stay owned
by their existing coordinators.
