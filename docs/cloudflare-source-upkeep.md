# Scheduled source upkeep

Keryx's first Workers use is a small **Free-plan scheduler**, not a migration of
the application, database, paid content or settlement authority. An hourly Worker
wakes the existing VPS to refresh up to two active, verified RSS sources. Newly
ingested articles enter normal discovery and paid delivery through the existing
encrypted source-item storage boundary.

The September 30 read-only production audit found 13 eligible feeds and no feed
refresh cron, timer or running traction daemon. The old `refresh-feeds` script
remains available, but a historical reference to the volume daemon did not provide
an active schedule. With a stable 13-source catalog, the new cursor visits every
feed within seven hourly invocations. Publication dates do not prove last-fetch
time, and a completed sweep does not establish independent usage or settlement.

## Authority and limits

- The isolated `cloudflare/source-upkeep` project runs at minute `7` each hour.
  `workers.dev` and preview URLs are disabled; HTTP requests cannot trigger work.
- One fixed POST to `https://keryx.cc/api/internal/source-upkeep`, a 55-second
  client deadline, refused redirects and no retry loop. Cloudflare receives only
  aggregate outcome counts, never feed URLs, article bodies or payment keys.
  Native `redirect: "manual"` prevents following a 3xx Location; the returned status
  is refused. workerd does not support the Node-compatible `redirect: "error"`
  value: the first live attempt exposed this before any outbound request.
- A dedicated random 32-byte base64url bearer secret authenticates the call. The
  server endpoint rejects query parameters and bodies before opening the database.
  Missing/weak credentials leave it disabled. Rotate both sides to revoke a secret;
  never reuse a payment or user API key.
- SQLite `BEGIN IMMEDIATE` claims a monotonic UTC-hour slot and a 120-second lease
  in `sync_state.sourceUpkeep`, advancing a durable source-ID cursor before fetching.
  Independent processes cannot claim the same slot. Failed/interrupted slots remain
  consumed; the next hour advances beyond failed feeds. Corrupt state fails closed.
  Do not delete/reset this journal to retry a failed hour.
- Maximum two distinct sources and ten feed items per source per hour: at most
  48 feed fetches and 480 new item candidates per day. Each read uses the existing
  public-address/DNS-pinned transport, 500,000-byte limit, three redirect hops and
  12-second fetch deadline. The job stops waiting after 45 seconds; late reads
  cannot write after that deadline. XML parsing is synchronous but input-bounded.
- Source eligibility and the stored feed URL are checked again before storage and
  writes. Repeated links within a feed and existing links are deduplicated. Oversize,
  inaccessible or malformed feeds fail individually and the cursor continues.
- Scheduled items require encryption and use the existing encrypted SQLite backend
  even when Pinata is configured. This job performs no remote pins, LLM requests,
  content purchases, signatures or settlements. Other ingestion keeps its existing
  IPFS preference. Empty metadata-only items contain no paid body to encrypt.
- Supabase scheduling is unsupported and fails closed until equivalent atomic
  admission is implemented. The registry indexer and payout authority stay on the VPS.

These are per-job bounds, not account-wide spending caps. The Worker is intentionally
small and requires no Paid subscription, Queues, D1, KV or R2. Other Workers on the
account share allowances. Cloudflare's current [Free limits](https://developers.cloudflare.com/workers/platform/limits/)
and [pricing](https://developers.cloudflare.com/workers/platform/pricing/) govern
availability; account exhaustion can delay upkeep. Do not automatically upgrade.
The server journal protects against duplicate execution if a trigger is redelivered.
It does not make the VPS available during an outage.

## Deploy and verification

The Worker package pins the CLI and Wrangler and has its own lockfile. Build and
type-check it independently; never deploy the root Next.js project to Workers:

```powershell
npm ci --prefix cloudflare/source-upkeep
npx tsc -p cloudflare/source-upkeep/tsconfig.json
npm run build --prefix cloudflare/source-upkeep
npm run test:runtime --prefix cloudflare/source-upkeep
```

`cf build` delegates the raw Worker build to Wrangler. The pinned CLI beta can fail
to spawn Windows shims (`EFTYPE`); the identical locked build succeeds on Linux.
CI checks the isolated build there. An operator can copy the Linux-produced
`.cloudflare/output` build output and deploy it with `cf deploy --prebuilt` from
an authenticated development machine; no broad Cloudflare credential is required
on the VPS build host.

The runtime smoke executes the actual built Worker in native workerd with synthetic
credentials and an in-memory outbound fixture. It checks one fixed request, successful
completion, HTTP failure, and refusal to follow redirects; it never contacts production
or consumes the hourly journal. Node fetch mocks alone cannot verify native option support.

Put `KERYX_SOURCE_UPKEEP_TOKEN` in the VPS `.env.local` and matching
`SOURCE_UPKEEP_TOKEN` in a private, access-restricted JSON secrets file outside Git.
Deploy the web endpoint through the normal `origin/main` release flow first and
verify `/api/health` reports the pushed commit. Then from the isolated directory:

```powershell
cd cloudflare/source-upkeep
npm run deploy -- --prebuilt --secrets-file <private-secrets-json>
```

Verify the deployed script has no public/preview subdomain, the exact hourly cron,
and no Paid-plan change. After a scheduled call, read `sync_state.sourceUpkeep`
privately on the VPS: a current `slot`, `completedAt` and bounded `summary` are the
execution evidence. Count-only summaries contain attempted, added, failed and
skipped feeds. A repeated authenticated call in the same hour returns
`already_claimed`. Never publish the secret or source bodies. Existing registry,
backup and other watchdog cron entries must be preserved.

## Rollback and recovery

Remove only this Worker's scheduled trigger (or delete this isolated Worker) and
clear `KERYX_SOURCE_UPKEEP_TOKEN` from the VPS environment, then reload the web
process. Keep the SQLite journal and encrypted items already ingested. The existing
manual `npm run refresh-feeds` remains available; it is separate maintenance and
does not claim the scheduled allowance. Do not run competing bulk/manual sweeps
while validating scheduled upkeep. No automatic retry or scheduler failover is promised.

If a slot lacks `completedAt`, inspect the host and lease privately, restore service
and allow the next hourly trigger to continue. A corrupt journal requires operator
inspection rather than an automatic reset. There is no dashboard, general job engine
or desktop-autonomous scheduler in this increment.
