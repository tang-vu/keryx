# Worker observation of paid-job deadlines

This is the source follow-up for [issue257](https://github.com/tang-vu/keryx/issues/257).
It removes customer status GET as the only route to detecting an overdue original
and attempting a private human-review alert. **Default OFF; no channel is bound or
activated by this change. The original timely-delivery criterion remains OPEN.**

## Existing cadence and authority

The hosted A2A worker's existing 30-second Operator heartbeat also invokes the
paid-job observer, including while research awaits I/O or a hold has no heartbeat.
One observation runs at startup under the existing single-host worker lock. No new
timer, scheduler, daemon, paid execution cycle or PM2 role is introduced. The
worker drains an already pending observation at shutdown. A stopped worker,
blocked event loop, unavailable storage or slow observation defeats timeliness;
the interval alone is not a target-window guarantee.

The observer is enabled only by the exact startup value
`KERYX_PAID_JOB_ALERTS_ENABLED=1`, separately authorized by root. Without it there
are no observation reads, metadata writes or channel calls. Even when requested,
missing/incomplete dedicated ops configuration refuses before reading orders.
The existing `KERYX_ALERT_WEBHOOK` and/or dedicated
`KERYX_ALERT_TELEGRAM_BOT_TOKEN`/`KERYX_ALERT_TELEGRAM_CHAT_ID` transport is reused.
There is no fallback to a public bot, another chat or an invented customer contact.
This document grants no ENV change, activation or message-sending authority.

## Original clock, privacy and idempotency

The existing strict queue projection evaluates immutable Quick/Deep 180/300-second
targets from original acceptance. Failed undelivered jobs remain eligible, and an
expired pending creator leg remains uncertain. Only the selected worker's recorded
network and provider are considered; missing scope makes coverage partial. Reads
are capped at 50 originals and four automatic alert attempts per observation.
Truncation, corrupt/untimed rows, missing original references or deferred alerts
remain explicit. No whole-queue or completion-time promise is inferred from a cap.

Each original/network has one stable incident digest, independent of subsequent
stage/timestamp changes. The existing `sync_state` methods retain a private
`paidJobDeadlineAlert:<digest>` reservation **before** the transport call; no
schema change or migration is needed. Only this metadata is written. An acknowledged
record suppresses later sends across worker restarts. A crash, failed post-send
write, corrupt state, partial transport result, timeout or exception remains
attempted/unknown and also suppresses automatic resend. Root must inspect the
retained incident/channel evidence before any separately authorized manual action;
there is no reset, auto-clear, retry or refund endpoint.

This is single-writer idempotency, not atomic exactly-once delivery across a database
and external channels. A crash after reservation can lose delivery. Transport
acknowledgment means all configured channels accepted the request; it is **not**
proof that a person read it or a customer received state. The private event carries
only original order/payment-or-allocation reference, recorded network/exact integer
micro-USDC, target/observation times, bounded failure stage and conservative payment
state. No question, payer, nonce, worker, creator identifier or saved response is
sent. Private detail is omitted from process logs; no individual event enters
public Operator/health metrics or MCP aggregates. Channel errors are not logged.
The worker reports changing closed observation counts/status, including unbound,
partial or unknown delivery, without logging original references or private detail.

## Supported roles

| Surface | Role in this increment |
| --- | --- |
| Existing hosted A2A worker | Default-OFF observation/private ops alert inside its existing lock/cadence; no paid claim/retry or hold release. |
| Web, owner API and bearer job API | Existing on-read overdue customer state remains; no customer push channel or remedy action is added. |
| Private Operator CLI | Existing explicit read-only queue remains available; running it does not send an alert. |
| Public API/Operator and remote MCP | Existing identifier-free ordinary/recovered/unknown cohorts; zero samples still mean null timing. |
| Stdio MCP, research CLI, Desktop, extension and bots | Existing original status/GET recovery and receipt roles remain; no new tool, authority, notification or signing path. |

Payment, custody, owner checks, original grants, finite money, package fingerprints,
uncertain legs, schedules and default-OFF feature authority remain unchanged.

## Validation and actual activation gate

Focused offline ArcTestnet tests cover the exact deadline, failed originals with an
expired pending leg, scope refusal, OFF/unbound behavior, overlapping observations,
durable reservation before send, ambiguous delivery/restart suppression, capped
reads/attempts, private logging and physical SQLite reopen with unchanged original
order/payment rows. Synthetic transports prove the contract, not actual notification,
human receipt, settlement, production enrollment or target-window delivery. Existing
latency/overdue regression evidence is reused only for unchanged source/inputs.

Before activation, root must independently review/release the exact source and
qualify the selected backend's existing read/sync-metadata capabilities and single
writer lock. Bind an explicitly authorized **private ops** channel and a human
responder; record actual acknowledged delivery and the responder's handling of
original reference/stage. Also bind a permitted customer-state delivery path;
the ops channel is not customer notification. Qualify observed cadence, storage/
transport bounds, backlog coverage and failure handling while an original awaits
I/O, including failed jobs and closed customer pages. No paid trial or new customer
is required merely to keep empty samples unavailable. If the existing cadence/
channel cannot meet the original timely criterion, keep it OPEN and stage that
specific delivery gap; do not advertise a staffed alert or SLA.

The release owner coordinates CI/review/merge/distribution/deployment and
separately authorizes any later activation. Source acceptance is not delivery.
