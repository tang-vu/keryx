# Health incidents 70 and 71 — October 28, 2026

## Observed incidents and limits

The owner received incident 70 at 12:01 and recovery at 12:21, then incident 71
at 15:06 and recovery at 15:31 (Asia/Saigon). These are two readiness episodes,
not just duplicate delivery of one notice. The intervals between alerts do not
measure the exact duration of user-visible downtime.

The [outside-host monitor](../outside-host-ops-monitor.md) checks every five
minutes, with an eight-second request/body deadline. Three bad checks open an
incident and two healthy checks close it. Its latest-state record does not retain
the individual historical failure reasons. The generic notices cannot distinguish
a timeout, HTTP error, stale heartbeat or another degraded readiness signal.
Recovery establishes endpoint readiness, not financial incident resolution.

Read-only host evidence collected at 10:37 UTC:

- The web process and A2A worker remained online with zero PM2 restarts, both
  started October 26. Production still identified source `ca29b267`.
- Ten-minute sysstat samples ending at 05:00–05:10 and 08:00–08:20 UTC showed
  approximately 59–67% CPU use across the two CPUs, above adjacent samples.
  Available RAM remained approximately 1.5–1.6 GiB, with no swap-out in those
  samples. No matching kernel OOM or I/O-error lines were found in the inspected
  04:30–08:45 UTC window.
- Cloudflared recorded bursts of context-cancelled log lines near both periods.
  Paired lines may describe the same request, so line counts are not request
  counts. These messages lacked route attribution and do not establish which
  side cancelled the request.
- Canonical-host loopback health reads returned HTTP 200/operational in 1,206 ms
  directly and 713 ms through the front door. The corresponding web CPU deltas
  included concurrent work and are not exclusive per-request profiles.

CPU pressure correlates with the incidents. The available historical evidence
does not prove the triggering route, process or readiness classification. Old
application error logs without timestamps are not evidence of a failure today.
An initial loopback probe omitted the required canonical Host header and was
refused by the public-origin boundary; it is not outage evidence. Tool scheduling
delay is not HTTP latency.

## Reduce repeated state reads without weakening storage admission

Health formerly performed six separate sync-state reads when registry observation
was configured. Each read through the enrolled SQLite facade repeats fresh
deployment, identity, fences and application-schema validation. Those checks stay
in place. The new optional `KeryxDB.getSyncStates` operation binds at most 32 keys
in one SELECT through the same verified prepare/statement path. Its enrolled
inventory classification is read-only. There is no migration, new write authority,
shared installation change or cross-request cache.

The health reader requests only configured observations and creates a new snapshot
on each GET. Adapters exposing only scalar reads, including Supabase, retain their
existing path. A refused batch falls back to scalar reads within the original
per-field error boundaries: mandatory registry failures still produce 503;
unreadable optional summaries remain absent. A revoked enrolled connection still
refuses the fallback. Worker, job and reconciliation degradation criteria and all
health response fields remain unchanged.

A controlled Windows test using the real enrolled facade and a synthetic mainnet
schema measured the state-read portion only:

| Operation | Application SELECTs | Native prepare calls including guards | Elapsed |
| --- | ---: | ---: | ---: |
| Six scalar reads | 6 | 198 | 559 ms |
| One bounded batch | 1 | 33 | 91 ms |

This is one controlled sample, not a production latency or outage-resolution
claim. The probe still performs its existing metrics and A2A operations reads.

## Diagnostics and acceptance

Health emits `[health] probe` for a request lasting at least two seconds or
returning unready. Each line includes its own UTC timestamp, outcome, elapsed
milliseconds and durations for fixed phases: database opening, metrics/jobs,
sync-state and response construction. It excludes state contents, exception text,
RPC URLs, wallets and request identifiers. This makes the next slow/failing probe
locatable even when PM2's log file has no timestamp prefix. It cannot identify
requests that never reach the application.

Focused regressions compare the entire scalar and batched response; exercise
fresh worker, job and reconciliation degradation, missing/malformed observations,
batch/scalar refusal and mandatory 503 behavior; and open genuine enrolled writer
and readonly facades. Native checks cover bound keys, missing values, subsequent
committed updates, unchanged readonly database bytes, fresh manifest refusal and
schema drift. Guard SQL remains observable in the measured native calls.

All applicable PR/domain CI and exact-main acceptance remain required. These
changes need the existing ROOT/Circle owner's future batched runtime delivery
and post-cutover endpoint measurements before they can be described as deployed.
No monitor reset, schedule change, maintenance window, restart, payment action,
job execution or production storage mutation was performed for this investigation.

Sanitized host observations, original test results, review and CI provenance are
retained once under the canonical checkout's
`.local/release-evidence/health-incidents-70-71-20261028/`.
