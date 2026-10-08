# Confirm report feedback without inventing votes

## Observed client failure

The report's old Helpful controls increased counts and selected a rating before
the feedback POST. HTTP errors and connection loss retained those optimistic
values. A synthetic actual-component baseline on parent `b4a472fc` reproduced
two helpful votes becoming three after HTTP 500. Alternating the rating could
also append another vote, and a late initial GET could overwrite newer counts.

The API records feedback before reading its aggregate. A failed response can
follow persistence. The append-only database and existing anonymous API expose
no original-vote identity or idempotent recovery. Therefore the client cannot
promise that a failed response means an unsaved vote or a safe retry.

A separate installed-Supabase-client baseline also reproduced failed legacy
inserts and reads returning HTTP 200: the SDK resolves transport failures as
error results that the old feedback methods ignored.

## Candidate behavior

Extract the shared `AnswerFeedback` component. Counts come only from validated
server responses: nonnegative safe integers whose sum is also a safe integer.
Unknown counts stay unknown. Loading finishes before the first vote is enabled,
so the initial GET cannot overwrite a later confirmed POST. Keep the displayed
snapshot while sending and mark the rating only after a successful valid result.

After an HTTP error, connection loss or invalid response, say the feedback could
not be confirmed and may have been recorded. Do not automatically repeat it or
allow another append-only attempt in that mounted report. A synchronous event
guard prevents duplicate clicks before React commits the sending state; rendered
availability comes from state. Key the inner component to the report identity,
abort obsolete GETs and ignore their late body reads. Bound headers and body
observation to 15 seconds: an unavailable GET enables one vote with unknown counts;
a timed-out POST remains unconfirmed and cannot be repeated. Late completion
cannot replace either outcome. Unmounting does not cancel a submitted POST; its
observation deadline may abort local waiting without undoing server persistence.

Check resolved legacy Supabase errors explicitly for feedback insert/read. A
failed insert cannot be confirmed by older aggregate counts, and a failed or
non-array read cannot publish zero votes. The existing route returns HTTP 500;
SQLite and enrolled Supabase keep their existing rejection paths. No write retry
is added. The installed SDK may retry idempotent aggregate reads.

The metrics endpoint treats its feedback read as optional: preserve successful
core metrics and omit the existing optional satisfaction/count fields when that
read fails, including values from an earlier aggregate. Unavailable feedback is
not zero votes. Core metric failures retain their existing rejection behavior.

Buttons have spoken action/count labels, selected state only for a confirmed vote,
visible focus and 44px minimum touch targets. Pending and confirmed results use
status announcements; uncertainty uses an alert. The layout wraps on small screens.

This is one attempt per mounted report, not server-side deduplication or one vote
per person. Reloading/remounting can allow another attempt. Anonymous totals remain
engagement signals, not unique readers, independently accepted tasks or traction.
No new telemetry, identity tracking, backend authorization or database migration.

## Supported surfaces and distribution

| Surface | Scope |
| --- | --- |
| Shared web chat, saved dispatch/report and desktop-hosted handoffs | Same AnswerCard feedback correction |
| Compact iframe embed | Uses AnswerMarkdown directly and has no existing feedback control |
| Native-local desktop, CLI, remote/stdio MCP, API, extensions and bots | Existing research/feedback contracts and handoffs; no new voting adapter |
| Feedback HTTP API and SQLite/Supabase adapters | Same append-only contract; legacy Supabase feedback errors now propagate instead of false HTTP 200 |
| Dashboard/metrics API consumers | Successful core metrics survive a failed optional feedback read; existing optional feedback fields are omitted when unavailable |

App 0.27.33 is layered after PR229. Stdio MCP 0.4.9, hosted MCP 0.3.5 and desktop
0.4.10 retain parent candidate identities; this change does not establish their
publication or installation. Deployment/source readback and applicable distribution
identities remain separate from source and browser acceptance.

## Acceptance and release gates

`npm run test:browser-answer-feedback` bundles the actual component with the exact
built CSS. Controlled client responses cover loading and encoded query identity,
keyboard submission, unchanged pending counts, valid authoritative totals,
disabled pending controls, HTTP/connection/invalid-response uncertainty, invalid initial
counts, stalled GET/POST headers and bodies, late deadline completion, an obsolete
GET body and an obsolete POST across a report change. The event guard also receives
independent source review; disabled-control clicks alone do not prove same-tick
exclusion. Four
widths check 44px controls, long uncertainty text and overflow, retaining screenshots.
All real network requests are blocked; no database, research, model or payment.

`lib/api/feedback-route.test.ts` exercises the actual installed Supabase client
with controlled transport, including resolved HTTP/connection errors, failed
readback after possible persistence, malformed reads, successful insertion and
successful empty counts. No real Supabase table or credentials are used.
Metrics-route cases distinguish an unavailable feedback read from confirmed zero
without discarding or altering successfully read core metrics.

The existing reading-evidence suite covers the shared AnswerCard/DispatchView
integration. Both TypeScript graphs, focused lint, the default production build,
independent lifecycle review and exact-head CI are release gates. The first local
build's outside-root dependency junction failure and the first ref-render lint
failure are retained. Fix the render state and validate the same source in a
physical isolated QA export; do not weaken compiler/lint rules or fill D with
another dependency closure. A source export is a disposable validation artifact,
not a relocated checkout or production deployment.

Parent-first current-main reconciliation and the separate Operator owner's active
original/source lifetime must close before merge/deployment. Verify production
health and actual source/version identities before a delivered-product claim.
Physical screen-reader/device use and independent reader usefulness remain open.
