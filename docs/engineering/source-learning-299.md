# Bounded source outcomes — issue 299

This candidate makes the recorded source sample inspectable without activating a
new spending policy. It does not close [issue 299](https://github.com/tang-vu/keryx/issues/299).
The October 9 [authority decision](research-decision-audit-2026-10-09.md#bounded-source-learning-299)
still requires independently classified and funded outside observations.
Authenticated wallets and execution channels alone do not supply that evidence.

## Write-time record and eligibility

The public orchestrator captures `QueryRun.sourceLearning` after completed
grounding/attribution and the existing payment path. Ordinary SQLite and Supabase
already retain this additive packet in `query_runs.data`; no column, DDL, backfill,
new store, or shared-production write is introduced. Capture failure leaves the
completed answer and payment state intact. Job-scoped private effects do not
capture or contribute a learning packet.

One observation identifies an offered source, not an article. Its public topics
are the intersection of the question with that source's declared public tags,
or `general` when none match. Arbitrary question words, names and URLs do not
become public facets. No question, actor wallet, payment/receipt ID, content,
evidence digest or run ID appears in the aggregate response.

The write-time observation excludes the verified actor when it matches a source
payout wallet, author beneficiary, fresh registry creator/payee or authorized
registry citation wallet. This exclusion precedes cohort checks. Synthetic,
offline, unknown, team/scripted/sponsored and unavailable/stale/non-chain
authority observations cannot improve the estimate. Eligibility also requires
the existing server-local trusted usage capability's outside/independent actor
and funding evidence. No public body/header can mint that capability. No new
production classifier is enrolled by this candidate.

`bought` requires a matching real, recorded settled access payment for the exact
source/item/version **and** a completed read. Pending, simulated, unidentified,
cross-network and settled-but-unread payments are not purchase outcomes. Multiple
articles aggregate exact micro-USDC cost and bounded contribution into one
source/run observation. A citation is a retained outcome, not proof of factual
accuracy or of new independent settlement verification.

## Public record

`GET /api/source/{id}/learning`, `/creator/{id}`, and the remote/stdio MCP
`keryx_source_learning` tool expose the same validated
`keryx-source-learning-v1` report. All are read-only; the public client sends no
account key, cookie or payment authorization and refuses a paid fallback.
Unknown/duplicate selectors refuse before storage. Missing sources are 404;
storage/validation failures are 503, never invented empty records.

The current public store supplies at most 300 recent runs. Its streaming iterator
releases question/answer/trace bodies before the next record. Up to 60 most recent
eligible observations are scored per source/topic. At most one attested actor
per UTC day contributes to each source/topic; duplicate runs cannot amplify a
record and conflicting retained copies refuse. This is a bounded recent sample,
not an all-time total or a complete observation period. Private job identifiers
and protected original fulfillment records are excluded even if accidentally
presented by a store. Historical records without a write-time packet remain
unclassified; existing `query_memories` are never backfilled into this record.

The report retains offered/read/cache/bought/cited counts, Beta(1,1) smoothed
citation rate, a descriptive `1/sqrt(n+2)` uncertainty proxy, mean contribution
over purchases, and an exact rational mean price (integer total/observation
count). It flags a citation-rate difference of at least0.6 between the latest
five and preceding five purchases. This flag is an observation for review, not
proof of abuse. Known owner runs can increment the separate excluded count but
cannot change any eligible measurement.

## Prospective planner and current live boundary

`planLearnedPortfolio` is an offline helper; the deployed orchestrator does not
call it. It reuses the existing `learnedValue` bounded±0.1 update and claim-aware
portfolio, supplies the record in changed value rationales, and halves an update
when the abrupt-shift flag is set. Fewer than five purchases leave value unchanged.
Only positive, already prepared BUY/CACHE proposals can be selected; original
SKIP, authoritative prices and canonical-document deduplication are preserved.

The caller must explicitly supply an exact budget and exploration fraction. A
floor-rounded partition reserves new/rare-source purchases inside that fraction;
the remaining portfolio retains the total budget and attention cap. The helper
has no signer, gateway, ownership resolver, settlement or reward capability.
Tests reject unrepresentable legacy numeric budgets/prices rather than rounding
them into authority. It is not a replacement for live price/payee/session gates.

A controlled 20-record replay supplies fixed independent outcome histories and
counts **actual planner BUY results**, not just value adjustments. The uncited
scenario has an explicit 10% exploration partition: five initial exploratory
buys fall to zero in the later 15 records. A separate consistently cited scenario
with zero exploration starts with zero buys and rises to 15 once five observations
are supplied. Their different declared partitions make these policy-boundary
demonstrations; they do not establish causal exploration benefit or production
purchase rates. The fixed histories are external controlled inputs, not an
endogenous learning experiment or new real traffic.

Live exploration is explicitly 0% / 0 USDC, with selection withheld. Legacy
`query_memories` lack the actor/funding/owner exclusion record and are removed
from the public live decision prompt. Their existing telemetry storage and pure
historical-summary helper remain available for offline inspection; it is unsafe
to interpret that positive history as independent creator reputation. This
intentional hardening may change later model proposals relative to old prompts.
Existing hard budget, signer, payee, price, evidence and reward paths remain the
authorities and are covered by the orchestrator regression suite.

## Supported surfaces and remaining gates

| Surface | Candidate role / boundary |
| --- | --- |
| Web | Creator SSR panel renders the same shared aggregate as the public API. Ordinary public runs capture the observational packet. |
| API / OpenAI / A2A | Shared public orchestrator capture; no caller-provided classifier or exploration option. Dedicated keyless read endpoint and OpenAPI contract. |
| Remote and stdio MCP | Same strict read-only tool/response. Stdio performs a bounded credential-free GET; new package publication is a root release gate. |
| CLI | Ordinary public CLI execution records excluded/unknown/offline observations as applicable. Pure planner replay is offline test authority only; no learning activation or automatic spend. |
| Desktop / native buyer | Existing hosted-reader/public-A2A role shares the server observation where applicable; job-scoped private execution is excluded. No local/native learned signer or scheduler. Installer delivery remains the root release's responsibility. |
| Extension / bots | Existing supported public ingresses inherit server capture. Bot/remote app identity does not prove an independent wallet/cohort. No new client identity field or independent learning implementation. |

Focused tests cover owner/beneficiary exclusion, known-versus-unknown authority,
exact settled-read eligibility, private/legacy exclusion, duplicate/day/window
bounds, abrupt shifts, source-page/API/MCP parity, no-store and uniform failures,
actual planner purchase replay, hard budget/attention, exploration fraction and
canonical aliases. Adapter tests verify additive JSON retention in isolated
SQLite and intercepted synthetic Supabase; they do not prove hosted migration,
outside demand, chain settlement or production acceptance.

Keep live selection/rationale criteria open until a privacy-reviewed,
independently attested actor/funding/owner adapter, common-control/Sybil monitoring,
accepted observation period, prospective atomic allowance/price/payee binding,
controlled live usefulness and unchanged safety regressions are demonstrated.
An excluded wallet or an abrupt-shift flag alone does not establish Sybil
resistance. Exact-source hosted CI, source review, combined deployment readback
and matching package/installer versions precede synchronized delivery claims.
No funding, spending, custody, production DDL, schedules or gated pilot activation
is authorized by this candidate.

## #266 source-only publication integration

Ordinary public scope is not publication authority. Under active admitted privacy,
the shared reader requires the privacy port/schema before source lookup or scanning,
then counts only freshly public/unerased `read().item.state` observations. Both
existing adapters filter the300-candidate iterator before body enumeration; queued
revocation consumes that bound and may underfill, without unbounded refill. Hidden
legacy rows cannot affect historical/excluded counts or actor/day deduplication.
Missing/drifted admission produces API503, SSR unavailable and the shared remote /
stdio MCP error, never a successful empty report. Explicit OFF keeps the admitted
legacy reader. Public per-run JSON and its return type omit internal sourceLearning;
stored originals/authorized exports/digests remain exact until ordinary erasure.

This introduces no learned selection, exploration, capture mode, new allowance or
production DDL/activation. Source-accepted core payloads/modes are inherited unchanged.
Root whole-source privacy review, combined actual CI/canonical selector epoch,
realPG17 and coordinated distribution/delivery remain open. See [run privacy](../run-privacy.md).
