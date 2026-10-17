# Reduce repeated public publisher reads

After the app75 deployment, public observations from the owner's PC measured
Pricing at 1.42s and Sources at 9.29s to first byte (10.54s total). These are
individual samples, not typical latency or proof of a specific production frame.
The installed health source was `50ad8e0e`.

The SQLite public reference list reads all active snapshots, then checks archive
availability and counts articles again for every publisher. On an enrolled
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
passed. Caller integration, independent storage review, applicable checks and
required hosted CI still gate the complete runtime candidate.

## Delivery boundary

This reader and tests are a source preparation for the existing coordinator's
public archive performance outcome. The adapter's existing `listPublicReferences`
method must delegate to the helper before claiming a runtime correction. The
archive writer remains owned by the concurrent catalog performance task; the
separate helper avoids modifying that claimed file. No unused helper-only release
or independent deploy is intended.

The shared SQLite adapter reaches web/API, CLI, desktop, remote/stdio MCP and bots
within their current roles. The browser extension retains its API/handoff role.
No endpoint, source/payment authority, private visibility or distribution identity
changes here. The existing release owner handles final source acceptance, versions
and the combined deployment, followed by public response timing verification.
