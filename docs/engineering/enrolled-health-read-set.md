# Fixed enrolled SQLite health reads

The public `/api/health` route can use the genuine enrolled SQLite facade's
optional `readPublicHealthSnapshot(nowMs, includeRegistry)` method. It combines
the existing dashboard metric inputs, A2A operation summary inputs and fixed
health sync keys into one native `UNION ALL` read. The optional recorded-account
count retains its separate query and error boundary. Ordinary SQLite and other
backends keep the existing individual methods.

This reduces repeated admission work by issuing fewer statements. It does not
cache authority, successful guards, statements or returned data. The frozen
facade explicitly inventories the new method as a read. Its existing admission
checks before the call and after the awaited result, and the verified connection's
fresh prepare/statement guards, still apply. The method accepts only a bounded
integer clock and a registry-configured boolean; it exposes no native handle,
caller-supplied SQL, arbitrary key list or callback.

The fixed statement preserves the original field conversions, native values,
JSON validity checks, completion-latency classification and metric calculator.
It reads the requested four sync keys, plus `lastSyncedBlock` and `registryParity`
when registry reads are configured. Keys missing from storage remain `null`.
The metric, job and sync inputs now share one SQLite statement snapshot; the
optional account count remains separate. Concurrent writes can therefore produce
a more coherent view than the former independently timed reads, rather than an
identical sequence of interleavings.

An optimized data-read failure can return `undefined` only after the full current
facade assertion succeeds. The route then uses its original independent reads
and optional/mandatory telemetry boundaries. A revoked, closed or invalid
manifest/schema/fence assertion throws; it cannot become an unavailable
optimization and bypass admission. The existing registry failure, malformed
optional telemetry, stale/stopped worker, degraded job, worker privacy and
`no-store` behavior remain authoritative. For a partial alternative backend
snapshot, an absent sync key still uses the original scalar read.

The private `metrics-and-jobs` timing phase now includes the combined sync-input
read. The following `sync-state` phase covers projection and any fallback reads;
it no longer measures a separate native sync query on the optimized path.

## Controlled comparison — November 10, 2026

Eight actual bundled CLI invocations used Node 24.22.1 / SQLite 3.53.4 on Linux,
with the unchanged 491-object enrolled application schema. Each of the empty and
300-query synthetic shapes ran baseline/candidate/candidate/baseline, five rounds
per operation per invocation. The candidate's complete-health operation asserts
that the new genuine facade method executed instead of silently falling back.

| Synthetic shape | Baseline median process CPU | Candidate median process CPU | Reduction |
| --- | ---: | ---: | ---: |
| Empty | 106.4805 ms | 47.2955 ms | 55.58% |
| 300 queries | 116.4210 ms | 44.3710 ms | 61.89% |

Each median pools ten complete-health rounds per variant and shape. Across those
rounds the complete set used 116 → 50 native prepares and 98 → 42 schema reads.
The original individual metric, job and sync operations retained their native
read counts. Every corresponding output hash matched, read-only fixture bytes
stayed unchanged, all eight owned fixtures were removed, and outbound attempts,
payments and profiles were zero.

The container had no network, a read-only root, a 768 MiB memory limit, one CPU,
64 PIDs, dropped capabilities and no-new-privileges. Limits were read back, not
stress-tested for native-pressure enforcement. Its peak recorded memory was
246,218,752 bytes. Fixture storage was tmpfs and the program was bundled; quota,
host scheduling and the small fixed shapes limit generalization. These figures
measure synthetic process CPU, not live HTTP latency, sustained capacity, model
quality or the cause or elimination of intermittent production outages.

Native output-oracle controls use the unchanged ordinary methods only to compare
data conversion. Separate genuine enrolled-facade tests verify fewer prepares,
fresh manifest/schema/fence checks, the statement guard after preparation,
post-await refusal, data-only fallback, invalid arguments, read-only bytes and
refresh after later writes. API controls compare complete legacy payloads and
verify fallback/error/degraded/privacy behavior. Source acceptance additionally
requires the repository's applicable PR and exact-main CI; this comparison does
not authorize deployment or a release.
