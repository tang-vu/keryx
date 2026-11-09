# Reduce repeated native metrics reads

An ordinary health request can consume substantial CPU even while returning 200.
A controlled November 9 observation of the installed web process recorded
0.36/0.42/0.45 CPU seconds across three healthy requests; 26 of 33 native sampled
stacks included SQLite. This identifies a cost to isolate, not the function that
triggered the earlier prolonged outage. See the
[native diagnostic method](native-origin-profile.md) for its limits.

## Fixed read at the enrolled facade

The enrolled `metrics` method previously issued four independent input reads:
payments, query runs, feedback and gap intents. Each prepare and statement
execution crosses the verified connection's fresh runtime, file, identity,
fence and schema checks. The facade also checks before and after the async
operation. Those checks are required; their successful results cannot be cached.

`dashboard-metric-rows.ts` reads the four groups with one source-owned `UNION ALL`
statement, then calls the unchanged `calculateDashboardMetrics`. Each branch has
a constant group tag and the original field order. There are no joins, deduplication,
caller-provided identifiers or JSON value conversions. Native nulls, numbers,
strings, blobs and integer-read refusals retain their original behavior.

The result uses statement-local array rows to avoid allocating named properties
for padded columns. Node documents `setReturnArrays` from v22.16.0 in its
[SQLite API](https://github.com/nodejs/node/blob/v22.23.0/doc/api/sqlite.md#statementsetreturnarraysenabled);
this predates the project's supported Node 22/24/26 minimums. It does not change
connection policy or the return format of guard statements.

The optional indexed-account count stays a separate read with its existing
failure-to-null boundary. The enrolled facade's original admission and post-await
checks remain outside the helper. A changed manifest/schema must still reject
the operation, including when an account-read failure is caught. There is no
scalar fallback around a failed batch or guard and no result/statement cache.
The ordinary SQLite core method, Supabase adapter, schema, guard implementation,
financial arithmetic, API response shape and consumer interfaces are unchanged.

## Controlled before/after measurement

Run the reviewed pinned Node toolchain from an isolated worktree:

```text
node --import tsx --no-warnings scripts/measure-enrolled-health.mts
```

Set `KERYX_MEASURE_ROOT` to an existing owned directory under the canonical
checkout's `.local/tmp/<task>/`; set `TEMP`/`TMP` there too. The launcher scrubs
application credentials/configuration and starts two fresh workers, each with
a 60-second deadline, a bounded output buffer and outbound denial installed
before application imports. Each builds a new synthetic mainnet-schema store
and opens the genuine readonly enrolled facade. There are no production reads,
payment executions, worker starts, funding/policy changes or HTTP load tests.
Successful workers close/remove their own fixture. A failed fixture remains
under the owned root for inspection and task cleanup.

The November 9 comparison used the same script, Node 24.22.1 on Windows, 491
schema objects and two datasets: empty, and 300 synthetic offline query rows
with no payments. A warm-up preceded five uninstrumented timing rounds. A
separate count-only round observed native prepares; timing does not include the
prepare-counter wrapper. Every method's output hash matched before/after,
database bytes stayed unchanged during readonly trials, and outbound attempts
were zero.

| Fixture / operation | Median wall ms before → after | Median CPU ms before → after |
| --- | ---: | ---: |
| Empty / metrics | 304.052 → 152.618 | 312 → 156 |
| Empty / health read set | 490.608 → 344.553 | 516 → 360 |
| 300 queries / metrics | 321.058 → 141.988 | 344 → 141 |
| 300 queries / health read set | 491.079 → 337.182 | 485 → 328 |

| Operation count | Before | After |
| --- | ---: | ---: |
| Metrics input SELECTs | 4 | 1 |
| Optional account SELECT | 1 | 1 |
| Metrics native prepares, including guards | 101 | 50 |
| Metrics schema reads | 84 | 42 |
| Health read-set native prepares | 167 | 116 |
| Health read-set schema reads | 140 | 98 |

The health read set is the existing metrics/jobs pair followed by one sync-state
batch. Its measured CPU reduction was about 30–32%; metrics alone about 50–59%.
These are small controlled fixture measurements, not production HTTP latency,
traffic capacity, large-store memory coverage or proof that recurring 502s are
fixed. The source change requires normal review/CI and a separately authorized
release before claiming live improvement. Output-oracle, readonly/fresh-value,
native error and during-operation admission tests cover the changed path.
