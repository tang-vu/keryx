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
[Containers](https://developers.cloudflare.com/containers/platform/pricing/).
Workers starts at USD 5/month. The initial planning range is USD 5–10/month for
small traffic and storage, excluding tax, AI/search, existing account usage and
usage above the assumptions. This is an estimate, not a hard spending cap.

The calculator assumes one basic Container (1 GiB, 1/4 vCPU, 4 GB disk), at most
60 active hours/month, 30,000 Worker requests, 300,000 Worker CPU milliseconds,
and 1 GB retained data. Charging all Container quantities without reusing shared
included allowances gives USD 1.68048, or USD 6.68048 with the Workers base fee.
Measure actual peak memory and invocation usage before choosing the final type.
An always-running application container has a different cost profile.

The subscription-create request returned Cloudflare HTTP 403 (authentication
error). This migration has not enabled a paid subscription. That response
identifies the CLI's billing permission; it does not establish the account's
current Workers plan. Verify Workers plans and the actual upload entitlement
before asking an administrator to upgrade an account that may already be Paid.
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
