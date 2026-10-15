# Topic watches: private manual product — 2026-10-15

Architecture/threat decision recorded before runtime edits. Original #284 remains
OPEN: scheduling, funded watches, standing spend and email/bot delivery are not
authorized or implemented here. This slice mounts `/me/watches` and same-origin
session APIs for create/list/read, settings update, pause/resume/cancel and one
explicit local metadata check. Spending capacity and actual paid requests are zero.

The selected enrolled SQLite facade owns a hidden optional watch port. Ordinary,
unknown, missing and Supabase stores do not acquire a fallback. A port captures
the verified original web-session hash, wallet, issue and expiry times; body owner
strings are never authority. Every operation checks that exact row in its own
transaction. A revoked/replaced session cannot resume after body/metadata awaits.
CAS uses BEGIN IMMEDIATE, owner+ID+revision, trusted store clock strictly before
the deadline, complete validated state, and retained cancellation tombstones.
All watch/control writers use that CAS. Contention 5/6 is temporary only after
known rollback; other failures and uncertain commit permanently revoke the port.
Readonly policy refuses mutations before SQL. No constructor installs schema.

Existing donor domain controls, history, missed-slot accounting, lexical digest,
watermark and zero-spend assertions are retained. Settings replacement is allowed
only before the first check; after admission, immutable cadence/caps/history keep
their original identity. Pause/resume/cancel remain available separately.

Metadata comes only from the bounded curated scholarly catalog. It is local
record comparison, not discovery of newly published works. No provider, search,
paper body, paid, model, scheduler or delivery executor is imported by this path.
The UI must say this plainly, report failures and empty heartbeat honestly, and
avoid public sharing of private watch state.

Schema composition stays the exact four profiles (legacy BEFORE / one complete
source-known bundle, archive absent/present), max four. Only the watch table and
its inventory/import/facade edge are this worker's additions. ROOT composes sibling
domains. Existing deployed full19 is not the legacy BEFORE profile: an explicit
exclusive, typed-backup-admitted migration from full19 to the complete new bundle
must preserve every old typed cell/schema/fence. This source supplies the watch
migration reference; no target migration or DDL is executed by the source author.

Validation is UNRUN by instruction. Parent owns independent review, actual two
native connection/CAS/failure tests, types, Next build, PR/CI and delivery. Donor
47-pass evidence applies only to unchanged donor semantics, not this composition.
Web/API are authored here; desktop may use the mounted web surface. CLI, remote
and stdio MCP, extension and bots gain no new watch capability or claim of parity;
their deliberate handoff is the authenticated web page. Language localization,
scheduled/funded gates and cross-surface release acceptance remain parent gates.

Source handoff details: the selected facade constructs `topicWatches` only from
its existing verified connection. `KeryxDB` has one optional typed property; the
facade property is non-enumerable, frozen and grants no connection capability.
Adding `topic_watches` to the native table inventory automatically includes its
three identity fences in the existing application inventory. No direct change to
`storage-identity-sqlite.ts` is needed. The graph test admits only the exact watch
store-to-verified-connection edge and preserves the other assertions.

Guard-count dependency seam: this domain makes one explicit full connection
assertion per operation and uses positive WeakMap native/selected/write policy.
The existing verified-connection proxy independently asserts on each SQL method;
it therefore still performs additional full guards within a transaction. This
worker does not bypass that proxy or edit its unclaimed implementation. ROOT must
resolve/measure the requested single-full-guard execution contract at that shared
boundary before claiming that acceptance criterion. Error cleanup additionally
checks rollback health; unknown origin failures permanently latch before cleanup.

The source-known migration reference accepts full19/full20 pairs only and
deliberately refuses if sibling tables have been composed without updating the
reference. ROOT must replace that reference's complete target/installer with the
final sibling bundle, retaining exact historical full19 and all original typed
rows; do not widen the runtime four-profile family. No operational CLI, backup
creation, writer stop, target execution or migration approval is implied here.

Authored coverage includes native two-connection admission and CAS, actual BUSY,
owner isolation, original-session revoke/replacement/expiry, control during an
await, immutable tombstones, readonly pre-SQL refusal, unknown shapes and schema
drift, uncertain acknowledgements, typed migration backup preservation, API
owner/origin/revision/body controls, and actual mobile/desktop browser controls.
Original donor assertions are retained; new settings assertions are additive.
All authored tests, types and builds remain UNRUN. No source-author commits,
network operations, DB/module execution, release or production actions occurred.

## FIRST141 source correction successor — 2026-10-15

The original candidate's actual parent controls recorded 80 PASS, 4 fixture FAIL,
3 UI journeys UNRUN and types PASS. The four failures came from the synthetic
retained query_runs insert missing required created_at; the browser fixture also
needed resolveDir on the virtual next/link JSX loader. ROOT08d014 accepted those
two exact literals in the retained source-proposal.json. They are now applied in
this worktree. Original result/failure captures and the original source handoff
remain intact; those earlier results do not accept the corrected source.

FIRST141/FIRST20 peer review was REQUESTCHANGES for two reachable P2 findings.
F1 now applies the domain's NFKC/case/whitespace-normalized title AND optional
complete author AND optional complete venue predicate before maximumRows slicing.
The existing parsed catalog maximum 100 and response maximum 32 are retained.
Added source regressions use genuine catalog record 40 ROUGE/Chin-Yew Lin at the
UI default 32 and Tri Dao/attention at limit 1, plus normalized author+venue
finite-cap positives, venue-only filtering and conjunctive/partial no-match cases.
The curated, metadata-only, zero-spend disclosure and capability bounds remain.

F2 routes component-local keryx-auth-v1 BroadcastChannel and window focus through
the same existing epoch invalidation as keryx:auth. Drafts, consent, watches,
editing and results clear before explicit watch revalidation; pending old
response/body generations cannot restore them. Cleanup removes both window
listeners and closes the channel. The shared auth hook and global policy are
unchanged. The existing browser fixture now additionally authors two intercepted
same-origin pages in one BrowserContext using native BroadcastChannel, explicit
draft/consent/watch/result clearing, and late native streamed-body broadcast/focus
controls. These controls require explicit Refresh before restored list visibility.
Original complete mobile/desktop journeys, strict assertions and deadlines remain.

This corrected-source successor and all added controls are UNRUN by instruction.
Parent next action: changed-source tiny review, then only the four failed migration
cases, three previously unrun UI journeys and new F1/F2 regressions. Do not repeat
the old 80 passing controls without a relevant source/input reason. Required
changed-source acceptance, CI and final composition/release gates remain open.
The other 15 frozen candidate paths, including native factory/CAS/schema and
migration runtime, are preserved byte-exact. Static guard counts authorize no
runtime optimization. ROOT retains sole release coordination; no tests, target
modules, compiler, DB, browser, network, Git, production or financial actions
are run by this source correction. Default native auth/model/tier/policy remain.
Raw predecessor/successor bytes and whole-file inverse artifacts are retained in
output/topic-watch284-source-successor; output/source-successor-handoff.json is
the bounded five-path handoff. Original #284 remains OPEN.
