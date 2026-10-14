# Bounded account membership implementation (#267)

This is an uncommitted NEXT-batch source outcome, not active account delivery or
original #267 closure. App64 remains independent. ROOT authorized this partition
after the accepted recorded design and different R42 design review. The exact
design was copied into this worktree (SHA256
`39fe3a415b92ee6c9b54bd4ca3080b95ca6d194e37e4c0a67ef0cb03854c8a0d`). The design
worktree's two dirty documents were preserved. Only an implementation paragraph
was appended to this worktree's current DECISIONS; its existing bytes were kept.

R42's recorded `19cdc07ee4a74019aa5e9512260b2c5199c6e59049e42ecce3c3e63beba0824f`
identifies its `final.md`, as the current coordination record confirms. The
specified `review-or-handoff/handoff.md` actually hashes to
`bc1c5343930ebc04527556d24cd3f64fa77cefe1e453d6227a430e280ad6767c` and records
scoped DESIGN ACCEPT. Implementation, CI, operational admission and delivery
were explicitly outside that acceptance.

## Implemented source

`lib/accounts/` contains the ordinary SQLite store, fixed personal-sign protocol,
service, request-local history projection, HTTP factory and synthetic failure
tests. The store takes a real existing `DatabaseSync` connection and never opens
a file, installs a schema, executes reference DDL, repairs tables or chooses an
alternate backend. Schema SQL is data for later reviewed migration/fixture use.
Admission compares exact bounded schema metadata, including the existing durable
web-session domain, indexes and triggers. Discovery folds identifier case for
domain names, enrolled markers and foreign-table trigger references to either
account tables or `web_sessions`; comparison still requires the exact canonical
shape. Trigger SQL over 16 KiB refuses, including references beyond the bounded
inspection prefix. Missing/altered domains, unknown domain triggers, enrolled
markers and excessive lock waits refuse.

An authenticated unbound Circle/SIWE wallet can explicitly prepare and confirm
private account creation and history consent. The account ID is server-random;
the committed first member has revision 1. Returning login offers only its own
current account/revision, then requires explicit account/history consent to bind
the exact durable login. It never exposes the other members before that binding.
No account profile fields are represented as saved by this increment.

Linking requires an active initiating account session and a fresh independently
controlled target EOA signature. The canonical message binds purpose, configured
origin/domain, network, account, canonical target, revision, new generation,
session commitment, consent digest, nonce and five-minute expiry. The server
reconstructs those bytes. Login IDs/tokens are absent from the signing message;
raw nonce/signature/provider tokens are absent from stored audit events. Wallet
case variants share one unique current membership. Zero addresses, provider
labels and client-selected account producers are inadmissible.

The durable nonce is consumed before target verification or completion-consent
validation, including refusal/invalid-signature attempts. An internal completion
lease never reaches HTTP. Final commit reacquires the write transaction and checks
the exact live durable session, original expiry, account revision and challenge
lineage. A replay, competing link, changed session/revision, expired proof or
uncertain acknowledgement never automatically retries or creates replacement
authority. Membership revisions advance once per committed change, remain stable
on reads and refuse safe-integer exhaustion. At most eight members are admitted.

Explicit unlink needs the current account/revision and target generation. It
requires no target cooperation, refuses removal of the last active wallet login,
revokes removed-wallet account sessions and consumes pending cohort challenges.
Relink allocates fresh lineage; pre-link durable logins cannot bind the new
credential. `login_after` is the strictly next whole second after completion,
including when completion is exactly on a whole-second boundary. The original
web-session issuer, issued time and expiry policy are unchanged. Removed-wallet
session tombstones cannot be resumed. Removing the
initiating wallet returns no remaining private cohort. Other sessions reload the
current revision; captured requests retain their old snapshot and fail their
final fence. Original wallet login rows and financial records are never rewritten.

The history producer is request-local and checks the exact consenting interactive
snapshot on every resolve. It must not be installed as shared `historyMembership`:
today's existing history-scoped keys could otherwise aggregate without consent.
All bearer presence is refused by the new HTTP factory before cookie authority.
There is no API-key account consent, membership mutation, claim ownership,
creator-role inheritance or account financial capability in this increment.
The read wrapper withholds output on account mutation, exact-session revocation,
abort or privacy-fence failure. It does not implement the existing reader's
ownership/erasure checks or serialize those separate privacy records by itself;
actual coupled privacy/session acceptance remains a parent integration gate.

The source UI at `/account` provides explicit create/resume/link/unlink choices,
exact signing-message display, bounded proof input, stale-state invalidation and
manual reload after uncertain results. It shows a capability error on the current
deployment. The actual route deliberately returns private/no-store `503` for GET
and POST; it performs no DB, auth, provider, credential or readiness probe.
This UI is **not usable account delivery** until its actual backend is wired.

Stored pending challenges are bounded to eight live challenges and 1024 retained
entries per initiating session and per account. Minimal audit events remain capped
at 1024 per account. Account-session admission instead caps **unrevoked bindings
with original expiry strictly after the transaction clock** at 1024 per account.
Revoked/expired bindings remain stored and do not consume this capacity; retained
session evidence can exceed 1024 rows. Every wallet and generation is counted,
including descendants that no longer match current membership or whose original
durable login is missing. Such rows conservatively occupy capacity until private
revocation or original expiry; this count is not a promise that every row can log in.
These counts use indexed limited subqueries. The live-proof
index includes consumed state and expiry. Credential cohort/alternative-login
queries use the account/wallet index; challenge cancellation uses an account-ID
expression index. Separate account/revocation/expiry and account/wallet/revocation/
expiry indexes bound session admission and unlink respectively. Unlink selects
at most 1025 unconsumed challenge IDs (including expired proofs) and 1025 unrevoked,
unexpired removed-wallet session IDs across **all generations**, refuses overflow
before mutations, and updates at most 1024 of each by primary key. Expired session
evidence remains unchanged. It never scans/parses unrelated retained challenges or
performs an unlimited synchronous account-lineage update. Exhaustion refuses
rather than deleting evidence. Challenge/event retention exhaustion can still
refuse membership operations; no pruning, account closure, retention maintenance
or backup revocation-generation capability is implemented or activated.

The existing private `expires_at` stores the exact original durable login expiry;
there is no additional deadline or renewal. Source-only constraints validate its
integer/lifetime range, and an account-session immutability trigger prevents
changing session identity, original issued/expiry times, member/credential
generations, account or consent binding. Once set, `revoked_at` cannot change or
clear. Resolution still compares original times to the authenticated exact
`web_sessions` row and current member/credential generation. A substituted durable
expiry cannot revive the private row. Membership revisions still refresh on a new
resolve and fence captured requests/final completion; no revision resets or
fresh credential generations arise from accounting. These are changes to the
uninstalled account schema **data**, not a schema installer, backfill, operational
admission or edit to the existing web-session schema/auth issuer.

## R58 P2 source repairs

R58 returned SOURCE_REVISE for incomplete case-insensitive schema discovery,
exact-second login eligibility and an unindexed/unbounded unlink scan. R59 repairs
those three defects in the existing store, schema-data, fixture and this document
only. The other eleven paths of the fifteen-path implementation overlay remain
byte-preserved. No architecture replacement, installer, caller or live endpoint
change is included; the endpoint still returns honest `503`.

New authored fixture cases cover foreign-table upper/mixed-case account and
durable-session writers, forbidden object/trigger/marker case variants, exact-second
pre-link/pre-relink refusal and next-second success without login/expiry rewrites.
The large-store case retains 128 unrelated account/credential/session lineages
and 4096 expired challenges, compares their rows after unlink, and checks query
plans for the actual SQL issued by that operation. Additional cases cover account
retention caps, oversized-lineage refusal before mutations, the eight-live-proof
cap and lost final-COMMIT acknowledgements both before and after persistence.
Existing proof-consumption, revision, max-eight members, cross-account, unlink,
privacy and custody assertions remain. Every new case is **UNRUN** in R59.

ROOT owns meaningful changed-source checks and independent review. R55's original
protocol worker `spawn EPERM` with zero tests executed is retained without any
runner retry; the earlier checkpoint typecheck does not accept this repaired
source. R59's source patch, full inverse, raw pins and handoff are under
`refill-successors-20261013-59/worker-repairAccountMembership267P2/review-or-handoff/`
in ROOT's retained release63 output. Schema SQL remains source data only. Frozen64
`ae298ff41c239b292a043b3442df33f1701a4b99`, original issues and all delivery gates
are unchanged; no version/publication/merge/deploy or release delay follows.

## R61 live-session capacity source repair

R61 confirmed the three R58 guards and found a new P2 in R59's cumulative
account-session count: normal resume/revoke or expiry could leave 1024 retained
dead bindings and permanently deny every fresh valid account login. R63 replaces
that lifetime sign-in cap with the bounded revocable-lineage accounting above.
It preserves schema case discovery, strictly-next-second login eligibility,
indexed pre-mutation cancellation, expired-proof consumption, immutable revision
and credential fences, old-generation/tombstone refusal and uncertain-COMMIT
behavior. The other eleven implementation paths, accepted design, complete
DECISIONS bytes and nine protected runtime paths remain byte-preserved.

The permanent-lockout fixture is replaced by reachable normal-operation recovery
cases for both revocation and exact-boundary expiry of all 1024 retained bindings.
A fresh exact durable login resumes with the same current credential generation;
all old rows, audit/challenge evidence and foreign accounts remain unchanged.
Separate cases refuse 1024 actually live bindings before any resume mutation and
recover one slot after exact revocation. Actual issued-query plan assertions cover
the indexed expiry range and bounded work. The large-store unlink case preserves
more than 1024 dead removed-wallet rows while cancelling live descendants across
current and old generations, plus pending expired challenges. Additional cases
refuse malformed/substituted expiry, issued time, member/credential generations,
stale resume revision and attempts to revive a tombstone or renew original expiry.

All R63 cases and plans are **UNRUN**. No test, compiler, module, app, DB/DDL or
alternate runner executed. R55's original protocol EPERM remains zero tests;
its exact result/stdout/stderr are retained with R63's raw before snapshots,
minimal repair/inverse, complete source/inverse and current pins under
`refill-successors-20261013-63/worker-repairAccount267LiveSessionCapacity/review-or-handoff/`
in ROOT's retained release63 output. Parent owns different changed-source review,
meaningful exact-source checks, coherent PR, required CI and the ROOT merge queue.
The private endpoint stays `503`; ordinary caller, Supabase, Circle signing/profile
and coupled private-history/privacy/custody/payment gates remain open. This NEXT
repair neither closes original #267 nor delays or changes frozen64/production.

## Actual port trace and smallest parent partition

At base HEAD `d799562d3edd94aec6512b6e857f7330061467d6`:

- `lib/db/index.ts:getDb()` initializes a selected real adapter. It is not a
  read-only account capability probe; initialization can install ordinary schema.
- `lib/db/sqlite-adapter.ts` owns its connection privately and has no account
  producer. `lib/db/keryx-db.ts` declares only the separate optional history
  consumer port. Supabase has no account transaction RPC/producer here.
- `lib/account-sessions.ts:accountSessionContext()` returns `{db,wallet,currentId}`
  only, after JWT and exact durable-row validation. `db.getWebSession(currentId)`
  provides the checked issued/expiry times without changing existing auth policy.
- Existing live session issuers are SIWE verify and Circle session. Circle prepare
  requests the existing user-controlled EOA initialization ceremony; its session
  route resolves the authenticated original wallet. No provider call was made.
- Circle signing retains wallet-equals-current-session. A different target Circle
  member still needs a reviewed independent signing context; this source never
  replaces the initiating login or relaxes that guard.
- Owned-history consumers already fence membership/cursors and row privacy, but
  attaching their current global producer would expand old key reads. Wallet
  profiles remain a separate store; they cannot serve account fields through aliases.

For the first ordinary SQLite backend, the parent needs the two owned caller
partitions `lib/db/keryx-db.ts` (optional account store contract) and
`lib/db/sqlite-adapter.ts` (nonenumerable assembly from its existing ordinary
connection, only after separately admitted exact schema). No schema installer or
financial/session caller needs to be widened. Then a new `lib/accounts/` request
adapter can compose `accountSessionContext`, the exact `getWebSession` row and
that actual capability, and replace the existing unavailable handler in this new
namespace. Use fixed configured origin/network, never request labels or Host as
authority. Preserve sealed/native/archive refusal before business IO. These
caller edits are prohibited to this worker and were not made or fabricated.

History integration additionally needs the existing HTTP/MCP/CLI caller owners to
keep wallet-only keys outside account mode, add per-exact-key consent if offered,
and bind the request-local projection plus current privacy/ownership/final-session
fences. Account profile validation/adoption and figures require their profile
owner's actual account domain, not profile/sync-state security storage. Supabase
needs equivalent real private bounded transactional RPCs and ACL/RLS failures;
there is no REST or SQLite fallback. These are distinct remaining implementation
partitions, not reasons to delay app64 or introduce a generic identity framework.

## Verification and source artifacts

The normal focused TypeScript checker passed at a source checkpoint using the
real installed declarations. Earlier resolver errors and their correction are
retained separately. The final expected-wallet/UI/zero-address edits are not
accepted by that checkpoint. Dependency qualification matched the complete
semantic lock graph and all 1710 installed metadata entries, on Node 24.21.0;
the donor was read-only. No dependency install or source runner policy changed.

The one-worker local proof-message Vitest command could not start its fork worker:
`spawn EPERM` (`errno -4048`, `syscall spawn`), exit 1, **zero tests executed**.
The owner's exact instruction was "ifnativewriter/checkdeniesstopretainit, no
alternateindex/runner/policy". All further native checks stopped. There was no
pool switch, in-process substitute, permission escalation or alternate index.
The final source requires parent checks. On-disk SQLite tests remain UNRUN:
their isolated fixture setup executes DDL, outside this task's operational scope.
No full suite, build, app, target, provider, ENV, key, readiness reader, actual DDL,
funding, payment, deployment, Git writer/PR or production operation ran.

Authored tests cover durable restart, bootstrap consent, target signature and
refusal, purpose/origin/network/session mismatch, replay, cross-account mixed-case
uniqueness, stale revision, eight-member bound, unlink/relink generations,
last credential, removed-session tombstones, exact expiry/revocation, overflow,
expired/absent challenges, schema/enrolled refusal, real SQLite lock contention,
secret-free audit, private read withholding and bearer refusal. These authored
cases are not execution evidence. Real independent review, native source checks,
isolated SQLite/PostgreSQL acceptance and required aggregate/domain CI remain.

ROOT's assigned `worker-implementAccountMembership267/review-or-handoff/` holds
the actual source patch, full inverse, per-file raw pins, protected before/after
pins and exact native-check outputs. HEAD/tree exclude the uncommitted overlay.
Natural CLI exit/signal and stdout/stderr EOF remain ROOT's lifetime capture;
this worker does not infer its own sourceLifetimeAccepted or fullEOF receipt.

## Original criteria and surface gates

| Original #267 criterion | Current status |
| --- | --- |
| Profile without holding a wallet beforehand | Existing Circle Google/EOA ceremony reused in the proposed caller; account membership source implemented. Actual stable account/profile and vendor/UI acceptance remain open. |
| Second-wallet session plus wallet-control proof | Durable protocol/store/service/UI source authored; actual SQLite failures, integration and independent review unaccepted. Different-target Circle signing ceremony remains separate. |
| Aggregate history/profile figures without pooling payment limits | Request-local membership projection authored, never globally attached. Actual consumer/key consent, account profile/figures and privacy races remain open. |
| Immediate unlink tested against stale sessions | Source controls and synthetic on-disk cases authored; actual tests remain UNRUN. |
| Custody/signing/grants preserved and payment-tested | Financial source paths unchanged. Existing payment regressions and cross-member negative execution remain open. |
| DECISIONS design before implementation | Exact accepted design retained; R42 design acceptance precedes this additive implementation paragraph. |

Web/hosted Desktop has the new unavailable private account view; native Desktop
custody/workspaces gain no capability. API has the new closed route/factory;
existing profile/history contracts remain wallet-only. CLI and remote/stdio MCP
retain existing key-only boundaries, with account consent and built distribution
acceptance still open. Extension/bots/OpenAI/A2A gain no producer or membership
from actor labels. All seven surfaces retain per-wallet financial authority.

ROOT owns different implementation review, final-source focused checks, a coherent
PR and required CI, then serialized merge only after real readiness. Selected-store
operational migration/admission, actual Circle ceremony and one NEXT-batch deploy
remain separate. Original #267 stays open; current457/460/461/463, bank, custody,
funding, schedules, Operator/private holds and App54 UNBOUND remain untouched.

## Actual API caller assembly after R69

R69 returned **SOURCE_ACCEPT only for R66's five-file caller/capability delta**.
Its full review and the R66 handoff are retained under ROOT's
`refill-successors-20261013-69/worker-reviewAccount267OrdinaryCaller/review-or-handoff/`
and `refill-successors-20261013-66/worker-implementAccount267OrdinaryCaller/review-or-handoff/`.
That acceptance does not cover this later route mount or its fixture. The earlier
closed-route descriptions above record the preceding partitions; this additive
caller replaces the GET/POST assembly in source only.

`app/api/account/membership/route.ts` captures the origin of `config.baseUrl`,
`config.networkId` and `config.jwtSecret`. Existing binding/session/wallet schemas
qualify that configuration and the canonical nonzero wallet. Before importing
the DB selector or calling `getDb()`, it refuses Authorization presence, mismatched
origin/path, query/hash, handler-method mismatch, missing/foreign POST Origin,
initial abort, duplicate/ambiguous/oversized cookies and invalid JWTs. It uses the
existing `parseWebSession` and `webSessionHash`; issuer, audience, roles, claims,
original lifetime and signing policy are unchanged. The small cookie preflight
matches the accepted adapter's bounds and unique-cookie rule. It grants no durable
or account authority and never replaces the adapter's authentication.

Expiry and abort are checked after awaited signature verification, after the DB
module import and after the selected-facade resolution, before the next resolver
or capability/data read. Only the actual facade returned by the existing application
`getDb()` owner path is supplied unchanged to `createOrdinaryAccountMembershipRoutes`
with the captured configuration. There is no raw connection, backend fallback,
provider-label selection or request-shaped facade. The genuine adapter still
revalidates the JWT and all four original durable fields; its captured store/core
retain exact-login, revocation, schema and current-lineage transaction fences.
The caller does not add cancellation/rollback after a POST mutation commits.

Missing/unqualified account ports and resolution failures remain private/no-store
503s. Ordinary initialization's **5000 ms** busy timeout still fails the account
factory's **at most 1000 ms** policy. This caller does not alter that timeout,
install an account namespace or admit selected-native/Supabase account storage.
The mounted source therefore establishes no usable ordinary/production capability,
activation, credentials, DDL, authentication authority or completed #267 delivery.

The new same-directory `route.test.ts` is **AUTHORED, UNRUN**. It mocks the selected
resolver/configuration and supplies a synthetic row-map/port fixture. Passthrough
spies observe the existing verifier/factory and inject awaited race conditions;
the existing JWT issuer/verifier and HTTP factory otherwise execute genuine code
when the parent runs it. Cases cover refusals before DB import/resolution, each awaited
expiry/abort boundary, exact facade/configuration passthrough, capability/outage
503s, durable equality, private headers, POST consent/wallet refusals and absence
of mutation/provider/spend calls. No connection, DDL or provider is used by that
fixture. It does not certify operational facade provenance or store freshness;
the accepted library fixtures remain their separate evidence. No execution result
or final typing is claimed here. Parent owns the tiny changed-route review,
focused route cases and exact-candidate final typing. All 25 other R69 source
pins, including the four parent-read account tests and their imported libraries,
are preserved; this assignment writes only the route, new fixture and this section.

Original wallet-free stable account/profile, actual multiwallet/different-target
signing, storage parity/readiness, per-key consent if offered, composed private
history/profile and privacy/ownership/erasure/session/cursor/unlink races, delivery
and cross-member custody/payment negatives remain open. Web/API now has this
source caller; hosted/native desktop, CLI, remote/stdio MCP, extension and bots
gain no account or financial authority. Frozen64, production and ROOT recovery
remain independent and untouched. Original #267 stays open.
