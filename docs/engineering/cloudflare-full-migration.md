# Cloudflare hosting migration

Owner direction, November 3, 2026: move all hosted Keryx infrastructure to
Cloudflare. Keep the VPS and current domain serving during preparation. Switch
the domain only after the Cloudflare environment is complete and accepted.
Workers Paid is accepted in principle; report the total estimate before enabling
paid resources. Existing financial, custody, original-retention and CI gates remain.

## Current implementation

`cloudflare/migration` is an isolated compatibility preview over the existing
application source. Its own dependency graph and React version do not change the
Node/VPS runtime. The preview uses Arc testnet/offline configuration, a separate
credential, no public production route and no schedules. Every asset passes
through the credential gate. API, MCP and write requests remain refused while
the canonical storage and financial paths have not migrated.

`/__migration/health` explicitly reports `productionReady: false` and disabled
payments. A rendered preview is not financial or storage acceptance. The preview
must never proxy to the VPS and be represented as a completed migration.

Install the canonical application's dependencies with `npm ci` first, then
`npm ci --ignore-scripts --prefix cloudflare/migration`. The application requires
its reviewed, hash-verified validation compatibility patches; the preview build
verifies those patches too. Run the preview's `check`, `build` and `test:built`
scripts independently from the Node application's acceptance. The built test
requires `KERYX_CLOUDFLARE_TEST_DIR` under the canonical checkout's `.local/`, and
blocks external network access while exercising real workerd and Chromium.

The managed public catalog adapter implements the native publisher, archive,
literal search and keyset-pagination contract. Pure validation/query code is
shared with the native adapter; its file, schema, transaction and write-capacity
guards are retained. The new adapter is not the application database selector.
Only credential-gated, metadata-only `GET /__migration/catalog`, `/stats` and
`/publishers` preview endpoints use it. No HTTP mutation or financial capability
is exposed. D1/R2 provisioning and production data import are separate operations.

D1 stores publication pointers and immutable index revisions. Private R2 stores
the exact original and normalized JSON bytes under SHA-256 keys, avoiding D1's
2,000,000-byte row limit without raising the native 2 MiB field bound. Existing
objects are verified, never repaired or overwritten. Reads share a primary D1
snapshot, verify publisher/body provenance, then check publication revision in a
new primary session after R2 loading. Stale publication observations fail closed.

Every D1 batch checks the compiled, source-known schema and catalog identity
inside the transaction. The adapter cannot install or repair DDL. Writes stage
bounded immutable objects and index chunks before atomically publishing article
pointers, publisher metadata and a compare-and-swap revision. A failed or
interrupted stage remains invisible; retry can finish the same index. Queries
join only the current revision's terms. Completed terms and historical versions
are retained and immutable. Generations isolate catalogs and cursors; `ready=0`
allows preparation while refusing reads. Operations retain bounded fields,
input bytes and a 15-second deadline; these are explicit capacity refusals,
not clipped content or silent truncation.

The workerd tests exercise actual D1/R2 bindings against native SQLite, including
all query orders, 32-term search, historical-version recovery, bodies larger than
D1 rows, interrupted-index retry, concurrent publication/schema changes,
corrupted objects and forbidden payout fields. The compiled browser test also
checks credential admission and the metadata-only catalog endpoint.

## Public-data transfer tools

`operator/export-selected-public-catalog.ts` is an explicit Node operator entry
point, not application startup. It accepts only
`--export-selected-public-catalog`, uses the existing environment-selected sealed
SQLite deployment with its source-known profile and a read-only connection, and
never accepts a database filename. Its stdout is a private canonical JSONL
snapshot, not an authority grant or completed whole-store intake. Keep it under
canonical `.local/backups/` with owner/SYSTEM-only Windows permissions.

Before target access, verify native SQLite allocation containment using a separate
in-memory pressure probe. The entry point checks its actual Linux cgroup memory
limit (128–512 MiB) and disabled swap before opening the selected store. The
qualified operation uses a 384 MiB/no-swap transient unit, read-only system
mounts, configured `IPAddressDeny=any` and a 150-second outer deadline. Record the actual
OOM refusal and owned process/unit cleanup for the probe, then reuse that proof
only while the platform and configuration match. A heap-limit PRAGMA readback
does not substitute for this proof.

Mutable publisher/article/version headers and the literal term-index digest share
a read transaction capped at 15 seconds. Bounded keyset pages and an incremental
SHA-256 over canonical term JSONL avoid one hash allocation per term. Exact
immutable version bodies are then read four rows at a time after releasing the
header snapshot, preserving raw original JSON and source rowids without holding
the transaction open during transfer. A final metadata/index snapshot reports
changes during export. The entire export has a 120-second processing deadline,
2 MiB field, 32 MiB metadata, 500,000-row and 192 MiB output bounds. Failure
emits fixed diagnostics and no completed footer; incomplete files are refused.

`operator/public-catalog-plan.ts` exposes the offline `planPublicCatalog` operator
function. Give it an accepted private export and a fresh directory under
canonical `.local/tmp/`; ensure that directory inherits owner/SYSTEM-only access
before writing real data. It does not access a network or production store.
Strict public DTOs, canonical framing, byte/count bounds and a rolling source
digest bind every record. Re-derive current index weights from retained bodies
and compare the exact ordered digest with the source index; an inconsistent
source cache is refused, never silently repaired. Preserve historical raw bytes
as content-addressed object files and retain the unique source snapshot separately
from these regenerable object/SQL caches.

The plan emits an empty-target-only bootstrap and bounded D1 batches guarded by
the compiled schema, expected generation, revision zero and `ready=0`. It does
not set `ready=1` or expose an HTTP importer. Use the pinned Node/CLI toolchain,
manually provision the dedicated resources after the cost report, upload exact
objects, and verify actual remote bodies, metadata, term digest and counts before
an explicit final seal. `KERYX_CATALOG_DB_ID` and `KERYX_CATALOG_GENERATION` are
trusted build inputs for that accepted private catalog. They cannot activate
production payment, routing or private-store authority. A stable copied public
catalog still requires fresh privacy checks/delta migration at final cutover.

The credential-gated `GET /__migration/catalog/verify/{publishers,versions,terms}`
endpoints inspect only the initial generation at revision zero, including while
`ready=0`. They cannot publish or repair anything. Bound cursors to generation,
kind and full ordered keys; a live publication revision refuses import inspection.
Publisher and retained-version inspection reads actual R2 bytes, validates hashes
and native provenance, and checks any current article header against that body.
Return metadata and freshly computed object hash/size receipts, never body text.
Terms use bounded pages for an operator's exact ordered digest comparison.
Every inspection finishes with a fresh primary schema/revision fence after I/O.
Verify complete expected row/object sets and digests before the separate seal;
an upload acknowledgement alone is not a completed migration audit.

Run `node scripts/cloudflare-migration.mjs --summary` for a read-only inventory
of reachable native-runtime constraints and the actual persistence interface.
The framework's compatibility percentage does not inspect native storage,
subprocess execution, custody, or financial authority.

## Intended runtime boundaries

| Surface | Cloudflare target | Required behavior |
| --- | --- | --- |
| Existing pages, API and streaming | Workers, compatibility-tested framework adapter | Preserve routes, CSP, authentication, privacy and stream aborts |
| Public catalog and query projections | D1 | Bounded reads and indexes; publication/erasure checked before returning text |
| Sessions and atomic financial coordination | SQLite-backed Durable Objects | One authority for each budget/reservation, nonce and original; no reliance on cross-object atomicity |
| Files and encrypted source bodies | R2 | Retain encryption, hashes, access checks and exact article versions |
| Long research and recovery | Workflows/Queues | Idempotent transitions; uncertain external settlement retains its original state |
| Native HTML/PDF parsing | Stateless Containers where necessary | Existing byte/time/memory limits, aborts and secret-free parser isolation |

This mapping is a target. No current SQLite/file authority is replaced by a
stub, a generic SQL endpoint, an eventually consistent cache, or a Container's
ephemeral disk. The current co-sign Map requires an owner-scoped broker before
SSE and signature callbacks can reach different Worker instances. Financial
capability objects, protected filesystem identities and custom SQLite functions
also require explicit domain adapters, rather than JSON serialization of trust.

## Cost envelope

Published rates checked November 3:
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) and
[Containers](https://developers.cloudflare.com/containers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/) and
[R2](https://developers.cloudflare.com/r2/pricing/).
Workers starts at USD 5/month. The updated planning range is USD 5–15/month for
small traffic and storage, excluding tax, AI/search, existing account usage and
usage above the assumptions. This is an estimate, not a hard spending cap.

The calculator assumes one basic Container (1 GiB, 1/4 vCPU, 4 GB disk), at most
60 active hours/month, 30,000 Worker requests, 300,000 Worker CPU milliseconds,
and 1 GB retained data. Charging all Container quantities without reusing shared
included allowances gives USD 1.68048, or USD 6.68048 with the Workers base fee.
Measure actual peak memory and invocation usage before choosing the final type.
An always-running application container has a different cost profile.

For the catalog, assume no more than 250 new articles/day, approximately 127
terms/article as observed in the initial source inventory, three D1 row/index
writes per term, fewer than 50,000 R2 writes and 200,000 R2 reads/month, and
1 GB retained storage. Allow USD 3 for D1 writes, USD 4.50/0.36 for rounded R2
Class A/B operations and USD 0.02 for storage if shared included allowances are
already consumed. Combined with the conservative base/Container calculation,
this is approximately USD 14.56/month before other above-assumption usage.
Actual D1 index maintenance and Worker/DO usage must be measured during staging;
this estimate grants no additional financial policy, funding or spending cap.

The subscription-create request returned Cloudflare HTTP 403 (authentication
error). This migration has not enabled a paid subscription. That response
identifies the CLI's billing permission; it does not establish the account's
current Workers plan. The owner's Workers plans view and a successful private
preview upload subsequently confirmed the existing Workers Paid entitlement.
No second subscription is needed.
No production routing, Container or data import is accepted by this observation.

## Completion and cutover

First qualify the isolated Worker build, real browser navigation and bindings.
Then port storage and execution domains against their existing contracts and
failure tests, preserving one source of truth and the retained originals.
Use synthetic offline fixtures before importing live data. Keep snapshots of
current-public text private during staging; revocation must stay fresh at cutover.

Before domain cutover, verify complete data counts and hashes, fresh privacy
reads, exact source and CI, browser/API/MCP/bot/extension roles, custody and finite
policy validity, restart recovery, ambiguous-payment behavior and actual latency.
Drain only the old writers for the final migration and verify exclusive new writer
admission before new paid activity. Keep the VPS available for the documented
recovery path; a DNS rollback cannot independently undo a financial-store cutover.
