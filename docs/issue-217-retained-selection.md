# Issue 217: qualified retained-set selection candidate

This offline source candidate implements the ordering core of Stage 2 in
[the recency plan](engineering/source-recency-2026-10-08.md), following
[issue #217](https://github.com/tang-vu/keryx/issues/217). It is not enabled in
`run-agent.ts`. The existing Stage 1 current-feed refusal remains authoritative.
Current-feed observation, useful answer delivery and the release gates remain open.

## Implemented boundary

[The helper](../lib/sources/retained-source-recency.ts) accepts an internal closed
requirement with an explicit publication-date criterion, exact feed identity
and frozen retained scope. There is no new question classifier, public scope flag
or agent activation. It refuses a supplied current-feed scope, stable-version
criterion, additional cutoff or unsafe feed binding. A future caller contract
must establish the explicit retained scope from the original caller, never a
model target or tag. The existing original-text guard handles current supported
questions and retains its own limited recognition coverage.

A trusted adapter must supply one complete retained-set snapshot with exact
source/feed identity, capture time and item/version membership. The constructor
validates at most 1000 metadata items, rejects duplicate IDs, copies and freezes
the set and each native date record, and hashes the complete cohort. It accepts
no paid body, wallet, price, offer or payment fields. Source ID is supplied by the
existing source record; feed equality is a selection binding, never ownership.

The selector chooses a unique maximum publication time before any topical
ranking. Every member must carry a normalized timestamp agreeing with its
original `atom:published` or `rss:pubDate` field. Its conservative date subset
rejects impossible calendars, unsupported date forms, legacy normalized-only
dates, edited-only Atom dates, future publication times relative to capture,
missing dates, partial/unknown sets and tied newest candidates. It does not drop
uncertain members and call the remaining subset newest. An invalid/future capture
clock and any exact wanted-source/item/version conflict also withhold selection.

The result carries scope, criterion, source/feed, capture time, membership count,
cohort digest and either the exact eligible item/version or a specific refusal
reason. It commands no BUY/CACHE, supplies no content evidence and authorizes no
reward. It makes no assertion about what is currently newest in the live feed.

## Frozen fixture and checks

[The ten-release fixture](../lib/sources/fixtures/issue-217-retained-releases.json)
is synthetic. Its v18/v10 names and times mirror the issue's failure shape;
the other rows, native field-role records, version strings, URLs and metadata are
invented test inputs. They are not a captured original feed, a reconstruction
of the paid article or evidence of a tag/change answer.

The old topical selector chooses the stronger-overlap v10 metadata. Qualified
retained-set selection chooses v18 even with reversed array order. Adverse tests
cover cohort uncertainty, native date provenance, mismatches/future/ties,
explicit RSS timezone normalization, exact wanted-version conflict, mutation by
a later refresh, bounds and exclusion of body/payment fields. The current-feed
guard and ordinary topical selector retain their existing behavior. Focused
tests use `--no-cache` and no external transport; no alias suite is repeated.
The final three-file focused corpus passed 51 tests; scoped ESLint and both
application/operational TypeScript graphs passed. The first application check
found an intentional invalid-fixture cast missing its `unknown` step; that test
cast was corrected before the passing checks. No dependency install or package
bytes changed, and mutable shared tool caches are excluded from dependency provenance.

## Integration contract and unavailable evidence

The existing paid `getItems` result carries normalized `publishedAt`, but not the
original date role/raw value. `rss-parser` can substitute Atom `updated` when
`published` is missing. Paid refresh accumulates links without a cohort capture
record. SQLite's complete ordered SELECT and the enrolled Supabase complete-or-
fail RPC differ from the legacy direct-select fallback; their common array type
does not retain that distinction. Public references retain a filtered ten-item
prefix and `refreshedAt`, without native date provenance or complete feed membership.
None can honestly construct an eligible snapshot for this helper today.

No `run-agent.ts` integration diff is committed. Enabling legacy rows by declaring
the array complete or inventing a native field role would weaken the existing
refusal. The narrow integration, once a qualified provider exists, is:

1. Establish retained scope through a reviewed original-caller contract before
   decomposition. Preserve the current guard for current-feed and unsupported
   instructions. A model target, tag or recommendation cannot create the scope;
   no such caller contract is added by this candidate.
2. Obtain a coherent native-date cohort from the trusted adapter. Validate and
   freeze it once per run, preserving exact source/feed identity. Do not refresh
   the shared catalog during research or infer completeness from array length.
3. At the source loop's existing pre-ranking eligibility boundary, resolve the
   retained selection. Emit its metadata/refusal before cache, offer or signing.
   Withheld selection must `continue`, including the empty-set case, so no legacy
   source-level fallback, reevaluation or cached older item re-enters the maps.
4. Resolve the selected ID against the actual retained item and require its exact
   `sourceItemIdentity` version/date to agree. Keep existing wanted binding,
   registry/claim/offer/payment terms, public-alias handling and ordinary engine
   BUY/SKIP/CACHE choice. Carry the scoped snapshot diagnostic to the final report.

Native date retention and atomic cohort publication need SQLite/enrolled-Supabase
storage parity and an explicit legacy refusal. A bounded current-feed probe needs
the existing public-address, hop, byte, deadline and per-run read budgets, exact
raw membership, rejected/filter/truncation accounting and a disclosed observation
time. Its transport and coherent observation contract are not supplied here.
Do not substitute GitHub latest-release API semantics or database insertion order.

The ordinary supported caller flow must still demonstrate a supported release
tag/change answer, or an honest unresolved read gap before an irrelevant toll.
Preview/selection metadata cannot satisfy evidence or reward gates. Access
settlement, creator citation reward and service/model costs retain their separate
states. This candidate performs no live feed/model/search/payment calls and changes
no active Operator, runtime configuration, production transport or public schema.

## Surface and release gates

This unconnected internal helper changes no current supported caller behavior.
Enabling it belongs in the shared TypeScript agent so web/API/OpenAI/hosted MCP,
human CLI, bots and A2A preserve the same original scope and portable diagnostic.
Buyer/stdio and desktop consume hosted original results; extensions keep their
thin handoff, while private Operator and Rust retain their existing reduced roles.
Paid-service admission/quotation must keep the separate original-contract gate.

Root owns coordinated contracts, adapter integration, source/payment review,
combined checks, build/CI, version/distribution readbacks and release. No current
feed or useful-delivery acceptance is claimed by the synthetic tests or this core.
