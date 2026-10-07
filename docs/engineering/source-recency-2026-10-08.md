# Source recency before a paid article read

Status: reviewed architecture proposal; no runtime repair or current-newest
acceptance is claimed. This is a separate follow-up to
[issue #217](https://github.com/tang-vu/keryx/issues/217), under B06/B07 of the
[research workload](../research-workload.md). Production remains on the deployed
TypeScript payment and research paths. Implementation, caller parity and release
gates below remain open.

## Observed problem and limits

The issue records one owner-operated mainnet task asking for the newest release
in a named creator feed. The retained catalog contained a newer entry, but an
older article was purchased and the run produced no supported answer or citation
reward. Access settlement and useful delivery are separate outcomes. This is
first-party validation, not independent adoption.

At source `70172fe4`, [article selection](../../lib/sources/source-item-asset.ts)
scores the question, generated research targets and source tags against free title
and summary metadata. Newest-first order only resolves equal scores.
[The agent](../../lib/agent/run-agent.ts) selects one article per publication
before presenting candidates to the reasoning engine and signing a paid read.
A frozen synthetic multi-release counterexample also selects the older article
when its metadata has more overlapping words. This establishes a reachable
selection defect; it does not establish every downstream evidence failure's cause.

[Feed refresh](../../lib/ingest/refresh-feed.ts) accumulates previously unseen
links. It does not retain a collection cohort or successful observation timestamp
for the paid catalog. An item's publication date is not a collection date.
[Public references](../../lib/public-references/catalog.ts) retain `refreshedAt`
and at most ten accepted items, but discarded, filtered and unobserved entries
cannot be reconstructed from that timestamp. Neither representation proves that
the currently returned item set contains the feed's current newest release.

## Chosen design direction

Apply source, exact-item/version and temporal eligibility before topical ranking.
Preserve an immutable requirement from the original caller request; generated
research targets, source tags and model recommendations cannot create, relax or
replace it. The engine continues to choose BUY/SKIP/CACHE among eligible candidates.
An eligibility check cannot force a purchase, establish evidence or authorize a
creator reward.

Prefer a validated structured per-call requirement with an exact source/feed
identity, ordering criterion and explicitly requested observation scope. A narrow
natural-language recognizer may derive it only from positive original-text spans
with an unambiguous source binding. Quoted examples, negation, comparisons, multiple
feeds, stable/prerelease restrictions and time cutoffs require their own qualified
handling. A general `latest` regex, proximity to any URL, or model-created claim
is insufficient. Recognition coverage and failure behavior must be demonstrated
before this path is enabled; uncertain interpretation remains a visible gap.

The intended distinctions are:

| Caller requirement | Eligible observation / behavior |
| --- | --- |
| Ordinary topical research | Preserve existing relevance ranking; an older article may be the best evidence |
| One exact article/version | Preserve its exact identity; never replace it with a newer or more topical article |
| Newest by publication date among an explicitly retained set | Freeze that bounded membership; require a unique maximum valid publication date |
| Newest observed in the named feed now | Require a qualifying fresh bounded feed observation, with its scope and time disclosed |
| Highest stable version, a cutoff, or another unsupported criterion | Explain the unresolved criterion before the affected paid read; do not substitute publication order |

Never silently convert a current-feed requirement into newest-cached. A named
release can resolve an exact existing article without proving that release is
currently newest. Do not infer an item release type or semantic-version order
from a title without a separately qualified source-specific contract.

For retained-set ordering, withhold when membership is empty, any eligible date
is missing/invalid/future, or distinct candidates share the greatest publication
time. Do not drop uncertain rows and call the remaining maximum newest. Preserve
the original date and set identity for inspection; database order, array position,
catalog insertion time and cache time cannot substitute for publication evidence.

## Staged delivery

1. **Safety before purchase.** Introduce the closed caller requirement and native
   eligibility result, with demonstrated original-text binding where supported.
   An unresolved current-newest requirement withholds its affected paid source
   and reports the version/read gap before an article toll. Block the legacy
   source-level purchase fallback as well. This is a safety repair, not proof of
   useful-answer completion or general natural-language recognition.
2. **Explicit retained-set lookup.** Select the unique newest eligible entry from
   a frozen set only when the caller requested that scope. Expose item/version,
   publication date, membership and limitations before the engine's ordinary
   BUY/SKIP decision. Missing evidence remains a gap.
3. **Current-feed observation.** Add a bounded, explicit free probe of the exact
   requested feed under existing public-address, byte, hop, deadline and per-run
   read budgets. Preserve URL, successful observation time, exact membership,
   item identities and truncation/filtering/completeness information as one
   coherent observation. Do not silently fetch another feed, expand limits,
   refresh the shared database during research, or turn a failed probe into an
   empty/fresh feed. A ten-item prefix cannot certify the whole feed's maximum.
4. **Useful delivery.** Demonstrate a supported tag/change answer, or a specific
   unresolved gap before an irrelevant purchase, through the ordinary supported
   caller flow. A feed read, correct item choice or settled toll alone does not
   close the intended-answer or independent-usefulness gate.

The exact observation representation, completeness proof, clock/freshness policy,
storage transaction and multilingual recognizer are open implementation choices.
Select them using adverse evidence; do not record a universal freshness interval
as established. A successful probe supports "newest observed in this feed snapshot
at X," not an unconditional guarantee that the publisher has made no newer entry.
Atomic observation publication must prevent a new timestamp being paired with an
older/partial set. SQLite/Supabase parity and existing residual-risk policy apply
if a persistent catalog observation is introduced.

## Authority, failure and recovery

Keep the existing `targetAsset` wanted-response binding authoritative. Conflicting
requirements, disappearance, changed content version or expired/replaced offer
must refuse instead of replacing the exact asset. Preserve `itemId + contentVersion`
from discovery through offer, purchase, cache, delivered identity, evidence and
receipt. A feed observation supplies selection metadata; registry state still
governs active source, payout and price. Free published text has no payment/reward
authority, and duplicate public evidence retains the existing free-read preference.

Reuse the frozen eligibility result during portfolio selection, reevaluation,
cache reuse, duplicate handling and fallback. A withheld older article must not
re-enter through another source-level or expansion path. Original recovery uses
the original GET/receipt and identity; it does not re-probe and replace that work.
Degrade one affected source/target where possible and preserve an otherwise
completed answer with honest gaps.

No budget, attention, provider retry, custody, nonce, reservation or settlement
rules change. Withholding a new article toll does not establish zero model/search
cost, refund a prior access payment, remove a settled incoming service fee or
complete an already paid original. Existing liabilities and failed/pending
histories remain. Qualification at quotation/admission time for paid A2A/buyer
services is a separate coordinated gate; do not advertise an unconditional
"no charge" guarantee from the downstream article guard.

## Supported surfaces

| Surface | Required implementation/release boundary |
| --- | --- |
| Web Ask, chat and embed | Display the effective source/order/scope and a specific gap; preserve the question and explicit constraints without automatic resubmission |
| `/api/ask`, OpenAI, hosted MCP, human CLI and bots | Preserve the same closed requirement and diagnostic through their shared agent adapters; never silently discard an unsupported constraint |
| Buyer/stdio MCP and A2A | Bind requirements into their original quote/request/order contracts before paid admission; retain exact recovery and package identity |
| API, saved reports and portable receipts | Retain safe selection provenance and scope without promoting metadata to evidence or rewriting historical runs |
| Desktop, private Operator, remote/stdio private controls and shared Rust | Preserve their reduced task/custody roles and existing exact original contracts; no general feed reader or unproved domain cutover |
| Extensions | Keep the thin hosted handoff; carry explicit intent through supported contracts or visibly refuse unsupported input |

Audit source contracts, adapters, storage, tests, docs and actual published package/
installer/deployed identities together. Old saved tasks or quotes must retain
their original schema/intent; do not retroactively label them current-newest.
An intentionally reduced role must be documented, not silently treated as parity.

## Acceptance and release gates

- Frozen multi-release fixture: a newer eligible entry wins despite an older
  entry's stronger title/summary overlap; ordinary topical ranking still selects
  the older relevant article when there is no temporal requirement.
- Omitted/contradictory model targets and tags cannot remove the original scope.
  Quoted/negated latest, mixed comparison scopes, multiple feeds, unsupported
  stable/prerelease and cutoff criteria cannot cause a wrong paid substitution.
- Missing/stale/incomplete current cohort or failed free probe produces an
  inspectable gap and zero new irrelevant article toll. Retained scope must be
  explicit, with missing/invalid/future/tied dates withheld.
- Exact wanted-response conflict/change, legacy source-level fallback,
  reevaluation, cache and alternate paid paths cannot bypass eligibility.
- Concurrent refresh/probe/selection and process loss cannot mix cohort versions,
  erase uncertainty or replace an original recovery identity. All public transport
  and existing execution bounds remain enforced.
- Actual synthetic shared-agent/adapters and built web UI pass with intercepted
  external/payment transport. Focused payment review, TypeScript, required CI and
  final production build pass before a runtime release.
- Separately authorized ordinary useful-task acceptance, original/maintenance
  lifetime gates, current-main deployment health and distribution readbacks remain
  required. Internal fixtures do not prove customer acceptance or return demand.

Independent read-only architecture review agreed with source-scoped eligibility
before ranking and the staged refusal boundary. It performed no tests, edits,
live feed/model requests or spending. No stage above is implemented by this plan.
