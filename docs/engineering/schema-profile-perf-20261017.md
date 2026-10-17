# Fresh SQLite application-profile comparison

The verified SQLite guard serialized the complete application schema into
JavaScript on every assertion. Native public-history reads invoke that guard
repeatedly. Compare the complete canonical document inside SQLite and return
one boolean, while preserving the original producer as the compatibility oracle.

The assertion still starts its own read transaction when needed and preserves
an existing caller transaction. Each call freshly checks the original metadata
limits: 2048 exclusions and rows, 256-byte names/table names, 131072-byte SQL,
and 2 MiB aggregate raw bytes. It then compares all ordered rows, including
type, name, table name, exact SQL, NULL and duplicate multiplicity. The literal
`name NOT LIKE 'sqlite_%'` predicate and bound exclusions are unchanged.

Only canonical source strings with the original four text/nullable-text fields
and at most 2 MiB encoded bytes use the native comparison. Matching one of these
strings also proves the final canonical encoded-byte limit. A bounded cache
retains source-string format validation only. No database, prepared statement,
target schema or previous admission result is cached. Unsupported source shapes,
native serialization errors and comparison mismatches use the unchanged producer
inside the same snapshot; this preserves legacy serialization behavior.

## Local validation

The synthetic tests compare acceptance against the unchanged producer. They cover
fresh SQL/type/table-name/NULL drift, extra and missing objects, duplicates and
same-count substitutions, views and implicit indexes, SQLite BINARY ordering,
exclusions, Unicode/NUL escaping, canonical source ordering/keys, both independent
2 MiB limits, exact individual/row limits, BLOB compatibility fallback, read-only
bytes, external schema changes and caller transaction ownership.

The focused schema tests and existing enrolled-public-usage tests passed 84/84
on this candidate (140.77 seconds). ESLint passed for the two changed TypeScript
files. Full type/build checks and required hosted acceptance belong to the
parent's reviewed combined candidate.

On Windows Node 24.21.0, five rounds of 50 assertions against a synthetic native
275-row/107267-byte mainnet schema measured 2.897 ms per original assertion and
1.739 ms per optimized assertion, including fresh metadata and transactions
(about 40% lower time for this guard). Tuple-based scalar joins were also measured
and provided substantially less improvement; they were not selected.

One paired public-usage benchmark used the parent's same synthetic 158-run
fixture: 156 public, one private and one unlisted run. Original versus optimized
times were 1573.9 versus 1569.9 ms for published history, 752.4 versus 697.7 ms
for ten history rows, and 262.1 versus 247.3 ms for the financial summary. Runtime
guard calls (67/34/12), native prepares (543/276/98), transaction statements and
returned results stayed the same. This single sample establishes no reliable
whole-page speedup: filesystem/other authority guards still dominate. Local
evidence is retained in `output/schema-profile-perf-20261017/`.

The public production latency observed earlier is a separate acceptance item;
these isolated measurements do not establish its cause or its resolution.

## Supported surfaces and delivery

The change is internal to the shared verified SQLite connection used by web/API,
CLI, stdio MCP and desktop/Operator storage paths. It changes no source profile,
storage enrollment, payment authority, privacy projection, external contract,
installer, configuration or supported backend. Hosted/remote clients and the
extension continue their existing API roles. Production deployment, package and
installer provenance, required CI and any version allocation remain with the
existing ROOT release owner. Include this focused outcome in that combined batch
only after independent review and required acceptance; no separate deployment is
authorized by this document.
