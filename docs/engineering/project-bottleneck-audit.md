# Project bottleneck audit

The November 5, 2026 audit starts from `1395da506ff7eb5231a297f8e7c54a94399d3ecf`.
Its exact-source main CI [run 42019931598](https://github.com/tang-vu/keryx/actions/runs/42019931598)
passed checks, all three unit shards, integration, source-browser and production
lanes, and the actual `build-and-test` aggregate. The production lane includes
the build and compiled browser/API checks. This is reusable baseline evidence
for unchanged source, not acceptance of a subsequent patch.
The three unit shards report 17,985 passing tests and 16 explicit skips; stdio
MCP reports 83 passing tests, and SourceRegistry reports 92 passing tests.

## Archive page publisher reads

`querySqlitePublicReferenceItems` selected a bounded article page and then issued
one separate publisher read per distinct publisher. Each read goes through the
enrolled SQLite connection guards. Even tiny publisher snapshots therefore made
multi-publisher pages block the serving thread for substantially longer.

The reader now selects all publishers for the returned page in one parameterized
query, inside the existing read snapshot. The page limit bounds this to 100 IDs.
Every original publisher snapshot still passes the full schema, ID, active and
feed-identity checks. A missing publisher refuses the entire page. Count, item
validation, order, cursor encoding and the lookahead boundary are unchanged.
There is no new cache, schema, storage connection or payment authority.

An isolated Windows/Node 24.21.0 measurement used the actual read-only enrolled
facade, 20 synthetic publishers and one archived article per publisher. Both
versions read the same enrolled database without changing its contents. Five
20-item reads produced these timings:

| Reader | Median | Range |
| --- | ---: | ---: |
| One publisher statement per ID | 1,161 ms | 1,126–1,173 ms |
| One bounded publisher statement | 303 ms | 286–358 ms |

The complete page JSON hashes matched in every sample, including article bodies,
timestamps and order. The measured reduction was 73.9%. This is a contained
synthetic database measurement; it does not establish deployed browser latency.
Small one-publisher pages retain one publisher read and have no predicted gain.

Focused validation covers multi-publisher pagination at limits 1, 20 and 100;
unchanged originals and totals; corrupt later publishers; missing parents;
snapshot rollback; empty results; and fresh refusal when a corrupt lookahead
publisher enters a subsequent page. Existing archive/list tests also cover
concurrent readers/writers, immutable versions, actual enrolled read-only and
write facades, missing fences and predecessor-schema refusals.

## Surface and remaining-scope audit

| Surface | Relevant evidence and impact |
| --- | --- |
| Web/API | Sources and public article APIs share this SQLite archive reader; full PR build/browser acceptance remains required. |
| CLI and remote/stdio MCP | Shared archive reads keep the same return contract; baseline integration includes CLI startup and stdio MCP checks. |
| Desktop | Baseline exact-source Operator desktop workflow passed. No desktop adapter or packaged client behavior changes in this patch. |
| Browser extension | Baseline main CI packs the allowlisted extension. Its handoff/formatter contract is unchanged. |
| Bots | Existing shared source contracts and payment paths are unchanged. This patch adds no bot command or execution authority. |
| Contracts/payment/custody | Baseline main checks include contract tests; separate Windows payment, treasury custody and native/storage-capacity workflows passed. No live payment or custody trial is inferred. |

This focused fix does not close the whole-project performance investigation.
Retained-evidence metadata verification, cold archive validation, reference
snapshot payloads and end-to-end research latency need separate current-source
measurements. The rejected November 4 SQL metadata prototype must not be used as
an accepted optimization. Availability source paths remain with their existing
owner. Live model/payment trials and deployment need their applicable authority.

Local measurements and baseline workflow status are retained under canonical
`.local/release-evidence/project-bottleneck-audit-20261105/`; the synthetic database
and benchmark driver are under its matching `.local/tmp/` task directory.
Required PR/domain CI and source review must succeed before merge. Source merge
does not deploy or publish a release, and no release version is allocated here.
