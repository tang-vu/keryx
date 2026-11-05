# Public research availability observation

`GET /api/research/availability` uses a separate advisory observer. When selectors
are absent and a retained closed canary registry exists, the private configuration
reader has already fully validated its closure. The display observer reuses that
closure within the same synchronous operation instead of validating it a second
time. Each GET starts a new observation; there is no global cache or expiry timer.

The existing `canaryResearchPaused`, `canaryExecutionPaused`,
`configuredBusinessCanary`, `readResearchAvailability` and
`assertOrdinaryResearchAvailable` retain their original checks and read order.
The optional closure observer is private to `configured`; ordinary callers supply
no callback. The public display function accepts no snapshot, policy or cache
argument. All retained-file bounds, protected path checks, failed closure/provider
ledger validation and applicable research isolation checks still run.

A missing registry can produce `not-paused`, just as before. An existing active
registry without its required selectors, partial or expired configuration, invalid
metadata or insecure storage fails closed. A failed paid delivery remains held
unless the existing explicit research isolation proof validates. That exception
does not clear the Operator hold, complete or refund an original, restore a
supplier allowance or authorize an A2A/private run.

The response keeps the same fixed safe copy, two states, Node runtime,
`force-dynamic` route and `Cache-Control: no-store` header. It initializes no
database, consumes no quota, performs no provider/payment request and writes no
retained record. A display can become stale immediately after reading: every
submission still needs all existing fresh server admission, authentication,
allowance, budget and payment checks. A prior `not-paused` response cannot authorize
a subsequent request.

| Surface | Role |
| --- | --- |
| Web composers, widget and hosted status consumers of this GET | Advisory observation with unchanged public contract |
| Ask API/SSE, OpenAI compatibility, hosted research MCP and bots | Existing fresh admission and safe held-error contracts |
| MCP server metadata that calls the original getter | Existing observer retained intentionally |
| Local CLI, stdio MCP, desktop, extension and paid A2A | Existing admission/payment roles; no new authority or distribution version |

Real isolated filesystem tests compare completed-registry reads: the display
reads the two protected records once, while the original research and execution
observers still read them twice. Tests also cover failed delivery/isolation,
changes between calls, bounded and insecure metadata, and a hold changing after
the display read. Actual route tests deliberately disagree on display and
admission: a clear display still results in a held browser, OpenAI or MCP research
request before dependency, DB, provider or quota work. POSIX permissions require
Linux acceptance; a Windows fixture cannot prove them.

These synthetic read counts establish removal of duplicate work in that fixture.
They do not establish production request latency, billing savings or useful live
research. This source change does not renew policy, add funding, schedule work,
deploy a release or modify required originals.
