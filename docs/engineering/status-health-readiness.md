# Current health observations on the status page

The status page previously cast any parsed health JSON to its display type and
treated a truthy `ok` with a non-degraded status as available. An HTTP503 carrying
a successful-looking body, a missing status, an incorrect service/datastore or an
old timestamp could therefore leave the page green.

The existing same-origin health GET now refuses redirects and admits a response
only after HTTP200, a bounded32KiB JSON read and validation of the readiness and
displayed base scalar fields. The identity is `keryx`, `ok` is exactly true,
`db` is `ok`, and status is explicitly `operational` or `degraded`. A finite server
timestamp must be within two minutes behind or one minute ahead of the local
clock, checked after body consumption. Uptime is a nonnegative safe integer;
commit is null or a bounded string; reasoning, settlement mode, network and the
coarse RPC label are bounded nonempty strings. This follows the external monitor's
readiness/freshness contract while retaining a separate UI implementation.

`readBoundedJson` preserves its existing strict UTF8, byte-limit, body cancellation
and reader-release behavior. No shared reader or API response schema changes.
The eight-second request deadline, ten-second health poll and sixty-second
treasury poll remain. Failed health observations clear the prior health/details
and display the existing localized `Unavailable` copy; a later valid GET can
restore availability. A valid degraded response keeps its details and degraded
label. Historical monitoring completeness and optional registry, settlement,
reconciliation and traction sections remain independent API projections. The
new guard validates readiness/base scalars, not every optional section's schema
or the underlying financial evidence.

Native Chromium tests bundle the actual StatusPage component and React and use
an owned loopback HTTP server for health and treasury responses. The surrounding
site shell, optional section presentation and rich copy are isolated adapters;
the availability label uses the authored English operations copy. This is not
full Next/CSS or live-provider acceptance. Before the fix, two valid controls
passed and six HTTP/identity/datastore/missing-status/stale/refresh cases failed.
The final fixture also covers redirect refusal without following the target,
malformed and oversized JSON, and cancellation of an unfinished native response
at the existing deadline. Unit stream/freshness/scalar boundaries complement
that wire proof. All fixture application requests are synthetic GETs, with no
external requests, wallet, signing, research or payment operation.

The web status page changes; `/api/health`, the off-host monitor and supported
desktop, CLI, MCP, extension and bot contracts stay unchanged. No version, locale,
dependency, deployment, release, payment authority, funding or schedule change.
This corrects status reporting and does not identify or repair the earlier web
CPU-saturation trigger.
