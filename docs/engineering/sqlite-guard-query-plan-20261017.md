# Keep fresh SQLite schema checks while reducing temporary SQL copies

The enrolled SQLite adapter verifies identity, path, file, fences and the schema
profile at each guarded statement boundary. Several API reads repeat those checks
across statements and iterator steps. This change reduces one repeated native
schema comparison; it does not cache an accepted database or bypass any check.

`sqliteSchemaMatches` still executes one fresh SQLite statement and returns only
one boolean. It materializes `rowid`, name and object type, finds the smallest
matching rowid, and compares that row's SQL directly inside SQLite. The previous
query also materialized every SQL definition in its temporary covering index and
sorted matching rows to select the first. Both queries use exact name, type and SQL
comparison. A missing row, NULL definition or NULL expectation still refuses;
duplicate name/type records still select the lowest rowid, even if a later record
would match. Stored SQL is never evaluated as code or copied into JavaScript.

## Measurement and limits

A local Node 24.21.0 in-memory fixture installed the full native mainnet and public
archive schema with a synthetic identity: 698 schema objects and 299 source
fences, with no application or archive-term rows. Fifty alternating before/after
pairs freshly prepared the matcher and JSON-encoded its inputs on each call.

| Same fixture, 50 checks | Before | After |
| --- | ---: | ---: |
| Fixed full-fence matcher | 185.97 ms | 139.86 ms |
| Rebuild and assert all fences | 427.37 ms | 349.18 ms |
| Identity, fences and schema profile within BEGIN/COMMIT | 638.44 ms | 533.28 ms |

The matcher took 24.8% less total time in this observation; the wider native SQL
guard portion took 16.5% less. The query plan uses a small name/type covering index
and a native integer rowid lookup; its temporary index no longer carries stored
SQL. A ROW_NUMBER variant was slower and was discarded.

This measures a repeated metadata cost, not production request latency. The
observed busy web process and SQLite timeouts do not establish this matcher as
its hot frame or sole cause. Database content scans, request fanout, filesystem
checks and lock contention remain outside this measurement. No production data,
credentials, network calls or file-backed database were used by the benchmark.

## Regression coverage and surfaces

Focused tests cover duplicate first rows with differing kinds/SQL, negative
rowids, NULL and incomplete expectations, byte-exact SQL, SQL-looking string data,
and successful repeated checks followed by drop/recreate mutations. A synthetic
metadata table exercises duplicate records because current Node SQLite refuses
writing forged `sqlite_schema` rows. Real native schema tests retain that refusal,
funding/fence drift detection and read-only behavior. Seven matcher tests and
11 selected native profile/fence/index/stale-iterator boundary cases passed,
along with scoped TypeScript. Two earlier broader selections exceeded their
local wrapper deadlines; they are not passing-suite evidence. Required full
hosted CI remains a merge gate.

The existing offline study was regenerated and checked through its real
48-trial producer. Every trial and quantitative field remained identical; among
461 runtime inputs only the matcher source pin changed. No generated hash was
edited manually.

The shared SQLite helper reaches web/API, CLI, remote/stdio MCP, desktop and bot
adapters wherever they use the enrolled database. No endpoint, schema, payment,
custody, capacity, extension protocol or client contract changes. The browser
extension continues to use its existing API/handoff boundary. Release versions,
publication and the one combined deployment remain with the release coordinator.
