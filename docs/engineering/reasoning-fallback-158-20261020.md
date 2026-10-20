# Reasoning failure diagnostics — issue 158

When source selection falls through an open circuit and an input-limited
alternate to the heuristic, remote and stdio text now explain the recorded
failure categories and HTTP statuses as well as the existing serving tiers.
Recorded cooldown milliseconds are explicitly historical, not a live countdown.
At most eight distinct failures are displayed; the bounded structured attempt
history remains unchanged. English, Vietnamese, Portuguese and Spanish use the
same validated facts.

Stdio failures no longer echo an arbitrary exception message or coerce a thrown
object into text. Known validation/input/transport classes and own numeric HTTP
statuses retain bounded categories. Unknown application failures stay
`request_failed`; they are never guessed to be network failures. Supplier
messages, bodies, causes, credentials and accessors are excluded. No retry,
provider call, circuit mutation or spending is introduced by presentation.

The existing resilient engine and synthetic regressions already distinguish
post-response validation from transport failure, keep request-dependent errors
out of shared circuit penalties, and exercise sequential/concurrent clients
with input-limited fallback. Existing remote MCP structured output reports the
actual heuristic source-selection tier even when the aggregate engine is a model.
This follow-up completes the bounded client-diagnostic part of that core repair.

The historical S10 exception was not retained; its precise cause remains unknown.
No fresh paid live trial, circuit reset or production delivery is claimed.
Closing the core defect after successful source acceptance does not turn either
missing observation into evidence. Other open issues remain open.

Focused validation covers the original circuit/input-limited/heuristic shape,
all four label languages, bounded history, safe error categories and hostile
exception objects, together with unchanged canonical financial fragments and
structured result/receipt hashes. Required PR CI and the existing coordinator's
release process remain separate gates.

Web, desktop, CLI, API, remote/stdio MCP, extensions and bots retain their current
execution and financial contracts. This changes remote/stdio human-readable
diagnostics only. The existing release owner handles any applicable package or
deployment delivery in its next accepted batch; no version or deployment is
allocated here.
