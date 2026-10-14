# Native public researcher profiles — source handoff, 2026-10-14

Base: reviewed Core477 `f2fa7d3ff82203e32e560adac73d6206910c1e48`.
This bounded worker authored only `lib/db/public-profiles-sqlite.ts`,
`lib/db/public-profiles-enrolled-sqlite.test.ts`, and this document. Execution,
independent review, checkpoints, PR and CI belong to the parent. ROOT owns facade
composition, the shared MAX4 schema/migration, claims/ownership/privacy, merge and
release. No module, test, compiler, database, provider, build, producer or Git
writer was executed by the worker. All executable gates below are **UNRUN**.

`createEnrolledSqlitePublicProfiles(db, privacy, identities, history?)` borrows the
same guarded native connection. Only exact mainnet Full19 with/without the public
reference archive receives a store. Exact source BEFORE with/without archive
returns `undefined`; partial/malformed/unknown bundles refuse without repair.
Missing required ports on Full19 refuse; optional history never manufactures
anonymous ownership. ROOT must provide genuine same-store native ports.

The private operation body is shared with the ordinary constructor. Its ordinary
authority/privacy guards, additive autoDDL, micro-USDC aggregate registration,
publication schema and SQL, session/revision checks, original comparisons, private
filtering and public projection remain intact. Native-only hooks add pre-SQL
readonly write policy, fixed positive FK/Full19 metadata, native runtime guard,
identity/file/fence/fullshape checks, and checks after awaited identity/ownership
reads. Unknown SQL/runtime/stored-data drift closes and permanently revokes the
borrowed capability. Exact native `ERR_SQLITE_ERROR` codes 5/6 can refuse a request
while retaining healthy readers only after owned rollback (if any), absence of an
outstanding transaction and fresh positive admission. No denied operation retry,
raw handle, function-registration port, caller guard or alternate financial sum is
introduced. Input validation remains separate from malformed stored data.

Target constructors execute no DDL. The existing ROOT profile generator remains
the source of the four profiles and is primed by trusted opening; it owns reference
schema generation. Neither native factory installs schema or opens another DB.
Ordinary source can be reconstructed exactly from the captured factoring inverse.

Publication remains default OFF: both existing explicit feature flags and actual
privacy admission are required at ROOT's facade. Constructing a store does not
select the feature. An explicit owner publication selects fields and run IDs; it
never changes run visibility/defaults, promotes a historical owner, inherits a
claim, changes a payer, creates an identity or mutates payment/custody originals.
Native actors must match the admitted network. Web/API retain the existing owner
editor/public projection. Desktop, CLI, remote/stdio MCP, extensions, A2A and bots
retain their existing public-link handoff and gain no private enumeration,
publication/signing tool or payment authority.

## Fixed native ledger dependency — UNRUN and unavailable

Core477's verified facade exposes `prepare`, `exec`, `isTransaction` and terminal
close. It deliberately refuses `aggregate`/`function` registration. Ordinary
`keryx_public_profile_micros` uses the existing `recordedMicros` decimal admission
and BigInt micro-USDC step; reproducing it with SQL floating sums, rounding,
truncation, a limited JS row window or a caller callback would change financial
truth. The worker has not done so.

The smallest proposed ROOT contract is a fixed trusted-opening installer for
**only** `keryx_public_profile_micros`, using the unchanged ordinary start/step and
`recordedMicros`, plus a metadata-only positive assertion that the sealed Full19
connection has that projection. Install on the underlying connection after source
admission and before sealing; expose no raw DB, aggregate selector, function name,
SQL or callback. Like the existing ROOT ownership-function contract, it installs
no schema/data and confers no writer/payment authority. ROOT owns its review,
implementation, runtime binding and actual acceptance. This is a dependency
proposal, not an implemented helper or an admission to call an absent aggregate.

Until that fixed contract is accepted and composed, native published `ledgers`
selection and reads of existing ledger selections refuse
`public_profile_unavailable`. Explicit non-ledger publication works through the
existing body. Unpublish and healthy readers remain usable after the dependency
refusal. The ordinary ledger body remains unchanged, including canonical positive
settled fetch/citation evidence, confirmation references, offline/treasury filters,
separate stored networks and exact nullable micro-USDC totals. Native settled-ledger
positive acceptance is **UNRUN**. No successful native totals are claimed.

## Parent composition and first validation recipe — all UNRUN

Read-only dependencies were inspected in separately owned worktrees, never copied
or edited by the worker:

- `cli-enrolled-private-profile260-production-20261014`: genuine native private profiles.
- `cli-native-profile-identities-20261014`: genuine native identities (no provider substitute).
- `root-native-claims-privacy-20261014`: genuine native claims, ownership and privacy,
  including fixed trusted-opening ownership functions.

The new fixture imports their canonical module paths. At this worker's Core477
checkout those exports/files are absent; compose their reviewed sources in the
parent-owned candidate before running or typechecking. Do not mock the factories,
replace the full-profile generator, skip tests or infer a passing type gate from
this source handoff. ROOT's default-OFF facade composition and original migration/
Full19 gates are separate and unchanged by these three source files.

First run on that admitted combined candidate, with its pinned supported Node/npm,
owned temporary fixture outputs and existing ambient-input isolation:

```text
npx vitest run lib/db/public-profiles-enrolled-sqlite.test.ts --maxWorkers=1
npx vitest run lib/db/public-profiles-sqlite.test.ts lib/profiles/public-profile.test.ts lib/profiles/public-profile-view.test.ts --maxWorkers=1
npx tsc --noEmit
```

Native fixtures use actual `node:sqlite`, source Full19 installation before
synthetic enrollment, real guarded opening, an actual pinned manifest and genuine
ports. Delayed wrappers await genuine results then interpose bounded peer changes;
they fabricate no owner, identity, settled sum, native error or guard result.
Authored coverage includes BEFORE/no-profile/unpublished/unknown-handle absence,
private/unlisted/historical/foreign filtering, selected public fields and sitemap,
owner/session refusal, revisions/tombstones, stale originals/profile/identity/
unpublish/privacy reads, genuine immutable receipt claims, default-OFF flags,
readonly refusal before runtime/SQL, target no-DDL/no-aggregate construction,
original/custody hashes, runtime/manifest/schema/fence/marker drift, actual file
replacement (or Windows held-file protection), FK deletion cascade and real busy
BEGIN/COMMIT rollback survival. Real native6 positive contention is not yet observed.

After the first source checks, parent independent auth/privacy/storage/financial
review and existing required aggregate/domain CI remain gates. Refresh changed
source evidence. ROOT then owns facade/surface/built-route/PostgreSQL/publication
acceptance and any one batched deployment. No activation, rollout, shared DDL,
credential, ENV, payment, spend, funding, scheduler or issue-closure evidence comes
from this worker handoff.
