# Observed HTML/PDF extraction failure stages

A retained SQLite backup question selected the supplied original URL, then
reported only `html-extraction-unavailable`. That historical record cannot tell
whether process startup, parser admission, a deadline or worker output failed.
A newly captured SQLite page succeeds through the unchanged Windows wrapper;
the historical root cause remains unknown. Diagnostics must not invent it.

The HTML/PDF parent wrappers now tag observed failures in a process-local WeakMap.
The closed data is only `{ format: "html" | "pdf", reason }`. Reasons distinguish
input refusal, an unavailable parser guard, occupied admission, immutable worker
binding, process startup, worker I/O, deadline, output limit, nonzero exit and
invalid output. `worker-exit` does not establish a heap, document or publisher
cause. An unknown exception, matching message, restored JSON or forged property
cannot mint an observation. Accessors and expanded diagnostic objects are refused.

Exception identity, names and messages retain their existing contracts. The
article wrapper carries a known matching-format observation through its existing
sanitized ArticleReadError, without storing an original cause or new error fields.
Transport failures and cancellation keep their existing categories; cancellation
does not acquire an extraction-failure observation.

The agent records the optional `extractionDiagnostic` beside the existing
`sourceRead` object in public fetch/re-evaluation trace events. It never adds a
field inside the strict `keryx-source-read-v1` record. Thus existing read counts,
cache-hit interpretation and old/unknown records retain their semantics. State
resets before every read so a later unknown failure cannot inherit a previous
diagnostic. Private job traces do not acquire this public addition. Shared trace
consumers inherit an optional observation, not evidence or execution authority.

No worker stderr/stdout, source text, URLs, system paths, environment, raw vendor
message, inferred diagnosis or timing estimate is retained. No source read,
provider call, retry, signing, settlement, storage schema or schedule is added.
Existing recovery prose remains; a stage observation alone is not a repair or a
reason to rerun paid work.

All containment remains: one shared parser slot per server process; the loaded
code's immutable worker binding; pinned executable and 64 MiB heap; secret-free
environment; HTML 2 MiB input/4-second timer/400,000-byte output; and the PDF byte,
page, character, timeout and output bounds. The public article reader retains
its 20-page/60,000-character/5-second PDF options. Existing abort, first-stop and
release paths remain. No SystemRoot workaround is added: direct Python spawning
was not equivalent to the actual working Node/libuv wrapper.

Tests use actual existing HTML/PDF readers plus explicit fake-child failure events
to inspect every observable wrapper stage, timeout/output boundaries, cancellation
and release. Parent-wrapper and actual-agent fixtures check safe propagation,
forged/wrong-format refusal, no stale observation, unchanged v1 counts and zero
financial effects. They do not establish why the historical production read
failed or certify future document availability. Current-study source fingerprints
must be refreshed only after all trial objects remain identical, with historical
archive pins unchanged. Required source/platform CI and later explicit release
authority remain before production delivery.
