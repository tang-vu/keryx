# Public question history on the ledger

The October 15 production observation returned 156 recorded questions from
`/api/metrics`, while both default and current-network `/api/runs` returned HTTP
200 with an empty array. The ledger rendered that valid public listing as
"No dispatches yet", incorrectly suggesting no recorded activity.

Recorded metrics include all recorded origins. Public history retains its existing
privacy and cohort rules: only listed public runs are exposed when privacy is active,
and scripted runs are excluded. A missing historical privacy sidecar is unlisted;
this UI change does not publish or backfill any questions.

The ledger now labels the panel "Recent public questions", explains its scope,
and renders "No public questions to display" for a successful empty response.
Failed reads retain the existing unavailable/retry state. It requests the compiled
current network and all-time period through the existing classified history API,
which filters before pagination. This avoids deriving current activity by discarding
archived rows from a mixed, bounded sample after retrieval.

The shared history component accepts context-specific description and empty copy.
Other history callers retain their defaults. The shared web ledger is also used by
the desktop web handoff; API, CLI, remote/stdio MCP, extension and bot contracts,
payment totals, visibility settings and distribution versions remain unchanged.
No production data mutation, payment or credential action is required.

Validation covers positive recorded totals with empty public history, the selected
network/period, available answer links, failed reads, and the existing zero-earning
source leaderboard. English catalogue and UI copy guards remain applicable.
Delivery belongs to the existing single release owner and deployment batch.
