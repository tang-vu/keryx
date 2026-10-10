# Research-chat quota fixture hydration

The fresh quota page in `scripts/test-browser-research-chat.mts` entered its
draft immediately after `DOMContentLoaded`. That event does not establish
React readiness. Holding the retained production hydration bundles reproduced
an early server-rendered textarea fill being erased when the controlled form
mounted, leaving the ordinary dispatch button disabled. PR368's exact-head
production journey failed at that disabled click. The CI log did not capture
draft/hydration state; the controlled replay establishes a sufficient ordering
cause with the same observed failure, rather than a measured CI timing trace.

Wait for the existing parsed availability message to render before entering
the quota draft. Then require the exact draft, enabled ordinary dispatch and
zero requests before one click, and exactly one quota request afterward. Keep
the existing HTTP429/Retry-After60 response, wait-path copy, retained draft and
no-wallet-funding assertions. No forced click, control change, timeout increase,
automatic retry or privacy relaxation is introduced.

The fixture and relevant research runtime files were identical between main
`69be7eeb` and account candidate `e0803ba7`. The account catalogue adds keys while retaining all
existing message values. A source ordering defect may be exposed by a different
bundle schedule without a change to research controls. The quota readiness fix
is a separate fixture outcome; account PR368 retains its eight-file scope.

Local acceptance executes the candidate's actual quota block against retained
built HTML/chunks with held hydration assets and fully intercepted synthetic
HTTP. It checks 320px, 390px and 1366px, together with operations TypeScript and
scoped lint. No Next server, database, provider, real signature, payment or
outbound request is required. The retained build is an earlier qualified
candidate, not a newly built exact fixture head; source compatibility and asset
pins are recorded separately. Hosted exact-candidate production build and full
journeys remain release gates, with the original failed CI retained.

Only test ordering/assertions and this note change. Web, desktop, CLI,
remote/stdio MCP, API, extension and bot runtime contracts, package/installer
versions, production deployment and product announcement remain unchanged.
