# Internal research workload and delivery backlog

Owner-requested on October 4, 2026. [research-workload.json](research-workload.json)
contains 24 concrete agent-authored tasks with an expected artifact and acceptance
criteria. They are internal evaluation scenarios, not independent customer jobs.
All start as specified, not executed. No source/LLM request, payment, schedule or
new spending authorization follows from preparing this pack.

The [mainnet update flow](mainnet-update-flow.md) governs execution and release.
Production remains on mainnet. Use offline fixtures for adverse cases and a
separate staging/testnet environment for relevant integration work. Public-source
research can spend zero source USDC but still consume model/search quota.

## Work queue

| Task IDs | Work | Intended artifact |
| --- | --- | --- |
| R01-R08 | Database choice, webhooks, queues, SDK migration, rate limits, vector search, dependency advisory, extension permissions | Decision briefs with assumptions and verifiable support |
| R09-R14 | Exact-paper comparison, abstract-only access, conflicting policy, copied sources, unreadable PDF, changed document | Evidence matrices with honest read and coverage limits |
| R15-R18 | Educational video ideas, script checking, documentation gaps, product offers | Actionable drafts/checklists with proposals separate from facts |
| R19-R24 | Creator onboarding, changed payout authority, lost settlement response, paid delivery failure, Monthly replay, cross-surface recovery | Controlled acceptance records and preserved originals |

Input-dependent tasks remain awaiting those inputs; do not invent a customer's
draft, installed dependency version or commercial terms. For R09 use the actual
original-paper identities from [issue #128](https://github.com/tang-vu/keryx/issues/128).
Do not replace missing paper evidence with the model-only fixture corpus.
R20-R23 are fault-injection scenarios, not permission to trigger adverse mainnet
payments. R24 must label unsupported adapter operations as handoffs.

The October 4 baseline used D-300's qualified-excerpt delivery. On October 6 the
owner superseded unconditional excerpt-only output with
[sentence-cited summaries](engineering/cited-summary-2026-10-06.md). Current
checked-in JSON-engine delivery can retain a model-written sentence only when its
one excerpt passes the evidence ledger and the separate review accepts the whole
sentence; the sentence is paired with that verbatim excerpt. If no sentence
survives, or the engine does not implement this contract, qualified excerpts and
gaps remain. These model judgments do not certify correctness or complete synthesis.
Confidence remains Low and creator reward authority stays in the evidence ledger.

The reviewed decision brief remains disabled. Cross-source comparisons,
recommendations and complete checklists are still unmet deliverables, even when
every target has an excerpt or a summary sentence. Record provenance, intended
artifact acceptance and independent usefulness separately; completed HTTP requests
are not completed research. These code facts do not establish current production
availability, new live acceptance or an additional model/search allowance.

## Prioritized development backlog

All implementation items below are proposed/open unless a dated record explicitly
says otherwise. Each is a separate bounded update with its own acceptance evidence.

| ID | Priority / dependency | Change and completion gate |
| --- | --- | --- |
| B01 | P0, first | Correct the post-mainnet update/deploy documentation; remove direct-main and legacy provisioning shortcuts. Reviewed commands must agree with the current script. |
| B02 | P0, first | Freeze these 24 internal task specifications and review criteria. Structure validation is not execution or usefulness acceptance. |
| B03 | P0, before output changes | Record current offline regression results and a bounded staging baseline for R01/R09/R11/R15. Keep missing staging, inputs and quota open. |
| B04 | P0, after baseline | Design assertion-complete handling beyond the current sentence-cited summary for the requested comparisons, decisions and checklists: omitted claims, negation/numbers, contradictory sources and unsupported recommendations. Independent review; coverage or a model score alone cannot establish a complete useful artifact. |
| B05 | P0, after B04 | Implement the accepted bounded synthesis slice beyond sentence-cited summaries; retain excerpt/gap fallback and existing payment authority. Pass adversarial fixtures and actual task acceptance before enabling that richer output. The current summary and disabled decision brief do not close this gate. |
| B06 | P0, parallel scope | Improve original-document discovery/read yield using observed R09/R10/R13 failures. Preserve exact versions, bounded reading and explicit unavailable/truncated states. |
| B07 | P1, after baseline | Make empty/partial outputs actionable with task-specific next steps. No automatic paid retry or suggestion that more USDC fixes unreadable free documents. |
| B08 | P1 | Deliver a reusable comparison/evidence export from R09/R11/R14 with exact source/version and missing fields; no new purchase on export. |
| B09 | P1 | Rehearse creator onboarding on a controlled feed in staging/testnet. Mainnet supply requires a legitimate owner, rights, fresh registry authority and separately authorized operation. |
| B10 | P1 | Exercise R20-R23 across process interruptions and retained histories. Verify no double debit, lost liability or fabricated refund; independent payment review. |
| B11 | P1 | Check R24 on every applicable supported surface; publish changed packages/installers with actual version/integrity readback. Keep thin-client role boundaries. |
| B12 | P1, after usable output | Observe real-user task acceptance and repeat use with consent and authorized recruitment. Measure review time and full operating cost privately; internal tasks cannot close this gate. |

B03/B06/B07 directly support the already-open issue #128 rather than replacing its
live usefulness and export gates. Repeated independent demand remains an external
validation task even if all 24 internal scenarios pass.

The October 8 [source-recency proposal](engineering/source-recency-2026-10-08.md)
adds the observed newest-release failure in issue #217 to B06/B07. It stages
source-scoped eligibility before an article toll, explicitly retained-set ordering,
and a qualifying current-feed observation. Sorting publication dates alone cannot
establish current newest. The narrow Stage1 safety candidate withholds affected
retained articles and reports unresolved original scope before article selection;
qualified observation, useful delivery and actual release acceptance remain open.

October 4 follow-up: [B06/B07 candidate and measured limits](engineering/research-quality-2026-10-04.md)
records 22/22 public URL captures and 18/18 offline pipeline completions, targeted
read-recovery guidance, independent reader review and remaining release gates.
Those counts do not close B04/B05 usefulness or B12 independent-user acceptance.

The separately approved [live comparison and evidence follow-up](engineering/research-evidence-follow-up-2026-10-04.md)
retains 14/18 initial pipeline completions, a distinct usefulness assessment and
observed exact-paper/context defects. Correcting those defects does not retroactively
change the initial outputs or prove complete autonomous synthesis.

## Record each execution

Keep raw reports, questions with private context, receipts, user identities and
actual economics outside tracked files. Publish only authorized sanitized summaries.

Record: task ID and revision; source commit; environment/network; synthetic/internal/
independent origin; corpus/source versions and read limits; model/provider configuration;
approved request/cost envelope; baseline method; discovery/read/model/end-to-end time;
human verification and assistance time; artifact/receipt digest; source correctness;
decision usefulness; unresolved material errors; source payments classified as
simulated/settled/pending/failed/unverified; operator/user acceptance; next action.

Use distinct outcomes:

- specification ready;
- blocked on input/environment/budget;
- executed, review pending;
- source/evidence boundary passed or failed;
- intended deliverable accepted or rejected;
- independent user acceptance/return observed or still unknown.

A baseline or score needs a denominator, fixed rubric and reviewer identity/role.
For comparative runs retain the same corpus/task/model constraints or state their
differences. Do not claim causality, average latency, savings or repeat demand from
a handful of favorable examples. Keep failed runs and assistance in the record.

## Start without live spending

The existing hermetic agent evaluator uses frozen sources, an in-memory database,
HeuristicEngine and OfflineGateway. From the exact candidate checkout with
compatible installed dependencies and no live environment loaded:

    node --import tsx scripts/eval-agent.mts
    node --import tsx scripts/eval-research-boundary-corpus.mts --check

The first runs the existing frozen regression corpus, not these 24 live tasks.
The second checks four fictional fixture structures only. Neither is a substitute
for discovery, real model synthesis, paid integration or participant acceptance.
Do not add --model or --live without reviewing provider usage and a finite run
allowance. These commands create no autonomous background workload.

## Initial checkpoint

This checkpoint is historical. The subsequent [execution report](engineering/research-workload-2026-10-04.md)
records real-model attempts for R01-R18 and isolated synthetic scenarios for R19-R24,
including failures, usefulness review and the remaining live/user gates.

The specification and deployment-doc correction are the first deliverables.
On October 4, 2026, the existing six-case heuristic regression suite passed with
zero hard failures against runtime source b71789b; the four fictional boundary
fixtures passed structure validation. Node 24.12.0 used existing dependencies;
no installation or lockfile change was made. The isolated evaluator used
in-memory data and simulated payments, with no real model/search/settlement call.
The default heuristic baseline comparison passed. These results do not execute
the new 24-task pack or measure research usefulness.

The new pack passed a 24-unique-ID/required-fields/internal-authority check, all
12 backlog IDs are present, and relative documentation links resolve. Independent
review and required CI remain the merge gates for B01/B02. B03's actual staging
baseline and all live task outcomes remain open.
