# Visible activity polling

The landing ticker previously dispatched `/api/activity` on mount and every
20 seconds regardless of page visibility or a previous response still pending.
A read-only performance diagnosis found substantial serving work behind this
endpoint. This change bounds the ticker's demand; it does not optimize that
backend work or claim a measured production latency improvement.

Each mounted ticker dispatches only while the document is visible, with at most
one unsettled read. Hiding the document aborts the current client request and
suppresses its eventual success or error. Returning to a visible document starts
a fresh read immediately, or waits for an aborted predecessor to settle before
starting exactly one replacement. Repeated visible events do not queue retries
behind a healthy pending read. Unmount removes the timer/listener, aborts the
request and suppresses late results. An abort does not prove that server or
SQLite work already dispatched has stopped.

The existing 20-second interval, no-store GET, response validation and
loading/confirmed-empty/unavailable UI distinctions remain. Hiding the page does
not turn an already displayed successful result into an error. The animation
pause button retains its existing role. No API response, payment/settlement
filter, public question/privacy boundary, database, version or deployment changes.

Focused controlled timer/deferred-response tests cover visible/hidden startup,
slow requests, cancellation that settles late, rapid visibility changes, real
failures, confirmed empty data and cleanup. Request counts under these controls
are not a production speed, billing or financial correctness benchmark. Applicable
production-build, browser, full PR/domain/native and exact-main gates still apply.
