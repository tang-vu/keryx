# Run privacy (#266): source contract and rollout holds

Root's owner-delegated policy is recorded in [DECISIONS](../DECISIONS.md): every
historical run is unlisted; new authenticated-owned runs default private; new
unowned runs are unlisted. An owner may opt a run or future default into public.
No requester-supplied wallet, payee, question or creator record establishes ownership.

`KeryxDB.runPrivacy` is an additive **ordinary-only, default-off** port. SQLite
requires the exact preinstalled [source schema](../lib/db/run-privacy-sqlite.ts).
Supabase uses only the fixed service-role `run_privacy_v1` RPC and its immutable
source-created catalog seal in [0090 source](../supabase/migrations/0090_run_privacy.sql).
That migration requires an already admitted 0088 original/session catalog; it
refuses a missing predecessor and does not activate claim/history capabilities.
`KERYX_RUN_PRIVACY_ENABLED=true` is a separately approved rollout setting, not
enabled by this change. Neither adapter installs this domain at startup. Enrolled,
native, archive and private research facades acquire no fallback capability.
Public detail fails unavailable without admission; lists/memory return no text.
Internal canonical `getQueryRun` remains an original/financial reader, never a
public authorization check. Public HTTP, discovery and enrichment use the port.

Public lists select only `public` and unerased rows **before body retrieval and
paging**. PublicUsage keeps its complete bounded financial metadata corpus and
all cohorts; only its question-body page is filtered for visibility. The public
archive enumerates no historical questions. Existing unlisted links still read
historical originals. Current hidden/erased IDs cannot fall back to an older
archive duplicate. Follow-up enumeration and shared agent memory use public rows;
stream publication rechecks visibility. Metadata/OG/structured data omit nonpublic
text. Feeds, topics, related search, sitemap, creator feedback and affected HTTP
pages have no stale text cache/fallback. Static curated demos remain unchanged.

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
Retained payment rationale is a financial journal field; public projections omit
it. An erased owner export contains the erased run and unchanged financial rows.
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
- Paid-research GET polling checks the run reader before retrieving the order's
  retained request/answer. Private results require the authenticated run owner;
  unknown and unfinished runs fail closed. Pending-order status needs a separately
  admitted metadata-only contract. POST delivery/payment/runner authority is unchanged.
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
- Exact-head full CI, APP TypeScript, production Next build and applicable domain /
  platform SUCCESS remain merge gates. Source fixtures alone are not production
  acceptance. Root owns PR review gate, release, deployment and closure; #266 stays OPEN.
