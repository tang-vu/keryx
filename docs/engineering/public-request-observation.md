# Public request observations during drain

An installed web process stopped answering public and loopback requests while
PM2 still reported it online. Its later shutdown receipt proved a normal SIGINT
drain, and existing health timings appeared only after probes completed. The
historical V8 OOM records belonged to other PIDs. Those observations do not
identify the incident's trigger; restarting the unchanged installed web restored
service separately from this source change.

The custom public server now emits `keryx-public-request-observation-v1` at the
start of its existing close operation and after its owned HTTP listener drains.
It emits at most two records per close promise. Diagnostics are best effort;
the original positive closed receipt, HTTP/Next/trace drain, signal exits and
failure hold remain authoritative. No new signal, timer, deadline, force-close,
automatic restart, request retry or research schedule is added.

The observer counts requests that reach the native HTTP request callback,
including metadata and upgrade refusals. Twelve fixed groups combine four
transport surfaces (`health`, `api`, `asset`, `page`) with three method classes
(`get-head`, `post`, `other`). These labels describe transport, not authorization,
customer activity or economic state. Targets, query strings, headers, bodies,
wallets, errors and request IDs are neither retained nor logged.

Each group keeps active, finished-response and premature-close counts, finished
HTTP status families, maximum observed duration and a continuous busy interval.
`busyForMs` measures time since the group became nonempty; it is not the age of
its oldest currently active request. Response finish and close settle observation
once, with both listeners removed. Completed close events are not counted as
aborts. The observer reads no request body and changes no response, stream,
backpressure or application cancellation behavior. Counters saturate at the safe
integer ceiling; their fixed cardinality keeps the diagnostic record below 8 KiB.

The numeric memory summary separates process RSS, V8 used/total heap, external
memory and V8 heap limit. These measurements are not OS memory enforcement or
proof of a memory leak. See the pinned [Node HTTP response events](https://nodejs.org/download/release/v24.22.1/docs/api/http.html#class-httpserverresponse)
and [process memory fields](https://nodejs.org/download/release/v24.22.1/docs/api/process.html#processmemoryusage).
No heap dump, inspector endpoint, environment snapshot or customer payload is
produced. Observation state is fixed-size aggregates plus listeners on already
active responses; there is no global request collection.

Native ephemeral HTTP tests cover unchanged private POST metadata/body, error
and HEAD responses, SSE bytes and client disconnect, concurrent pending requests
and 96 distinct targets across the twelve groups. The existing compiled Next
fixture copies the helper and verifies actual SIGTERM diagnostic records while
preserving its original origin, streaming/drain, immutable-cohort and subprocess
assertions. A failed diagnostic sink at drain start must not prevent that drain.
Maintenance and privacy build proofs bind the new helper, and its changes select
the existing Linux maintenance workflow.

The records cannot run while the event loop is completely blocked, describe
requests still in the kernel listen queue, or diagnose an incident retrospectively.
They help a responsive shutdown expose its transport workload. This does not
establish or repair the earlier event-loop trigger, alter payment/custody authority,
or claim production delivery. CLI, MCP, desktop, extension and bot roles retain
their existing hosted/API handoffs. Deployment and publication still require an
explicit owner command.
