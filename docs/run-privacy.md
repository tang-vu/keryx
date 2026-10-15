# Run privacy (#266): source contract and rollout holds

The owner revised the product policy on October 15: ordinary research defaults
public, with Public/Unlisted/Private shown before browser submission. Existing
saved preferences, explicit per-run choices and erasure remain authoritative.
Private creation requires a verified owner. Hidden-parent follow-ups inherit
their parent's restriction. Signing in alone does not make research private.
Historical missing sidecars require the separate reviewed restoration described
in [public research visibility](engineering/public-research-visibility-2026-10-15.md);
neither startup nor a resave publishes historical records implicitly.
No requester-supplied wallet, payee, question or creator record establishes ownership.

`KeryxDB.runPrivacy` is a separately admitted privacy port. SQLite
requires the exact preinstalled [source schema](../lib/db/run-privacy-sqlite.ts).
Supabase uses only the fixed service-role `run_privacy_v1` RPC and its immutable
source-created catalog seal in [0090 source](../supabase/migrations/0090_run_privacy.sql).
That migration requires an already admitted 0088 original/session catalog; it
refuses a missing predecessor and does not activate claim/history capabilities.
`KERYX_RUN_PRIVACY_ENABLED=true` is a separately approved rollout setting, not
enabled by this change. Neither adapter installs this domain at startup.
Each ordinary adapter captures an immutable `runPrivacyActive` at construction.
**Default OFF preserves the existing admitted ordinary readers**, including public
archives, shared memory, follow-ups, publicUsage history, dispatch/receipt links
and paid GET polling. Existing profile/domain authority checks still apply.
With privacy OFF, ordinary public creation retains the admitted legacy writer;
nonpublic choices refuse before research starts. While OFF,
owner visibility/default/export/erase controls return `privacy_unavailable` and
the owner page does not mount the controls.

**ON requires the admitted privacy port** on every affected reader. Unknown schema,
ownership or unavailable port fails closed, even if the process flag later changes.
There is no active legacy, raw REST, native or stale-text fallback. Enrolled,
archive and private research facades acquire no new capability. Native privacy
uses only explicitly admitted adapter authority, never the flag alone. Changing
the activation setting requires a reviewed process/build restart and the rollout
gates below; an environment change inside a live adapter cannot switch its authority.
Internal canonical `getQueryRun` remains an original/financial reader, never a
public authorization check. Public HTTP, discovery and enrichment use the port.
Authorized permalink reads retain the existing recorded-evidence presentation;
owner export/claim digests retain the exact stored original.
The public `QueryRun` projection and its return type omit internal `sourceLearning`
as well as fulfillment authority. Publication does not authorize exposing that
per-run snapshot. Stored originals and authorized exports/digests remain exact;
ordinary erasure removes the snapshot with the other question-derived JSON.

When activated, public lists select only `public` and unerased rows **before body retrieval and
paging**. PublicUsage keeps its complete bounded financial metadata corpus and
all cohorts; only its question-body page is filtered for visibility. The public
archive enumerates only explicitly public historical questions. Existing unlisted links still read
historical originals. Current hidden/erased IDs cannot fall back to an older
archive duplicate. Follow-up enumeration and shared agent memory use public rows;
stream publication rechecks visibility. Metadata/OG/structured data omit nonpublic
text. Feeds, topics, related search, sitemap, creator feedback and affected HTTP
pages have no stale text cache/fallback. Static curated demos remain unchanged.

The #298 pooled question population is separate from canonical financial
`summary.researchRuns`. ON uses `PublicUsage.publishedHistory`: exhaust the existing
complete bounded classified candidate IDs in batches of at most100, select public
rows through the privacy port, then recheck `read().item.state` before counting and
keeping the newest100 sample. Private/unlisted/erased rows do not enter window
counts, basis/unscorable coverage or the score. Canonical money/cohorts stay exact.
These are fresh per-row publication observations over the bounded metadata window,
not an atomic cross-RPC snapshot; revocation can underfill, with no unbounded refill.
Active reads bypass the old five-minute process map entirely, including entries
warmed in OFF mode. HTTP `no-store` alone does not revoke a process-map entry.
OFF retains the existing admitted aggregate/count/cache lane.

The #299 learning reader checks active admission even for empty scans and absent
sources. It consumes the public-only iterator's existing300-candidate work bound
and freshly rechecks publication before projecting internal observations. A queued
revocation consumes work without contributing; hidden legacy rows do not influence
unknown/excluded counts or actor/day deduplication. Unknown/missing/drifted active
ports are unavailable: API503, withheld SSR figures and remote/stdio MCP errors,
never a successful empty aggregate. OFF preserves the admitted learning lane.

`/me/run-privacy` controls defaults and a selected run. Owner reads and exports
accept an active SIWE session or a verified key with explicit `history:read`.
Bearer presence never falls back to cookies. Remote and stdio MCP expose
`run_privacy_read` and `run_owner_export` using the same scope/port; stdio uses a
fixed HTTPS origin, bounded responses, no cookies, redirects or retries. Desktop,
CLI, extensions and bots inherit guarded public APIs; visibility/default/erasure
mutations require the interactive web session. No new signing/key scope or model
allowance is introduced. Published packages are unchanged until root release.

Mutation requests require the configured Origin, expected wallet, active session,
bounded JSON, revision and UUID request ID. Storage rechecks that session in the
same write transaction. Cross-owner read/export/change/erase returns no original.
Private permalink read uses the same 404 body/headers as an unknown valid ID.
Repeating an identical successful mutation UUID returns its recorded result;
reusing that UUID for different input/owner/run/action conflicts. Erasure is also
idempotent with a new UUID after the first erasure; visibility cannot resurrect it.
Exports record state/digest in the audit, never another question-text copy.

Erasure removes `query_runs.question`, `answer`, research text in the JSON,
ordinary topic memory and terminal demand text. Run ID, indexed exact financial
counters, funding telemetry, and canonical payment/reward journals stay unchanged.
Retained payment rationale and authorization nonce/phase/expiry/grant bindings
remain private journal fields. Question ownership does not grant the custodian's
authority. Public/owner financial exports retain exact amounts, states and public
settlement evidence, omitting those bindings and rationale. Stored journals stay
unchanged; an erased owner export contains the erased run and this projection.
A claim is reverified against the unchanged original before a privacy action;
only erasure retains a verified owner/binding/digest tombstone. It does not assign
the claimant as asker, payer or funding owner. Source triggers reject replacement
of erased originals and retention/audit deletion.

Public `/api/payments`, activity, creator totals and earnings exports retain exact
financial values and suppress nonpublic question enrichment. A private current
run's `/receipt` returns `urn:keryx:settlement-receipt:1` with SHA-256 integrity,
original run ID, recorded totals and financial payment objects without rationale.
The digest is integrity, not a signature or independent finality proof. The
existing public research-receipt v1 builder/verifier is unchanged. Retained
unlisted archive receipt links retain their original v1 proof/network.

## Explicit delivery holds

- Protected `originalFulfillment` / A2A originals and active demand retries refuse
  erasure with `retention_hold`; their execution/custody contracts are reserved.
- Historical immutable archive originals have no privacy writer. Link access
  remains unlisted; erasure of those physical copies needs a separately reviewed
  retention procedure. Export/erasure here concern the current ordinary store.
- Active paid-research GET polling checks the run reader before retrieving the
  order's retained request/answer. Private results require the authenticated run
  owner. A running order without a saved run uses `runPrivacy.pending`: the admitted
  SQLite column reader or fixed service-role RPC returns only bounded queued /
  processing / review-required status, timestamps, exact recorded accepted amounts
  and the transaction ID. It never reads request/response bodies, nonce, payer or
  payee, invents ownership, or asserts completed settlement. Unknown/hidden IDs
  remain indistinguishable. Completed/failed orphan orders without an admitted run
  remain refused until a separately reviewed result/retention contract exists.
  OFF preserves the original poll; POST/payment/queue/runner authority is unchanged.
- 0090 closes legacy public REST column/table grants and realtime publication on
  raw text-bearing relations. Its **source-only** catalog transition first
  validates any existing admitted anonymous-claim seal, then rebinds that same
  seal to the exact ACL delta under migration-owner authority, restores the exact
  immutable trigger and revalidates. Runtime/service code cannot re-seal anything.
  Unknown schemas or enrolled profiles must refuse the migration. This dependency
  requires root's independent review and real isolated PostgreSQL acceptance.
- Prior external public copies cannot be recalled. A production rollout needs
  explicit DDL consent, actual-schema preflight, complete existing exposed RPC /
  view / realtime inventory, verified claim compatibility, deletion retention
  decisions, old cache/CDN/OG purge, and publication quiescence. No such target
  operations, flags, backfill, providers, payments or schedules were touched.
- The activation boundary has synthetic OFF/ON checks for both adapters, ordinary
  routes/history/cache, pending polling and exact financial equality. The isolated
  PostgreSQL acceptance script includes service/anon pending-reader role checks,
  but has not executed here. Mocks and SQLite fixtures do not qualify real PG17.
- Exact-head full CI, APP TypeScript, production Next build and applicable domain /
  platform SUCCESS remain merge gates. Source fixtures alone are not production
  acceptance. Root owns PR review gate, release, deployment and closure; #266 stays OPEN.
- The source-accepted core `aca230f` is integrated on this same focused branch by
  normal merge, preserving its modes/payloads. Its actual CI/ordered main merges
  and this combined head's acceptance are separate pending gates. Canonical offline48
  is not replayed or written here; root reserves the final combined selector epoch.
  Prior canonical metadata/report bodies remain inherited evidence, not new-head
  acceptance. Real PG17 is unexecuted locally; the known Next dependency-junction
  failure is retained without retry/install/cache repair. Root whole-source peer
  review is required before ONE266PR. No migration/bootstrap/flag/data operation
  is performed or newly authorized by this integration.
