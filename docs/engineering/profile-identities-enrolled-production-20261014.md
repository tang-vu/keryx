# Same-store enrolled profile identities — source handoff, 2026-10-14

This increment supplies `createEnrolledSqliteProfileIdentities(db)` for the selected
native store. ROOT must attach its returned port after `privateProfiles` to resolve
the mounted VerifiedIdentityPanel LIST 503. It uses the existing identity contracts
and exact ordinary `PROFILE_IDENTITIES_SQL`; it does not install or migrate tables,
change the ordinary factory, select another database, or call an OAuth provider.

The initial increment adds four paths. The R91/P2 correction owns only the enrolled
factory, its test and this document; `profile-identities-storage-domain.ts` remains
byte-identical to its reviewed declaration. Base:
`5136a4a10a34230e1eceb6bac2f7a60b8252e9e5`. The parent owns first native execution,
review corrections to shared APIs/types, checkpoints, PR/required CI and ROOT merge.
ROOT alone owns the final four-profile bundle/facade/schema/migration and deployment.

## Admission and lifecycle

Admission requires the genuine WeakMap-known native connection, positive sealed FK
configuration, exact `private_profiles`, existing `web_sessions` plus its two indexes,
both exact identity tables/autoindexes, every existing writer fence, and a supported
full application schema. A whole admitted shape with neither identity table returns
an absent port. A partial, unknown or changed shape refuses; there is no repair or
independent feature-schema Boolean. Declaration rows are built from exact source SQL
without a constructor-created reference database. The shared full-profile inventory
must already be initialized by trusted composition before domain construction.

LIST uses `BEGIN`, bounded validated rows and an owner-specific read; pending rows
and asserted profile links cannot become verified labels. Each writer checks the
immutable readonly policy before parsing or any SQL. Writable calls run the full
guard, then `BEGIN IMMEDIATE` and check the owner/live durable session and exact
wallet/provider/session/state/deadline/current-nonce lineage inside the transaction.
Time comes from SQLite's millisecond clock, with no JS fixture clock or function
registration. Begin retains existing verification and replaces only current work;
consume is single use; complete cannot recreate an unlinked/deleted identity and
clears its current nonce. The existing provider/external-ID uniqueness constraint
preserves a collision loser's old verification. Unlink and profile deletion cascade
to pending/consumed challenges. Unlink has no session parameter in the existing
contract: its interactive SIWE/current-owner check remains in the unchanged route,
while its SQL deletion is bound to the normalized owner inside the transaction.

Schema, fences, identity, held-file, manifest/runtime guard and close failures latch
the port unavailable and close its genuine connection, including a first mutation
after drift. Restoring a file/schema does not revive that port. A routine readonly
writer refusal keeps the readonly reader usable. Domain errors after an intact
rollback retain ordinary conflict/expired/profile-required semantics.

R91/P2: only native `ERR_SQLITE_ERROR` with numeric `errcode` 5 or 6 qualifies as
contention. A failed BEGIN refuses that request without closing the shared
connection only after verifying no transaction remains and all runtime, shape,
fence, identity, file, manifest and FK guards still pass. An acquired transaction
requires a successful guarded rollback, no remaining transaction and the same
guards before retaining the port. Generic JS errors, caller flags, actual guard
failures and failed cleanup still revoke permanently. There is no retry, busy
timeout change or authority fallback; native busy timeout remains 5000 ms.
The existing external-ID collision mapping now requires native SQLite UNIQUE
error 2067 as well as the exact constraint message; a generic JS error with that
message cannot retain the capability.

## Exact shared prerequisites for the parent

1. Compose the reviewed R87/P2 private-profile port and its source helpers. This
   worktree's base has neither `private-profiles-enrolled-sqlite.ts` nor
   `assertVerifiedSqliteWritePolicy`. The profile dependency was read only at
   `D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-enrolled-private-profile260-production-20261014`;
   its observed HEAD was `76106089a78989d04aeb50f67a9d76241746d6f5`. The owner reports
   tiny P2 peer `749c` accepted; that report is not executed acceptance of this source.
2. Add the narrowly scoped **metadata-only**
   `assertVerifiedSqliteForeignKeys(db: DatabaseSync): void` to
   `storage-identity-connection.ts`. Require exactly one argument and a genuine
   connection record with a positive FK declaration. In trusted native opening,
   use `enableForeignKeyConstraints: true`, positively verify `foreign_keys === 1`
   before restricting SQL, and record that immutable fact only after sealing.
   No caller-controlled declaration or FK option, general PRAGMA accessor,
   raw-native handle, function/aggregate registration or authorizer escape is needed.
   The assertion itself must issue no SQL. Keep the full runtime guard separate.
3. ROOT adds both new tables to its reviewed common fence inventory, with the
   current identity writer fence for INSERT/UPDATE/DELETE on each. Retain the exact
   existing base schemas and cascade FKs. The declaration has no seed or DDL runner.
4. ROOT admits the **one complete user-domain bundle** in at most four fixed mainnet
   profiles (archive absent/present × whole bundle absent/present), initializes that
   trusted inventory before domain construction, performs one reviewed whole-bundle
   migration, and attaches `profileIdentities` as a nonenumerable own genuine port
   after `privateProfiles`. No profile-only migration can produce this final target.

The repository CI source pins Node `24.21.0`. The local Node SQLite type declaration
documents FK enablement's positive default. [Node's SQLite documentation](https://nodejs.org/api/sqlite.html#new-databasepath-options)
also documents that default and its configurable nature. This is documentation
evidence, not a runtime result: the exact pinned release documentation URL was
unavailable to the read tool. The authored tests require the pinned runtime's actual
default/configured behavior, positive genuine declaration, denied sealed PRAGMA and
both real cascades. No foreign-key guarantee is inferred merely from table presence.

## Verification remains UNRUN

No module, test, compiler, app, build, producer, database, migration/target, Git writer,
environment, provider, financial or production operation was executed by this author.
The new files intentionally require the shared prerequisites above before compilation
or native execution. Read-only source inspection and capture hashes are not acceptance.

The authored temporary suite uses **four fixed fixture profiles** and replaces only
the shared profile generator with that temporary inventory. Native connection
provenance, readonly metadata, FK declaration and guards remain genuine. It seeds
synthetic history before enrollment. It is explicitly not acceptance of ROOT's final
production bundle, migration, facade or owner-visible delivery.

The suite covers exact declarations; DB-clock challenge lifecycle; replacement and
single use across native connections; wrong wallet/state/provider/session/deadline;
held native writer refusal before BEGIN and reader-blocked COMMIT with intact
rollback, followed by continued LIST and shared profile/core reads; generic and
unclassified SQL-shaped errors, guard drift after contention and failed rollback
remain permanently revoked;
live revocation/wallet changes/shortened expiry; saved-profile requirements; expired
pending/consumed work; external-ID collision and rollback; actual readonly LIST and
pre-SQL denial of all mutations; asserted-link separation; both FK cascades;
preservation of other owners and old table rows; raw/ordinary/fake/callback rejection;
absent/partial/missing-profile/session drift; all six identity fences; schema/marker
drift, each first writer after drift, file/manifest/close revocation and non-revival;
and the existing identity GET route reading a nonenumerable genuine port without
provider I/O.

Next action: parent composes the shared dependencies, runs focused native/ordinary
identity and OAuth/session-route regressions plus required types/auth/storage review
and CI, then hands the accepted focused outcome to ROOT's serialized merge queue.
ROOT owns the full19/MAX4 common bundle, facade and global migration prerequisites.
ROOT verifies that final full bundle and actual selected-facade LIST, migrates/releases
the agreed batch once and verifies deployed owner-visible behavior. Live provider
acceptance, public-profile composition and original issue closure remain OPEN.

Web/API and desktop's mounted panel consume the same selected port; CLI and
remote/stdio MCP profile reads retain their existing scope gates. Extension/bot
authority, login, custody, payments, public publication and spending do not change.
Source presence or a fixture result alone cannot claim those surfaces delivered.
