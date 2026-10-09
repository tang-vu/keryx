# Observed paid-job overdue state

This implements the request/status observation part of [issue #257](https://github.com/tang-vu/keryx/issues/257), alongside the separate [completion cohorts](completion-latency-cohorts-257.md). The issue remains open for the remaining product and operational gates below.

## Target and original clock

The existing immutable Quick/Deep v1 package defines a provisional 180/300-second completion target from original order acceptance (`createdAt`). These targets are already visible before payment in Research pricing and x402 discovery. This change does not alter a package fingerprint, purchase, spend cap or financial remedy. Queueing, pauses and recovery consume the same clock; updates and repair never restart it. A target is exceeded only after its exact deadline, with `remedy:none`.

`paidJobEscalation` is pure: it receives an original order, an explicit observation clock and optional recorded creator attempts. No timer, scheduler, notification, retry, signature, purchase, reconciliation, release of a hold or refund runs during evaluation. `escalationNeeded:true` means that the observed overdue original needs human review. It does not assert that a person was notified, support is staffed or a response is guaranteed within a window.

Absent/unsupported package provenance, invalid/future acceptance or invalid observation leaves timing `unavailable` and escalation necessity `null`. SQLite and Supabase adapters retain stored timestamp strings. Calendar-valid RFC3339 forms with UTC offsets and up to nine fractional digits are accepted; nonzero sub-millisecond acceptance rounds upward by at most one millisecond to avoid an early alert. Such precision cannot establish checkpoint ordering, which stays unknown. Malformed/inverted checkpoints also stay unknown without suppressing an independently known overdue acceptance clock.

The stage is the last retained execution checkpoint, not a claimed root cause. Failure codes are limited to the existing reviewed allowlist. Pending creator legs stay pending after authorization expiry. Missing or definitive rows cannot prove that every call after a payment boundary has resolved. Foreign network/query/payer, duplicate leg identifiers, invalid chronology, conflicting settlement state, simulated rows, unsafe/nonexact amounts and cap violations yield unknown evidence. Original owner amounts use exact integer micro-USDC; absent recorded network never inherits the current deployment profile.

## Surface and privacy boundaries

| Surface | Behavior |
| --- | --- |
| Authenticated `/api/me/jobs` and Research account jobs | Durable SIWE owner is checked before per-query evidence reads. Strict additive optional `escalation` and `originalPayment` fields expose only that owner's original order/payment reference, recorded network, exact micro-USDC amount and bounded last stage. Private nonce, worker, raw errors, creator identifiers and retained response are omitted. `no-store` remains required. |
| Existing bearer `/api/agent/ask?queryId=…` and Research job details | Pending/failed observations include nonprivate `escalation`. The existing query capability still controls access. No owner payment reference, payer, worker or input is added. Pending status may describe a crossed payment boundary without reading creator rows. |
| Completed API responses, portable receipts and original/native proofs | Dynamic observation is kept outside retained completed response/receipt. Completed polling projection and original evidence functions remain unchanged. Owner history can show a closed observation, independently of the immutable receipt. |
| Packaged stdio MCP `keryx_recover` | Existing GET-only recovery forwards pending/failed observation JSON and preserves the original admission journal. No tool or signing flow is added. Release/distribution verification remains coordinated with the server. |
| Public Operator/health and remote MCP `keryx_operator_status` | Existing identifier-free aggregate/cohort contract stays unchanged. No individual overdue order or payment reference enters public metrics. Remote MCP has no new owner-specific paid-job role or authority. |
| Desktop, CLI, extensions and bots | Existing status/API or stdio recovery consumers can observe the additive packet. No new dedicated notification or action is claimed. Existing original recovery and receipts remain authoritative. |

An unavailable creator-evidence read degrades its description conservatively; it does not invoke another adapter, mutate a row or infer settlement. Existing payment/owner checks and native sealed storage capabilities remain intact. This is compatible with the separately owned personal-history contract; combined source and distribution still require release review.

## Validation and remaining gates

Focused tests cover an overdue original with an expired-but-pending creator leg, exact target boundary, queue/recovery clock retention, unsupported provenance, storage timestamp forms, malformed/foreign/duplicate evidence, strict old/new packets, authorized real SQLite history reads, public omission, read-only API behavior, presentational alert semantics and GET-only MCP journal preservation. Final exact-source checks, both TypeScript graphs, lint, default physical production build, independent review and hosted aggregate are acceptance gates, recorded with their actual results in the PR/evidence rather than inferred here.

Wait, partial delivery and refund choices require a separately confirmed product/refund policy and owner. Automatic/background alert delivery, a staffed escalation/oncall service, a guaranteed target-window observation, first-user/time-to-first-answer metrics, protected native adapter enrollment and deployed browser/API/MCP/package readback remain open. Existing original recovery must never require a second buy or signature. This candidate changes no runtime version, database schema, production configuration or deployment.
