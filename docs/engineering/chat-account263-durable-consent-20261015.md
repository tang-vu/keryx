# Original #263 durable chat consent — source plan, 2026-10-15

Status: source authoring only; no execution, activation or original acceptance.

Design before code: verified provider routes alone construct immutable recipient
envelopes. Telegram requires a genuine sender DM; Slack uses the signed workspace,
sender and channel with an ephemeral reply; Discord uses the signed application,
authoritative member-or-DM sender and ephemeral interaction. Arguments are never
echoed, stored, logged or treated as research. Invalid/private-channel refusals
precede database access. The reserved parser assertions remain intact.

Issue a random 256-bit, five-minute, purpose/domain/network/recipient-bound token.
Only SHA-256 digest and bound metadata persist. Deliver the credential in the URL
fragment; the client removes the fragment immediately and posts it in a bounded
same-origin body only after sign-in, membership resolution and explicit consent.
No automatic completion, query credential, referrer propagation or takeover.
SQLite BEGIN IMMEDIATE serializes single-use consumption, link creation, unlink,
and pending-token invalidation. A second account must wait for the original unlink.

Account authority is existing cookie JWT + exact durable web session + current
account267 session/member/credential lineage, rechecked inside the linking
transaction. The consenting wallet selects existing history only; it grants no
payment, custody, signing, budget or account-membership authority. Future runs use
that explicit linked owner with treasury funding retained. Existing closed run
provenance cannot represent linked-account; keep method unknown rather than label
it session/payer. Past-run exact-list attachment is unavailable: historical
rate-limit IDs are not retained ownership provenance. Do not infer a list.

Threat controls: token theft is a private bearer risk until expiry; private replies,
fragment handling, no-store/referrer headers and no token logs reduce exposure.
CSRF, caller-fabricated identities, ambiguous provider sender fallback, replay,
expired tokens, takeover, unlink/relink races, stale account lineage, readonly
writes and native schema drift must refuse. Zero-SQL positive connection metadata
qualifies the factory; every SQL primitive retains the original native full guard.
Only SQLite native error 5/6 is recoverable after verified rollback; other native
failures retire the capability. Constructor performs no DDL.

Composition: add only chat-link/token tables to the existing fixed bundle and a
private optional chatAccountLinks facade port. Four exact profile variants/max4
remain unchanged. Parent owns sibling additive composition, typed migration
admission, independent peer review, focused failure/type/build controls, required
CI/PR, real private provider command registration and original acceptance. No
independent rollout or network operations by this worker. Canonical planning and
review skills were read at their canonical paths (absent from session catalog).

All tests/compiler/build/module/database/browser checks are UNRUN by instruction.

Authored outcome: domain contracts, private provider envelope partitions, service,
native durable link/token journal, additive SQL and typed migration partition,
hidden facade/interface port, exact dormant factory edge, account API, consent UI,
and focused failure-test source. Existing reserved Telegram/Slack parser functions
and their original assertions remain unchanged. Provider routes retain original
secret/signature gates, private refusal copy and independent research/payment paths.
Research from authenticated linked identities resolves ownership at admission,
retains the exact telegram/slack/discord surface, stamps ownership method unknown
(the existing closed enum has no linked-account method), explicitly retains
treasury funding and suppresses anonymous claim-token issuance for owned runs.

Exact dependency seams for parent:

- `lib/accounts/sqlite-store.ts:143` has an old `LIMIT 20` full-bundle table
  inventory. This partition adds two tables to the existing 19, so parent must
  replace that bound with a source-derived bounded count when composing the
  sibling fixed bundle. It is outside this worker's claimed writes and untouched.
  Until fixed, enrolled accountMembership construction rejects the expanded
  bundle before chat linking can be used through the ordinary facade.
- The existing four profile generator variants stay unchanged. Parent must
  compose all sibling additive table inventories once, refresh the typed
  migration/backup/fence evidence, then commission the selected actual native
  store. No old full19 runtime namespace is repaired by this source.
- Discord needs real registered link/unlink/whoami DM commands and signed
  `channel_id`; Slack needs configured commands in a genuine DM channel. No
  registration, provider call, credential or real message was performed.
- Web account/menu login and explicit account267 enrollment/resumption remain
  existing dependencies. Reload/sign in within token expiry; credentials are not
  persisted by the new UI across navigation. Header/navigation placement and
  unsupported ordinary/Supabase parity are parent surface decisions, not fallback
  authority. Missing optional native port returns unavailable.
- Parent must demonstrate actual private provider controls and future owned
  history with unchanged treasury spending, replay/expiry/concurrent consume,
  original group/token/takeover refusals, native readonly/drift/contention guards,
  UI token/referrer behavior, focused types/build and required CI. The authored
  native tests use disposable synthetic account rows and genuine WeakMap handles;
  request tests use synthetic collaborators, not actual end-to-end login proof.
- Historical attachment stays explicitly unavailable. Original #263 cannot close
  while its confirmed past-run exact-list criterion lacks genuine provenance and
  its remaining original criteria lack actual acceptance evidence.

No commits, pushes, refs/board writes, tests, compilers, modules, databases,
application/browser execution, network, money, schedule or production operations
were performed. Only instructed Git reads and filesystem source authoring/readback.

## SAME263 successor source corrections after R142 — 2026-10-15

This section supersedes the earlier source-only status for the corrected paths;
it does not supersede or rewrite retained evidence. FIRST23 R142 was
REQUESTCHANGES with three P2 findings. The first actual, source-qualified capture
in `chat263-first-actual-guards-and-contracts-20261015` recorded **105 PASS and
47 FAIL** with no skipped cases, exit 1. The failures were old exact Slack and
Telegram fixed-refusal response envelopes receiving additional preview flags.
The first focused compiler capture exited 2 with TS2322 on the untyped route
session mock. These are actual prior results, not successor acceptance. Valid
unchanged-source/input scopes may be reused by ROOT; changed scopes need refreshed
checks. All runtime outcomes after these corrections remain **UNRUN**.

- F1: applied the independently qualified one-query change from `LIMIT 20` to
  `NATIVE_USER_DOMAIN_TABLES.length + 1` (21 source names, finite bound 22).
  A complete raw-byte inverse restores the pre-correction account-store body.
  Every other byte in that file is preserved, including full-family equality, exact BEFORE,
  max4 profile policy, fixed 5000 timeout, auth and financial guards. Parent's
  ordinary composition must preserve both this correction and the disjoint
  owned-WT privatejournal history-method partition. New source fixtures use
  the genuine selected `createApplicationStorage` facade, exercise accountMembership
  resolution and chat linking, exact BEFORE absence and altered-family startup
  refusal without repair. They assert no financial/provider effects.
- F2: preview returns only an opaque purpose-separated HMAC precondition and
  expiry, never a session selector. The existing server-only `JWT_SECRET` must
  contain at least 32 UTF-8 bytes; no new credential or caller authority is added.
  The MAC binds token digest, original exact durable session hash/wallet/times,
  member and credential generations, account ID/revision and origin/network.
  Completion recomputes it against current resolved native authority before
  consuming the token. Secret rotation refuses an old proof and requires fresh
  preview. Existing native transaction-time exact snapshot validation remains
  intact after request-body await. Explicit checkbox consent and native single-use
  token consumption remain required. New controls include native same-wallet
  replacement and alternate-member sessions of the same account/revision,
  tamper/wrong token/realm/expiry/replay and revocation during body await.
- F3: mounted auth/logout, `keryx-auth-v1` BroadcastChannel messages and direct
  window focus invalidate private account/link/preview/checkbox state before
  revalidation, abort pending requests and fence fetch and body completion by
  epoch. An established session's token is destroyed even for a same-wallet
  replacement. Only initial unauthenticated/enrolling intake survives intentional
  sign-in/enrollment; explicit logout always clears it. Failed loads clear private
  projections. Page departure and unmount abort/fence, close channels and remove
  listeners; effect replay retains initial intake, with true unmount clearing the
  token in its cleanup microtask. Token-free `/account` opens in a separate tab
  with no opener/referrer; returning requires a fresh preview and checkbox.
  Existing-style mounted jsdom/React DOM controls cover these boundaries,
  including late bodies from load, preview, complete, unlink and their refreshes.
- Fixed static Slack/Telegram refusals now retain their exact old response shape;
  preview suppression is added only for nonstatic authenticated replies. Original
  negative/no-effects assertions and malformed-binding pre-storage refusals are
  preserved. New signed/private positive command contracts use real route signature
  or secret verification and real command service with synthetic downstream storage;
  they send no live messages. The session mock now uses the exact route dependency
  type with typed `vi.fn`, without an auth type bypass.

Raw before/after bodies, complete inverse restoration actions, changed-path pins
and F1 one-literal byte proof are retained in
`output/consent-successor-handoff.json` and adjacent successor artifacts. Original
FIRST23/R142 and actual guard/type captures remain intact. No Git, board, target,
tests, compiler, build, candidate-module, DB, browser or network execution occurred
in this successor; only filesystem source/evidence processing. Default native
auth/model/tier/policy and ROOT sole release ownership remain unchanged.

ROOT's next action is a tiny changed-source review, then only failed/new meaningful
controls, focused types, genuine facade acceptance and Next build, followed by the
focused PR's required aggregate/domain CI and actual original acceptance. This
source correction grants no runtime activation, production changes, spending,
financial inheritance, schedules or App54 authority. Historical exact-list attach
still lacks verified retained chat-user provenance and is unavailable. UNKNOWN
ownership metadata remains honest closed-enum metadata, not verified-session
proof. Actual provider registration/private messages/link/unlink/whoami, owned
future history, native selected-store commissioning and production evidence remain
open; original #263 cannot yet close.
