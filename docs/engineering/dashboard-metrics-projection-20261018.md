# Dashboard metrics projection

DashboardView now requests `GET /api/metrics?view=dashboard`. It consumes fresh
aggregate metrics, creator earnings and the source leaderboard, with the existing
usage and mixed-origin/all-time scope disclaimers. The explicit projection does
not read payment-topic history, daily series, feedback, activation data or the
historical archive. A slow unused engagement or archive read therefore cannot
hold the dashboard response open.

Calls without exactly one `view=dashboard` selection retain the full default
response and its required/optional failure behavior. HeroStats and other API
consumers keep that default. No response cache, timeout change, database schema,
settlement calculation or authority change is introduced. The source leaderboard
still uses its existing settlement evidence, private-run checks and unknown-fee
handling; creator names remain display metadata only.

An offline profile of the real default route on app0.27.77, using synthetic
adapters and the real source helper, observed twelve adapter calls per configured
archive request. Controlled unresolved feedback and archive-summary promises
proved that unused data could block the response. This projection removes four
unused database calls and archive open/summary while retaining all five core
database reads and any fee-allocation run reads required by the helper. The
profile establishes a dependency issue, not which production database phase was
slow or a measured production speedup.

Route regressions cover full defaults and ambiguous selectors, skipped reads that
throw or never resolve, repeated fresh reads, source identities, private fee
evidence and unchanged default failures. Existing metrics, feedback, source
leaderboard and public privacy tests remain applicable. The dashboard rendering
fixture asserts the explicit request; compiled browser fixtures already match
the metrics pathname and remain compatible with the query.
