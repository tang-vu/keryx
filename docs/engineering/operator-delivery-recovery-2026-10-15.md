# Research delivery and original report recovery

An owner-requested browser QA run on October 15 completed on production
`d1b3aff6` in 123,020 ms and retained one MDN citation at zero source USDC. The
browser displayed `network error` after step 47, about 100,857 ms into a
98-step saved trace. Its longest interval between recorded steps was 42,381 ms.
The original could be reopened only after an operational lookup of the exact
question. These observations establish a delivery failure; they do not identify
a particular proxy timeout or prove independently useful research. The saved
answer retained low confidence and two evidence gaps.

## Keep an ordinary original discoverable

`POST /api/ask` immediately writes an SSE comment and sends another every 15
seconds while its response remains connected. Comments carry no model decision,
payment request or completion state. Completion, abort and a closed reader clear
the timer. Cancelling the response invokes the existing disconnect handler;
its original payment-retention and signing-abort rules remain authoritative.

Ordinary Public and Unlisted metadata now includes the original `reportId`.
After a stream failure, the browser offers a manual link to that same saved
report. Opening it performs the existing GET read; it never resubmits research
or payment. A reference is not a queued order, a completion promise or proof of
settlement. Unsaved or cancelled work can still be unavailable. The UI keeps the
original error. The link uses the existing saved-report action; an unsaved
original still returns the existing unavailable/not-found response.

Private owner research and protected claim-document transports receive no such
link-readable reference. Existing authenticated recovery and private-claim rules
remain unchanged. The link is same-origin, UUID-bounded and uses no referrer;
no new browser storage or report publication is introduced. Existing account
boundary handling continues to clear hidden turns.

## Prepare a question before checking live capacity

The research page previously hid the entire request component after any failed
SSR custody/capacity observation. A later unsigned API challenge was observed
to succeed while the page remained unavailable. The discarded exception was
not recovered, so its specific cause remains unknown.

A valid configured package now retains question and request preparation even
when the page cannot confirm capacity. The page displays that uncertainty.
Before mounting wallet or funding controls, the request component obtains an
unsigned, body-dependent quote through the existing buyer validator. It requires
the pinned merchant, supported network/rail and exact displayed total. A changed
question, package or payee invalidates the observation; stale and cancelled
responses cannot enable the new request. Failed or malformed quotes expose no
funding or purchase controls. The existing purchase client still checks a fresh
quote before any signature and retains every server admission and settlement
guard. This change adds no financial authority or funding.

## Supported surfaces and verification

Web ordinary research receives the keepalive and manual original-report action.
Web prepaid preparation receives the validated-quote gate. API consumers may
ignore the additive metadata field and SSE comments. The desktop/local Operator
and buyer CLI retain their existing deliberate purchase and GET-only recovery;
remote/stdio MCP, extensions and chat bots retain their established research
roles. No package, installer, payment protocol, storage schema, custody, budget
or schedule changes are introduced by this outcome.

Focused tests cover long inference waits and timer cleanup; disconnected-reader
handling; same-original public/unlisted metadata; private-transport exclusion;
browser stream failure, premature EOF and reset; SSR observation failure;
quote refusal, economic-tuple changes and stale UI responses. Existing
publication/privacy, co-sign scope and ask authentication tests remain required.
Full required CI, type checking and the compiled production/browser build accept
the final candidate before merge. The existing release coordinator owns one
batched deployment; live verification and recipient guides require its delivered
source. Local fixtures and this owner-operated QA run do not count as independent
customer traction or a completed paid Operator business cycle.
