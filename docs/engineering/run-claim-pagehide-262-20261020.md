# Retire abandoned standalone claim attempts — issue 262

The standalone claim page already erased its closure-held credential on
`pagehide`. Its asynchronous save handler did not recheck that boundary. A late
authentication response could therefore dispatch `{token:null}` after the secret
was forgotten. A late claim response, JSON body or failure could replace the
restored page's unavailable message with an obsolete success/error notice.

Each explicit save now captures the page's existing revision and checks that
revision and credential after asynchronous boundaries. Leaving the page retires
the attempt before a new POST can be dispatched. An already dispatched response
is ignored after retirement; its unread body is cancelled without waiting for
cleanup. Late body results and failures cannot restore an obsolete status.

This does not cancel or reverse a server-side claim. An already submitted request
may have completed even when its acknowledgement is discarded. The credential
still cannot be replayed, recovered or reissued, and no automatic history request
is added. Original payer, payment records, research and rewards are unchanged.
Default-off and deployment/schema admission remain unchanged.

Six new Chromium regressions fail against the previous runtime. They pause at
authentication, response headers and JSON-body completion, with both success and
failure, then invoke the actual `pagehide`/`pageshow` handlers. These are controlled
persisted-page lifecycle events; they do not establish actual back/forward-cache
navigation qualification. The tests verify no post-retirement POST, no obsolete
status, no retry on focus/check, and no credential in DOM, storage or external
requests. Existing privacy/injection, owner-change, disabled/refused, emitted-byte
CSP and Next config-loader assertions remain intact.

Issue 262 remains open for the existing rollout, original-store admission and
supported-delivery acceptance described in [anonymous run claims](../anonymous-run-claims.md).
The existing coordinator owns exact-main acceptance and batched runtime delivery.
