# Batch fresh source catalog metadata reads

The dashboard already loads its sections independently. Its metrics request can
still block other requests on the synchronous SQLite connection: listing sources
previously performed separate retained-claim and registry-origin reads for every
source. Each SQL operation also performs the enrolled connection's full fresh
storage checks. Adding `Promise.all` does not parallelize this synchronous work.

`listSources` and `listAllSources` now fetch claim markers and registry origins in
batches of at most 100 sources. Source rows and metadata share one synchronous
read transaction; an existing caller transaction remains owned by the caller.
The original single-source readers remain the comparison oracle. Shared decoders
preserve primary marker presence priority, corrupt-managed fallback, the existing
legacy claim/history first-match predicate, invalid legacy registry IDs and strict
registry-origin envelopes. Every SQL statement retains its full connection guard,
and the enrolled facade retains its post-await assertion. No result, admission or
authority verdict is cached. Schema, privacy, financial originals and writes are
unchanged.

The focused native suite passes 21 tests across `source-catalog-list.test.ts`,
`public-source-claims.test.ts` and `source-registry-origin.test.ts` (exit 0, full
EOF). It compares complete results with the unchanged single-source readers,
including damaged and competing retained records, invalid registry IDs and strict
origin refusal. It covers multiple batches, caller transaction ownership, a
genuine two-connection WAL update, active/inactive behavior, unchanged enrolled
readonly file bytes and fresh schema-drift refusal. Before the runtime change,
the bounded-statement regression failed with 396 metadata prepares for 101
sources; the unchanged assertion now passes.

A single paired local benchmark uses the same synthetic fixture generator and
configuration: 166 public runs with 64 KiB answers, 24 active sources with registry
IDs, 12 public references and 12 synthetic fee originals. It uses the genuine
enrolled readonly facade and full native schema/identity guards. Both runs exit
0 with full EOF, zero outbound attempts and unchanged fixture file bytes.

| Segment | Before | After | Fresh identity-check reads, before → after |
| --- | ---: | ---: | ---: |
| List 24 sources | 4,706.610 ms | 319.770 ms | 196 → 13 |
| Dashboard metrics composition | 6,964.166 ms | 2,444.244 ms | 284 → 101 |
| Three dashboard methods, sequential | 9,412.687 ms | 5,056.775 ms | 383 → 200 |
| Three dashboard methods, `Promise.all` | 9,495.754 ms | 5,219.821 ms | 383 → 200 |

The counters observe actual delegated native statements; they do not bypass any
guard. Factory creation still takes about 3.8 seconds and the public count about
1.9 seconds in the after run. Fee status is intentionally incomplete in this
synthetic fixture. These measurements establish the removed source-list
amplification, not production latency, complete financial eligibility or a fix
for every dashboard delay. Runtime pins and full outputs are retained under the
outcome's local `output/dashboard-perf` and `output/source-catalog-batch` paths.

| Surface | Applicable behavior |
| --- | --- |
| Browser dashboard and hosted APIs | SQLite-backed source catalog reads receive the optimization; progressive section loading is already independent. |
| Hosted remote MCP, OpenAI-compatible API, agent-to-agent API and bots | Server-side callers of this SQLite catalog share the fresh batched projection. Adapter, payment and evidence contracts are unchanged. |
| Local CLI | A local enrolled SQLite checkout receives the same catalog behavior. Other storage backends are unchanged. |
| Stdio MCP and native desktop | The existing closed source graphs (162 stdio, 104 helper and 36 renderer modules) contain none of the three changed DB modules. No native/npm package version change or publication is implied. Final release provenance remains ROOT's gate. |
| Browser extension | Hosted research/catalog behavior follows its server; extension source and artifacts are unchanged. |

Required hosted checks, final-source study provenance, merge and the coordinated
deployment remain pending acceptance by ROOT. This outcome does not authorize a
separate deploy or new spend.
