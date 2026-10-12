# Private observation of overdue original jobs

This continues [issue #257](https://github.com/tang-vu/keryx/issues/257) after the
existing [customer overdue state](paid-job-overdue-escalation-257.md) and
[ordinary/recovered latency cohorts](completion-latency-cohorts-257.md). The
remaining issue criteria stay open; this command creates no background service.

The [default-OFF worker deadline observer](paid-job-deadline-alerts-257.md) reuses
the existing hosted worker cadence and dedicated ops transport. This CLI remains
read-only and never sends; actual private-channel/customer delivery and human
response qualification still gate the original issue.

## Operator command and evidence

Run `npm run operator:overdue` in an explicitly configured operator environment,
or `npm run operator:overdue -- --limit 50`. It does not load `.env.local`
automatically. It opens only the selected enrolled read-only application storage,
then closes that reader. Missing enrollment or an unsupported protected backend
refuses observation; no ordinary writer, alternative datastore, initialization
migration or schema installation fallback is admitted.

Private JSON lists running and failed original orders whose immutable accepted
target has passed, with original order ID, original payment/allocation reference,
recorded network, exact integer micro-USDC amount, last recorded stage and
conservative creator-payment evidence. Failure does not prove that the customer
obligation ended. The original reference describes the retained order; it does
not independently verify inbound settlement. Unsupported timing gets a separate
`timingUnavailable` entry; malformed rows count as `unreadable`. Input, nonces,
worker IDs, raw errors, creator IDs, resolution payloads and saved answers stay
out of the packet. Do not publish it.

Expired pending creator legs remain pending. Failed evidence reads keep
`creatorEvidence:unavailable` and the payment boundary conservative. No claim,
requeue, signature, purchase, reconciliation, hold release, repair, refund,
notification or schedule runs. The packet states `evaluation:on_observation`,
`authority:read_only` and `notification:none`. A person can inspect a listed
original with `npm run review:a2a -- <id>` before separately authorized recovery.
The original purchase never repeats.

Exit status is 0 only for a complete observation needing no attention, 2 for
overdue/untimed originals, unreadable rows or a truncated scan, and 1 when
observation itself is unavailable. Zero applies at that observation time only;
it is neither an SLA nor proof of continuous monitoring.

## Storage and bounded reads

Both ordinary adapters read existing `a2a_orders` fields, select `running` and
`failed`, and order by stored acceptance timestamp then original ID. The scan is
bounded to 1–500 rows plus one sentinel. Ordering retains stored timestamp forms;
it does not normalize cross-offset historical times. Accepted target calculation
uses the existing tested RFC3339 projection. Unreadable originals stay counted.

Ordinary Supabase requests an exact count alongside the bounded REST page. A
server row cap below the request makes `truncated:true`; missing/inconsistent
counts or failed reads refuse an exhaustive conclusion. This is a bounded packet,
not a whole-database aggregate or pagination promise. Later originals can remain
outside the maximum scan, requiring further operator investigation.

Enrolled SQLite registers the method in its reviewed read-only inventory and
retains sealed identity/schema guards. Enrolled PostgreSQL marks it `unsupported`
and refuses before REST/RPC fallback: no accepted sealed whole-queue operation
exists. No production DDL, domain enrollment, contract digest or runtime manifest
changes in this increment.

## Supported surfaces and remaining gates

| Surface | Role |
| --- | --- |
| Operator CLI | Explicit local private inspection through selected read-only storage. |
| Storage/API | Shared optional method and strict private packet; no HTTP route exposes it. Enrolled PostgreSQL refuses. |
| Web/customer history and job API | Existing accepted targets and on-observation overdue state remain authoritative; no customer choice/refund action is added. |
| Public Operator, remote and stdio MCP | Existing aggregate/cohort and GET-only original recovery roles remain unchanged. Individual queue/payment references stay private. |
| Desktop, extensions and bots | Existing shared status/recovery roles continue; no dedicated queue UI, notification, schedule or authority. |

Focused checks cover physical read-only SQLite with queued/started/failed,
completed and corrupt rows; Supabase exact counts/server caps/refused reads;
protected backend refusal; CLI reader disposal/exit statuses; the original clock;
and an overdue expired-but-pending creator leg without mutation or paid retry.
Synthetic fixtures/transport stubs establish no vendor settlement or production
PostgreSQL execution. Actual test/typecheck/build results belong to the PR.

Hosted aggregate and applicable storage/Operator review remain merge gates.
Root coordinates combined runtime release, distribution, deployment and actual
readback; this source claims no synchronized delivery. Automatic alerts, staffed
escalation, guaranteed target-window observation, first-user/time-to-first-answer
metrics, sealed PostgreSQL queue enrollment and wait/partial/refund requests stay
open. The [owner-confirmed remedy policy](../research-delivery-remedy-policy.md)
governs that separate work; no new refund rule or execution is introduced here.
