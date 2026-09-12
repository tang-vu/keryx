# Incremental answer archive

The web process has exhibited V8 heap exhaustion. Loading the complete 2,500-run
archive window retained both serialized payloads and parsed traces, then full winning
runs. This is a confirmed avoidable allocation pattern, not proof of the only cause
of production restarts.

The archive now keeps small winning cards while consuming an asynchronous iterator.
SQLite sorts IDs, then reads one payload at a time under the active statement's read
snapshot. Sorting IDs matters: selecting payloads directly can make SQLite materialize
large values in a temporary sorter. No schema migration or heap-limit increase is needed.
Supabase requests at most 32 rows per page with a 15-second request timeout, using
descending `(created_at, id)` keysets. Short pages continue until empty or the window
limit. Cursor quoting follows [PostgREST URL grammar](https://docs.postgrest.org/en/stable/references/api/url_grammar.html).
HTTP pages do not provide a database-wide snapshot under concurrent modifications or
backdated inserts. Neither implementation imposes a hard byte limit on an individual row.

Citation count, creator rewards, recency, snippets and historical confidence retain
their selection semantics. Complete ties retain the first encountered run; database
timestamp ties now explicitly use descending ID order instead of unspecified ordering.
Concurrent requests share one rebuild per module instance. A failed scan never replaces
the last complete cache or refreshes its timestamp; the next request can retry.

Validation commands:

```sh
npx vitest run lib/answers-archive.test.ts lib/answers-archive-stream.test.ts lib/db/recent-query-stream.test.ts lib/db/sqlite-recent-query-stream.test.ts
node --import tsx scripts/check-archive-memory.mts
npm run typecheck
```

The synthetic benchmark creates 2,500 SQLite rows with large trace fields and 50
distinct questions, comparing isolated child processes with the same 512 MiB heap cap.
One local run sampled 235,257,016 heap bytes for bulk reading and 37,512,312 for streaming,
with identical output digests. These are sampled process heap values, not an exact
allocation profiler, production memory forecast or customer/settlement evidence.
Tests cover ranking, confidence, shared rebuilds, stale-cache recovery, a real SQLite
concurrent writer, cursor cleanup, and Supabase HTTP builder pagination/error handling.

Acceptance still requires checking archive pages after deployment and observing runtime
stability. This release does not claim mainnet readiness or independent paid adoption.
