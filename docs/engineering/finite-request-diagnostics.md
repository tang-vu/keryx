# Finite private request diagnostics

A live web process can stop answering health requests while a native sample
shows JSON or garbage collection without resolving the JavaScript caller.
The default [passive drain observer](public-request-observation.md) only emits
coarse totals during shutdown. This optional window records incoming-template
candidates before handler work. It does not prove or repair an incident cause.

The window is OFF when `KERYX_PUBLIC_REQUEST_DIAGNOSTIC_UNTIL` is absent or empty.
OFF adds no diagnostic timer, catalog read, request log or CPU measurement.
Existing twelve-group passive records and the two drain stages remain compatible.
There is no public diagnostic endpoint, inspector, heap dump, new signal,
automatic restart, retry, periodic sampling job or research/payment schedule.

An operator may supply a canonical UTC deadline in the existing private launch
environment before a separately authorized server start. For example, generate
a value with `new Date(Date.now() + 5 * 60_000).toISOString()`. It must be future
and at most ten minutes away when the observer is created. Activation authorizes
no restart, maintenance, deployment, release, funding or policy renewal. Preserve
ROOT's existing startup/original/ENV/custody/Operator and release gates.

The deadline is captured once. Both wall-clock and monotonic expiration apply;
moving the clock backward cannot extend the window. Its one unreferenced timer
cannot keep an otherwise stopped process alive. An expired value is disabled,
never renewed. Each server instance has its own counters; reusing a deadline
after a restart never extends that UTC deadline. This source outcome does not
activate a production window.

| Per observer instance | Bound |
| --- | ---: |
| Duration | 600,000 milliseconds |
| Logged request starts | 32 |
| Concurrent fixed metadata entries | 16 |
| Start/end and window control records | At most 66 |
| Serialized JSON record | 2,048 bytes, excluding the newline |
| Prepared catalog | 512 KiB, at most 1,024 entries |
| Incoming path matching | 2,048 characters, at most 64 segments |

Completing responses frees concurrent slots but never replenishes the lifetime
start budget. Untracked requests continue normally. The window closes after its
budget's tracked responses settle, at expiry, at drain start or on disposal.
A throwing diagnostic sink disables that instance without retry or HTTP changes.
A broken process-wide output stream remains a host I/O condition; this feature
does not replace global I/O recovery.

The catalog is the current server's own `.next/app-path-routes-manifest.json`.
Pinned Next 16.4.1 writes its normalized routes there and the production router
already reads the same file. Bounded reads require a regular, non-symbolic,
single-link file and stable descriptor identity, size and modification time.
Missing, oversized, invalid or ambiguous metadata emits only a fixed disabled
reason and cannot prevent application startup. OFF never opens the catalog.
The compiled fixture binds the logged catalog hash to its actual built bytes;
all existing immutable-build byte assertions remain required.

Matching covers the complete catalog's static, dynamic, required catch-all and
optional catch-all segments, with static specificity first. No manifest regular
expression executes. Unknown or long targets get the fixed `unmatched` label.
`incomingTemplate` is an incoming-path candidate, not proof of the handler Next
selects after rewriting, interception, decoding or redirects. It is never
routing or authorization authority.

Private `keryx-private-request-diagnostic-v1` records contain a generated window
identifier, window-local sequence, source template, method class, timestamp and
PID. A `start` is submitted before admitted handler work. Its matching `finish`
or premature `close` adds response status, elapsed time and `processCpuMicros`.
This field is whole-process user-plus-system CPU during that interval. Other
requests and background threads overlap; summing rows double-counts work.
It is not exclusive handler CPU, provider usage, a customer/economic metric or
a payment/delivery receipt. See the pinned [Node CPU contract](https://nodejs.org/download/release/v24.22.1/docs/api/process.html#processcpuusagepreviousvalue)
and [response finish/close contract](https://nodejs.org/download/release/v24.22.1/docs/api/http.html#class-httpserverresponse).

Raw targets, parameters, query strings, headers, bodies, wallet addresses,
external request IDs, errors and environment values never enter the records.
The map holds only fixed labels and numbers, not request or response objects.
Listeners live only on existing active responses and remove themselves at their
own finish/close. Window closure clears its map and timer, without closing a
response or cancelling application work. Late responses emit no request record.

Wrong public metadata, upgrade and drain refusals retain 421/426/503 behavior
and are excluded from the window; passive totals still count them. Targets,
headers, bodies, SSE bytes, response status, backpressure and application abort
behavior remain owned by the existing server and Next. No content, spend,
registry, custody or settlement authority changes. API/web/remote MCP and their
CLI/desktop/extension/bot clients retain existing formats and transport roles.

Genuine HTTP controls cover catalog shapes and bounds, hard links, clock changes
with real expiry, held responses, lifetime/concurrent caps, SSE disconnect and
sink failure. A parent sees the default stdout start record while its owned child
handler is synchronously blocked, then releases it through a fixture file.
The child exits despite its future timer. Actual pinned Next uses its own built
catalog, excludes wrong-origin/upgrade requests and retains original origin/body,
immutable old/new/old cohort and graceful drain assertions. These isolated
synthetic fixtures do not establish production acceptance.

Output is best effort and may be delayed by backpressure or the host. A fully
blocked event loop cannot process a new callback or expose requests still in the
kernel queue. Missing records, unmatched templates or an exhausted/expired window
do not prove absence of work. There is no retrospective capture or automatic
reopening. Full PR/main, maintenance, privacy, payment and platform acceptance
remains required; production activation/deployment/publication retains the
existing explicit owner-command gate.
