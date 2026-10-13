# Original paid-job completion targets

Source follow-up for [issue 257](https://github.com/tang-vu/keryx/issues/257).
This increment fills checkout/Monthly consent and open-page visibility gaps in
the existing target, cohort and overdue implementation. It does not establish
live target-window delivery or close the original issue.

## Before payment

| Supported package | Provisional completion target | Clock |
| --- | --- | --- |
| Quick v1.0.0 | 180 seconds | Original job acceptance |
| Deep v1.0.0 | 300 seconds | Original job acceptance |
| Monthly v1 Deep request | 300 seconds per accepted request | Request acceptance, not plan purchase |

The shared target notice reads the existing versioned package registry and
appears before checkout funding/payment controls, again in the reviewed
single-job terms, and before Monthly consent/payment. Unsupported versions show
target unavailable. Targets remain provisional SLOs, not guarantees; existing
`startsAt:accepted_at`, `remedy:none` package fingerprints are unchanged. Private
research has a distinct accepted contract and receives no invented target from
the public Quick/Deep registry.

## A page that stays open

Previously, a retained `within_target` status could remain silent after the
deadline if nobody fetched status again. The shared customer escalation component
now schedules one local display timeout from its validated server observation
and monotonic browser elapsed time. It checks the original accepted target,
never the order's latest update, repair activity or payment expiry. An exact
deadline is still within target under the existing receipt contract; the warning
starts on the first millisecond after it. Returning to a visible page reevaluates
the elapsed clock. A newer/terminal snapshot cancels the previous timer.

The warning says **the target elapsed since the last status check**. It explicitly
does not establish current delivery/payment state or notification of a person.
The original server snapshot remains unchanged, including pending/unknown legs.
Invalid, unsupported or contradictory timing is not converted to an overdue
assertion. Browser wall-clock skew cannot cause an early warning. A slow incoming
response, closed/suspended page or unavailable browser execution still prevents
a timely display; this mechanism is not a background notification service or SLA.

The overdue view offers Wait, Partial-result guidance and Human-review guidance.
These are local guidance choices, explicitly labelled as such: no request is
submitted, saved, sent to support or used to resume execution. A partial result
is neither promised nor labelled complete; an owner must review retained output
as explicitly incomplete. Human-review guidance asks for private original-job,
payment-reference and stage evidence. There is no refund action or invented
refunded state. The current worker assignment says refund policy remains
owner-unconfirmed; historical policy prose does not authorize prospective terms,
refund execution or changes to accepted packages in this increment.

## Existing public metrics and operational alert

The unchanged Operator packet/UI reports ordinary, recovered and unknown paths
separately, with completed counts, valid timing sample counts, median and p95.
Empty samples remain null; unavailable backend capability remains unavailable.
Timing is **original acceptance to recorded completion/update**, not verified
payment settlement to externally delivered output or first-user first-answer
time. Later bookkeeping may extend it. The legacy mixed percentile is not an
ordinary-run performance claim. See the [cohort contract](engineering/completion-latency-cohorts-257.md).

The existing [paid-job observer](engineering/paid-job-deadline-alerts-257.md)
remains default OFF. Its private alert retains original order/payment reference,
stage and conservative creator-payment evidence, and suppresses ambiguous
transport replay. This worker changes no `lib/notify` paths while language 276
owns them. No ENV, channel, human responder, worker cadence or schedule is bound
or activated here. No customer push address is invented.

## Surfaces and checks

| Surface | Source behavior / boundary |
| --- | --- |
| Web checkout and Monthly | Supported target notice before payment/consent, original acceptance basis and provisional terms. |
| Web bearer jobs, saved jobs and payer history | Existing shared escalation component gains the local clock warning and guidance. Owner-only references remain in the existing owner projection; the bearer view gains none. History 268 paths are untouched. |
| Public Operator/API/health and remote/stdio MCP | Existing count-qualified ordinary/recovered/unknown contract is preserved; no new public status field, identifier or tool. |
| Research CLI / Monthly CLI / API buyers | Existing quote packages and original-only status/GET recovery remain authoritative. No new paid call, replay or remedy endpoint. |
| Desktop / extension | Existing research workspace and shared API/MCP roles remain. Root verifies applicable combined-source delivery; this source does not claim published/installed identity. |
| Bots / notifications | Existing default-OFF private alert and status roles are retained; language 276 owns scaffolding. No new message or contact. |
| Private research | Existing private terms and owner-only original recovery remain; no public-package target is projected onto them. |

Focused tests cover supported versions, immutable original clocks, exact deadline,
expired-but-pending creator legs, malformed/terminal timing and existing cohort,
overdue and alert regressions. A hermetic Chromium fixture bundles the actual
component and intercepts every request at 320/1366 pixels. Its foreign wall clock,
deadline crossing, guidance choices and completed/new observation transitions
exercise real React effects without a server, provider, secret or payment rail.
The fixture demonstrates source behavior, not production timeliness or settlement.

## Root admission and original remaining gates

Root owns independent review, focused PR push, actual required aggregate/domain
CI, merge order and the combined release. Local checkpoints alone do not require
another full suite. Hosted batching is not implemented; existing PR aggregate
and full exact-main-source publication gates remain required. No push, merge,
version, deploy, activation or issue closure is performed by this worker.

Original issue 257 remains OPEN until root qualifies a permitted live private ops
channel and human responder, a customer delivery path including closed pages,
and target-window observation/transport/backlog handling on the selected backend.
First-user first-answer and payment-to-delivered-output telemetry are unavailable,
not zero or inferred from acceptance/update time. Persisted customer remedy
requests, prospective remedy consent and any refund require their own reviewed
authority. No retry, sign, buy, reconciliation, hold release, refund, production
DDL/backfill, custody, ENV, schedule or App54 UNBOUND execution is introduced.

## Scoped successor adapters awaiting acceptance

The successor keeps a small read-only adapter in `lib/operator/job-targets.ts`.
`jobCompletionMetrics` names the existing whole operations snapshot's basis as
original acceptance to recorded completion/update in the last 24 hours. It keeps
ordinary, recovered and unknown completed/sample counts separate, including the
full original delay for held/repaired jobs. Missing capability, inconsistent
totals, unsafe counts or contradictory percentiles stay unavailable. At this
adapter, absent/null cohort capability makes both `recordedCompletion.completed`
and `recordedCompletion.cohorts` null, even for a valid legacy aggregate total of
six. The existing producer and public schema keep their independently known
`completedLast24h` aggregate unchanged. This is the conservative scoped adapter
requirement; root may explicitly revise it during admission. A valid empty
snapshot with cohort capability has zero completed/sample counts in all three
cohorts and null percentiles. Legacy zero/null cohorts, missing input and malformed
input remain unavailable rather than measured empty. Transaction references,
creator-leg timestamps, service completion and supplied-corpus usage latency do not supply missing
original inbound settlement/customer delivery or first-user arrival endpoints.

`jobAlertDeliveryObservation` preserves the existing observer's measured coverage
and transport counters. OFF, unbound and failed observations have null counters.
An acknowledged transport, suppressed reservation or unknown transport cannot
prove responder receipt, customer state delivery on a closed page or timely
coverage. Those fields remain null, and the adapter grants no automatic resend.
It is an aggregate adapter, not evidence for any particular original job.

Successful observations must account for each overdue original using the existing
producer's branches. Let `R = overdue - acknowledged - suppressed - deferred`:
`R >= 0` and `R <= unknown <= R + suppressed`. New attempts are acknowledged or
unknown; retained reservations are suppressed and may also be unknown. Deferred
originals have no transport outcome. These bounds permit suppression/unknown
overlap and refuse missing outcomes or deferred/unknown double counting. Deferred
entries require partial coverage. Complete empty scans may have measured zeros;
partial scans can also have zero overdue entries when truncation, unreadable rows
or unavailable timing prevents complete coverage. Neither case establishes
target-window delivery. Invalid integer counters remain unavailable.

The existing customer escalation component consumes `jobTargetCustomerState`
to distinguish retained completion/overdue state from a local stale warning and
to refuse contradictory original acceptance/deadline clocks. Original references,
pending legs and local-only guidance are unchanged. These helpers add no public
schema, storage writer, contact, cadence or notification path. The aggregate
metrics/observer call sites still require a root-assigned integration partition.

New offline fixtures cover count/percentile refusal, a 52-hour recovery, later
bookkeeping, unsupported capability, uncertain transport and contradictory
customer timing. Their focused check attempt was refused before execution by
PowerShell's disabled-script policy (`PSSecurityException`, `UnauthorizedAccess`).
No alternate runner or policy change was attempted. The successor source and
fixtures remain unvalidated; earlier 82-test, browser and type/lint evidence
applies only to its unchanged source/input scope. Root must independently review
and admit any later check and integration action. Original issue 257 remains OPEN.

The source-only review correction adds producer-derived missing-outcome,
deferred/unknown, overlap lower/upper boundary, empty/partial scan and invalid
integer fixtures. Separate completion fixtures distinguish the unchanged legacy
aggregate six/null cohorts, missing input, malformed input and an empty snapshot
from the actual operations summarizer with cohort capability. These fixtures are
synthetic and **UNRUN**. No observer producer or test runner was invoked for this
correction; the prior native refusal remains retained. Different source/control/
environment review and lawful root validation are still required.
