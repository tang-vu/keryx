# Reduce repeated public publisher reads

After the app75 deployment, public observations from the owner's PC measured
Pricing at 1.42s and Sources at 9.29s to first byte (10.54s total). These are
individual samples, not typical latency or proof of a specific production frame.
The installed health source was `50ad8e0e`.

The SQLite public reference list previously read all active snapshots, then checked
archive availability and counted articles again for every publisher. On an enrolled
connection, each prepare and execution also performs the existing fresh storage
checks. A synthetic 30-publisher directory performed 128 guard calls, including
30 archive probes and 30 individual counts. Simply caching an accepted schema or
database would weaken the existing boundary and is not the proposed correction.

The bulk reader checks archive availability once, selects active snapshots and
their article counts in one guarded query, then applies the same snapshot schema
and id/active/feed identity checks. A read savepoint keeps metadata and counts in
one snapshot. Every native statement retains its existing guard. There is no
cross-request cache, schema repair, new adapter capability or write authority.
Legacy stores keep their existing preview-only list without creating an archive.
Ordering, the ten-item preview and lifetime counts remain unchanged.

## Local measurement

Five alternating before/after pairs used the same synthetic in-memory mainnet
schema, native user bundle, immutable identity and full fresh native SQL guards.
Thirty publisher snapshots had no stored articles or query history. The source
directory results were compared byte for byte on every trial.

| Same fixture, mean per read | Before | Bulk reader |
| --- | ---: | ---: |
| Publisher list | 1531.61ms | 73.63ms |
| Complete synthetic source directory | 1602.76ms | 145.28ms |
| Fresh SQL guard calls for the directory | 128 | 12 |

Filesystem/manifest verification, network, real records and production contention
are outside this fixture. These results demonstrate removal of a repeated cost;
they do not establish a corresponding production speedup. An initial batch
timing whose fixture proxy refused its method was rejected, then corrected to
require ready data and the exact expected publisher count before any acceptance.

Ten focused cases passed: parity with the previous reader, active-only behavior,
legacy schema preservation, constant statement count as publisher count grows,
five corrupt snapshot refusals with transaction cleanup, fresh counts/activation,
and actual verified-connection refusal after a schema change. Focused ESLint
passed. Those original helper and test sources remain unchanged.

The actual enrolled SQLite adapter now delegates `listPublicReferences` to the
bulk reader. Five additional facade cases passed: legacy and archive result parity
with unchanged read-only file bytes, constant native statement count as publisher
count grows, refusal after schema drift, and refusal of malformed active snapshots.
The scoped TypeScript check passed. The offline paying-source study write and check
both exited successfully with zero outbound attempts; all 48 complete trial objects,
answers, metrics and payment results stayed identical. Its runtime source footprint
adds this helper (461 to 462 files) and refreshes the adapter hash. The root lock
and app75/MCP30/desktop28 metadata remain unchanged. Independent review and required
hosted CI for the completed candidate remain merge gates.

## Delivery boundary

The adapter caller is connected to the reader in the same focused outcome. The
archive writer remains owned by the concurrent catalog performance task and is
unchanged here. The existing release owner will merge this completed caller path
after review and required CI, then include it in the combined deployment. Local
synthetic results do not claim a production speedup.

The shared SQLite adapter reaches web/API, CLI, desktop, remote/stdio MCP and bots
within their current roles. The browser extension retains its API/handoff role.
No endpoint, source/payment authority, private visibility or distribution identity
changes here. The existing release owner handles final source acceptance, versions
and the combined deployment, followed by public response timing verification.
