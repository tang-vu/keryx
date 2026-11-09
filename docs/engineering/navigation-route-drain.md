# Drain navigation fixture routes before context disposal

Main CI run 42572028316 reached its existing 30-minute job deadline after the first
Chromium navigation case passed and printed `context-cleanup-start`. The subsequent
cleanup-complete marker and remaining route assertions were absent. This locates
the stall within the fixture's unroute/close sequence; it does not identify which
Playwright operation stalled or reproduce the production origin CPU incident.

The fixture previously removed its interceptor with `unrouteAll(ignoreErrors)`
while proxy handlers could still be active, then closed the context. The new
fixture-owned drain keeps the same GET-only interceptor installed. Once cleanup
starts, new arrivals abort instead of forwarding; held final routes are aborted,
and tracked handlers settle before context closure. No unhandled route is allowed
to bypass the original network fence during teardown. Every normal navigation,
prefetch, loading-time, touch, cancellation, fragment history, destination heading,
wallet-absence and HTTP-status assertion remains unchanged.

Drain and context-close phases each have a 10-second bound. Exceeding a bound is a
failed fixture, never a passing navigation result or permission to omit later
cases. Handler errors remain recorded even if the handler settled before cleanup;
abort and close failures are retained. A failing case and failing cleanup are
reported together. Outer disposal attempts the owned Next server stop even when
browser close rejects, preserves a fixture if server exit is not observed, and
reports browser cleanup complete only after successful closure. This change does
not replace Playwright's browser-process disposal or the existing CI job deadline.

Deferred-route regression controls exercise a genuinely pending proxy/held abort,
new arrivals during drain, earlier asynchronous errors, failed and synchronous
aborts, and both timeout paths. Actual compiled Chromium and WebKit navigation
fixtures remain required in PR/main CI. The historical browser stall is retained
as baseline evidence; the controls establish the new lifecycle ordering rather
than claim a deterministic reproduction or statistical elimination of every flake.

This is test infrastructure. Application, API, payment/custody, adapter contracts,
runtime versions and production launch configuration remain unchanged. It neither
repairs nor diagnoses the recurring origin 502 trigger and adds no production
attachment, watchdog, retry, schedule or deployment.
