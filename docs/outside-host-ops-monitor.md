# Outside-host health monitor and incident response

The isolated `cloudflare/ops-monitor` Worker observes Keryx from Cloudflare,
independently of the VPS, desktop app and hourly source-upkeep scheduler. Its only
scheduled application request is GET `https://keryx.cc/api/health`. An explicit
diagnostic also reads one fixed unavailable URL. It cannot buy
content, sign, reconcile, settle, restart services or mutate jobs. The existing
`keryx-source-upkeep` Worker, its hourly minute-7 trigger and two-feed limit remain
independent.

## Observed acceptance — September 30, 2026

PR [#56](https://github.com/tang-vu/keryx/pull/56), reviewed monitor head `b31eb56`,
passed [Linux monitor CI](https://github.com/tang-vu/keryx/actions/runs/36739064902)
and [full repository CI](https://github.com/tang-vu/keryx/actions/runs/36739064692).
The dedicated `keryx-ops-monitor` Worker was deployed on Workers Free with its
SQLite-backed Durable Object and `*/5 * * * *` Cron. Existing Workers and the
source-upkeep minute-7 hourly schedule were preserved; no subscription upgrade occurred.

The actual off-host diagnostic consumed one real healthy control read, three fixed
HTTPS 404 reads and two real healthy reads. It completed one stable fixture incident,
with both outage and recovery delivery records `confirmed` on their first attempts.
The owner confirmed receipt of both Telegram **[DRILL]** messages and accepted the
alert-response role. The separate production Durable Object was healthy with no
incident. Diagnostic notifications were disabled afterward in deployed version
`70f2eee7-8bb6-43f1-a082-3574819be83b`, retaining the consumed fixture state.

Actual scheduled execution was also observed: a sanitized Cloudflare live tail
reported Cron `*/5 * * * *` at approximately `2026-09-30T16:00:41Z`, outcome `ok`,
on that production version. With no manual POST since the initial `15:53` probe,
authenticated status then reported `checkedAt: 2026-09-30T16:00:43.993Z`, `healthy`,
two successful production observations and no incident. The tail was stopped;
no additional alert was sent. This verifies a real scheduled sample beyond deployment
configuration, without establishing sustained availability or punctual delivery.

This accepts the fixed-route external detection/classification, durable incident
transitions, actual notification delivery and owner response boundary. Real VPS
outage, transport/DNS failure, failover, service restoration and sustained scheduled
operation need separate evidence. A later withdrawal provisioning incident also
exposed an unsynchronized VPS clock: a corroborated one-time forward correction
restored freshness checks, while durable NTP synchronization remains open. See the
[funded withdrawal evidence](engineering/creator-funded-withdrawal-drill.md) and
[native VPS time diagnostic](engineering/vps-time-diagnostic-2026-09-30.md).

## Readiness and notification contract

- Cron runs every five minutes (`*/5 * * * *`), normally 288 probes per UTC day.
  A durable monotonic slot is claimed before I/O. Repeated or overlapping calls
  cannot produce a second probe in the same slot. Old/future scheduled calls fail
  closed; missed calls are not replayed. Gaps longer than ten minutes reset sample
  streaks. Trigger timing and delivery are provider best effort.
- One pinned HTTPS GET, eight-second deadline covering headers and body, 32 KiB
  body limit, manual redirect refusal, no redirects and no retry. No secret is sent
  to the application. Readiness requires HTTP 200, `name: "keryx"`, `ok: true`,
  `db: "ok"`, `status: "operational"` and a valid server `time` no older than two
  minutes or more than one minute into the future. A degraded operational verdict
  counts as failed readiness even when the endpoint responds 200. JSON shape,
  datastore, stale timestamp, transport and HTTP failures are distinct coarse reasons.
- Three consecutive failed observations open one incident; two consecutive healthy
  observations close it. Continuous failure creates one outage notice, followed by
  one recovery notice when ready. Expected detection latency is approximately
  10–15 minutes after failure and 5–10 minutes after recovery, excluding provider
  delay, quota exhaustion and skipped observations.
- A dedicated SQLite-backed Durable Object persists one bounded state record and
  serializes Cron/operator calls with a per-object promise queue and durable claims.
  The queue does not hold Cloudflare's 30-second `blockConcurrencyWhile` lock across
  network I/O. A process restart loses the queue but retains consumed slots and
  notification attempt counts/deadlines. Corrupt state fails closed and requires inspection.
  State contains only slot, counters, verdict, check time, incident/diagnostic flags,
  a monotonic incident sequence and at most two notification delivery records. Raw health JSON, payment telemetry,
  exception text, keys and private payloads are neither stored nor sent to Telegram.
- Each notice has a stable incident/kind ID. Its attempt count and next eligible time
  are persisted as `attempted` **before** Telegram `sendMessage`. HTTP 200 with
  `ok: true`, a positive integer message ID and a numeric recipient chat ID matching
  the configured operations group records `confirmed`; other results record
  `unconfirmed`. A crash can leave `attempted`. Confirmed notices are never resent.
  Production Cron retries unconfirmed/attempted notices at most twice more, never
  sooner than five minutes after the prior attempt, for at most three total attempts
  per notice. Immediate repeated calls cannot accelerate retries. No request-level
  retry loop exists. Exhausted notices stay visible with their durable count until
  a new incident replaces the retained pair; this record is not a historical archive.
- Telegram has no idempotency key: acceptance followed by a lost acknowledgement can
  duplicate a notice. The same stable notice ID and an explicit duplicate-delivery
  warning appear in every attempt. Bounded spaced retries reduce the chance of
  permanently losing a critical alert after a crash before fetch; they do not provide
  exactly-once delivery. A prolonged provider outage can exhaust all three attempts.
  Inspect the private group and state before a manual follow-up; preserve the journal.
  Recovery readiness does not prove payment resolution.

## Free-plan boundary

Cloudflare [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
supports SQLite objects on Workers Free; Free limits currently include 100,000 DO
requests/day, 13,000 GB-s/day, 5 million rows read/day, 100,000 rows written/day and
5 GB total stored data. Overages fail rather than upgrading the account. This monitor
normally uses 288 DO requests/day and roughly 576 single-record writes/day;
each outage/recovery adds up to three bounded Telegram requests and the corresponding
intent/outcome writes. The maximum two retained records produce at most six attempts
for one incident's outage/recovery pair. It uses no KV, D1, R2,
Queues or Paid feature. At 128 MiB duration accounting, the three eight-second timeout
budgets (one health read and at most two due notices) across all 288 probes would use
approximately 864 GB-s/day before provider
overhead. This estimate is not a billing guarantee.

[Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/)
and [Cron configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
also apply. Verify account allowances and the Cron slot before deployment: Free
allows five Cron triggers per account, and other Workers share quotas. This Worker
adds one trigger, independently of existing Workers. Its authenticated workers.dev
HTTP surface still consumes request allowance when callers are rejected. There is
no global account spending cap in this implementation and no automatic Paid upgrade.
Account exhaustion, Cloudflare outage or Telegram outage can hide a VPS incident;
the monitor is one additional signal, not a high-availability guarantee.

## Build and deploy handoff

Run only the isolated package; do not deploy the root Next.js application to Workers:

```powershell
npm ci --prefix cloudflare/ops-monitor --no-audit --no-fund
npm test --prefix cloudflare/ops-monitor
npm run build --prefix cloudflare/ops-monitor
npm run test:runtime --prefix cloudflare/ops-monitor
```

The lockfile pins Wrangler and Miniflare/workerd. The dry build creates no provider
resource. Native runtime tests intercept every outbound request, persist state across
workerd restarts and exercise fixed health/drill URLs, refused redirects, isolated fixture
state, two acknowledged notices, bounded spaced uncertain retries, recipient matching,
default-disabled notifications, authentication and concurrent Cron claims. Node tests
cover crash before fetch, crash after acknowledgement before durable confirmation,
five-minute deadlines, provider refusal and a five-second stalled-body admission bound.
They neither call production nor send messages. The standalone `ops-monitor.yml`
workflow runs the locked install, unit tests, dry build and native runtime checks on Linux;
the full repository CI also remains required for the PR.

An operator must verify the candidate and Free account, then provide **three separate
Worker secrets** through protected input/private JSON outside Git:

- `MONITOR_DIAGNOSTIC_TOKEN`: new random 32-byte base64url secret, dedicated to this
  monitor's diagnostic/control paths, not a reused source-upkeep or payment token.
- `ALERT_TELEGRAM_BOT_TOKEN`: existing dedicated alert bot token sourced privately
  from the VPS `KERYX_ALERT_TELEGRAM_BOT_TOKEN` configuration.
- `ALERT_TELEGRAM_CHAT_ID`: owner's private operations group ID, sourced privately
  from `KERYX_ALERT_TELEGRAM_CHAT_ID`. Confirm bot/group membership before enabling.

Missing or invalid secret configuration disables all probes and diagnostics. Do not
print secret values, put them in command arguments or commit runtime state. From the
isolated directory, the operator can run `npx wrangler secret bulk <private-json-path>`
and `npm run deploy` using the existing authenticated development machine. Secret
upload/deploy are provider mutations requiring the coordinator's reviewed rollout.
The first deployment creates one dedicated SQLite namespace through migration `v1`.
Do not reuse another Worker's namespace or change its credentials or schedule.

Keep previews disabled. workers.dev is enabled solely for authenticated fixed
`GET /status`, `POST /probe` and `POST /diagnostic`, with bearer authentication;
all other paths/methods, queries and nonempty request bodies return 404. Native workerd
can represent an empty POST as a readable body, so admission performs one bounded read
with a five-second deadline before opening the DO; a stalled body returns 404.
`/probe` uses the same
durable five-minute production slot as Cron; it cannot accelerate the streak.
`/status` returns sanitized monitor state with `Cache-Control: no-store`.
Operator tools should use protected headers and display only verdict/receipt fields.

## External acceptance without stopping production

1. Check provider plan, script name, exact Cron, SQLite class/migration, previews,
   configured secret names and absence of unrelated changes. Confirm the Worker
   release corresponds to the reviewed Git commit and record it privately.
2. Authenticate `POST /probe` once and inspect `GET /status`; this performs at most
   one real external GET in the current slot. Expect `healthy` and current check time.
   Do not publish full application health JSON.
3. Review the explicit diagnostic plan before sending anything. Set
   `DIAGNOSTIC_NOTIFICATIONS_ENABLED` to `"true"` only for the authorized drill and
   use a fresh operator-chosen `DIAGNOSTIC_RUN_ID`. Authenticate `POST /diagnostic`
   once. It consumes that durable fixture identity before any action, then performs
   one real GET to `https://keryx.cc/api/health` as a healthy control. A failed control
   consumes the run without alerts. It then reads
   `https://keryx.cc/api/keryx-ops-monitor-drill-unavailable` exactly three times,
   requiring HTTP 404 each time, followed by two real healthy GETs to `/api/health`.
   Every URL is compiled into the Worker; incoming Host, body, query and environment
   cannot change targets. No monitor credential is sent to the application.
   Each request uses the same bounded transport/classifier as scheduled probes.
   This unavailable-route drill sends two generic **[DRILL]** notices
   (failure/recovery) when both Telegram acknowledgements are confirmed, never
   alters the public health URL, DNS, firewall, production status or services, and
   never touches production monitor state. A repeated call reports consumed state,
   performs no more health/drill reads, and can only retry an unconfirmed notice if
   five minutes have elapsed and fewer than three attempts were consumed. Diagnostic
   retries require that explicit authenticated call; production Cron does not sweep
   fixture objects. Confirmed notices never repeat.
4. Check both `confirmed` delivery records and the owner's actual private-group
   receipt. HTTP confirmation alone does not demonstrate human/group receipt.
   Record aggregate evidence only. The fixed unavailable-route drill proves actual
   external HTTPS reads, HTTP failure classification, state transitions and Telegram
   delivery; it does **not** establish detection of real VPS power loss, DNS failure
   or network disconnection. Native intercepted tests cover transport failure and
   redirect logic. If the fixed unavailable route stops returning 404, the diagnostic
   fails closed rather than accepting another status or selecting a new URL.
5. Restore diagnostic notifications to `"false"`; preserve the consumed fixture state.
   Inspect the next real scheduled sample and unchanged source-upkeep schedule.
   If any acceptance item is missing, leave the release gate open rather than claim
   monitoring or messaging has been accepted.

Never reset production state to repeat an alert. A changed diagnostic run ID is a
new deliberate drill; spaced retries retain the original run ID and attempt journal.
Diagnostic data resides
in a distinct durable object identity; repeated HTTP calls cannot create arbitrary
fixture namespaces because the run ID is fixed in operator deployment configuration.

## Incident runbook

The alert requires inspection; it does not authorize repeating purchases or payouts.

1. Confirm the generic incident and last monitor observation privately. Check
   `https://keryx.cc/status` and obtain a bounded, sanitized health verdict from a
   separate client. A timeout/5xx suggests transport or app availability; `degraded`
   can indicate worker/reconciliation readiness while the site is serving answers.
2. Use the existing `keryx-vps` SSH alias. Check host reachability/disk/memory first,
   then `pm2 status`, bounded recent `keryx` error logs, and
   `systemctl status cloudflared`. Compare local port 3939 health with public HTTPS
   health to isolate application versus tunnel/network failure. Avoid printing
   environments, keys, private request bodies or full health payment telemetry.
3. For a reachable but degraded application, inspect existing operational watchdog
   summaries, worker heartbeat and ambiguous-payment recovery using their documented
   read-only procedures. Preserve journals and pending rows. Do not restart a payment
   worker or repeat authorization solely because an answer/receipt was lost.
4. For a release regression, follow the health-gated rollback in
   [deployment guide](deployment-guide.md). Repair only the observed fault; document
   uncertain jobs/payments before any stateful recovery. Service restart/rollback and
   payment recovery require their own operational scope and evidence.
5. Two healthy monitor samples confirm current endpoint readiness. Separately verify
   the affected operation and outstanding payment/job evidence before closing that
   incident. If Telegram is unconfirmed, inspect the group and preserve delivery
   state. Production retries are bounded and automatic; any manual retry outside
   that journal requires deliberate incident scope, not a state reset.

If the monitor itself is silent, check Cloudflare Cron executions, account quotas and
authenticated monitor state, then Telegram availability/group membership. Disable this
Worker's Cron to halt probes; revoke the diagnostic token to halt operator calls.
Deleting state or redeploying another namespace can erase debounce history, so preserve
the original SQLite namespace during rollback. None of these steps changes source upkeep.
