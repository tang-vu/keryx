# Recorded completion latency cohorts

This is the read-only reporting part of [issue #257](https://github.com/tang-vu/keryx/issues/257).
The existing all-completion p50/p95 can include a held original repaired after
52 hours. It must not be presented as the speed of ordinary delivery.

## Records and meaning

`completionLatencyCohorts` splits completions recorded in the last 24 hours into
`ordinary`, `recovered` and `unknown`. Each contains the completed count, count of
valid timing samples, median and nearest-rank 95th percentile in milliseconds.
No sample means `null` timing, not zero. An unavailable storage capability makes
the whole cohort packet `null`; it does not assign every record to ordinary.

Ordinary means journal-v1 execution with a supported v1 package, a matching
completed service receipt and no recorded resolution. The receipt's original
acceptance/start/finish must match the stored chronology. This describes the
retained execution path; it cannot establish that no unrecorded repair occurred.
An absent, malformed or contradictory marker stays unknown.

Recovered means an explicit retained `repair_completed` resolution, or a
`fulfill_failed_original` resolution with its recorded original-fulfillment
markers. The completion timestamp must match the resolution. Reading the marker
does not independently verify its hashes, source evidence or settlement. Both
repair and original fulfillment remain visible as recovery rather than ordinary
delivery; none receives a shorter clock for the new activity alone.

All timing uses stored `createdAt` to `updatedAt`: original order acceptance to
the recorded completion/update. Later reconciliation or bookkeeping can extend
`updatedAt`, including on a row with an ordinary execution receipt. The receipt
qualifies the recorded path; its `finishedAt` is not this metric's endpoint.
Timing includes queueing and recovery delay. It is not measured from a Circle
settlement timestamp, the first answer, first-user arrival or external acceptance.
The legacy `completionLatencyP50Ms`/`completionLatencyP95Ms` remain unchanged and
continue to mix every completed path. An invalid creation time or inverted
chronology counts the completed record but contributes no timing sample.
Future and out-of-window completion records remain excluded by the existing
window. Running/failed jobs never become completed timing samples.

## Storage and migration boundary

SQLite reads existing order columns and extracts only receipt/marker metadata;
it does not return private response bodies, orders, payer, question or hash
identifiers. Malformed legacy JSON degrades its path to unknown. There is no
schema change, backfill or write during observation.

Ordinary Supabase uses the existing service-role-only
`operator_public_snapshot_v1` RPC for both public Operator and health operations.
[Migration 0082](../../supabase/migrations/0082_operator_completion_cohorts.sql)
adds whole-database cohort aggregation to that function. It replaces no table or
stored order and does not reconstruct historical markers. Whole SQL counts are
never enriched with a capped REST page. An older RPC response remains accepted
with the cohort packet unavailable.

The enrolled PostgreSQL `a2a_operations_snapshot` contract returns only the
existing four status/time fields. This source keeps that sealed contract intact:
cohorts remain `null`, and there is no REST fallback. Enrolled
`operatorPublicSnapshot` remains unsupported. Applying 0082 to a protected
PostgreSQL target, changing its marker read contract or enrolling its public
snapshot requires a separately reviewed storage migration/profile proof. This
candidate neither applies production DDL nor changes a contract digest or
runtime deployment manifest.

## Supported surfaces

| Surface | Reporting boundary |
| --- | --- |
| Web `/operator` | Separate ordinary, recovered and unknown timing rows; unavailable capability stays explicit. |
| API `/api/operator/status` and `/api/health` | Identifier-free shared cohort packet; old mixed fields preserved. OpenAPI describes its timing basis. |
| Remote and packaged stdio MCP | Existing read-only `keryx_operator_status` carries the shared packet and its limitations. |
| Desktop, CLI, extension and bots | Shared public API/MCP observation is available. Their owner-specific job polling, receipts, research and recovery remain unchanged; there is no new action or notification. |
| A2A and Monthly job status | Original package/service receipt and payer-scoped status remain unchanged. Cohorts grant no execution, ownership or refund authority. |

## Validation and remaining acceptance

Focused synthetic checks cover ordinary 1/3-second records, a 52-hour saved-result
repair, original fulfillment, unknown legacy paths, missing/conflicting markers,
invalid chronology, private-data omission and read-only real SQLite observation.
The existing isolated PostgreSQL acceptance entry applies the actual migration,
retains 1,201 queued orders/sources, compares SQL cohorts with the TypeScript
projection and checks malformed marker refusal and service-role-only ACLs.
It does not contact a vendor, provider or production datastore. Static source or
mocked RPC checks are not an actual PostgreSQL execution proof.

Release requires exact-head aggregate and applicable storage/Operator CI,
TypeScript, independent review and the root-coordinated runtime release. Supabase
production migration/enrollment and actual deployed browser/API/MCP readback
remain separate gates. No runtime version or deployment is changed here.
Packaged stdio MCP embeds the strict shared status schema. Its compatible
package must be released with this server field; an older strict client may
report observation unavailable. This candidate does not claim synchronized
published packages or installers.

Issue #257 remains open. Existing Quick/Deep package targets are provisional
180/300-second SLOs with `remedy:none`; this report does not promote them to an
SLA. [Observed customer overdue state](paid-job-overdue-escalation-257.md)
adds request-time escalation-needed metadata and a visible customer alert,
including when an original creator leg remains uncertain. Background delivery,
staffed escalation, a guaranteed target-window observation, a first-user
time-to-first-answer measure, and a wait/partial/refund choice with confirmed
support/refund ownership remain open. Observation never retries research,
signs, purchases, releases a hold, refunds, starts a scheduler or changes the
original payment/recovery rules.
