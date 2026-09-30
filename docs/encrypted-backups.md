# Encrypted off-host SQLite backups

`npm run backup` preserves the hourly consistent local gzip snapshot. With a dedicated
encryption key it also stages an AES-256-GCM encrypted gzip (`.sqlite.enc`); enabling
R2 uploads adds one remote attempt per UTC day. Encryption and compression stream
the snapshot rather than buffering the live database. The format/version and random
nonce are authenticated; tampering, truncation and the wrong key fail verification.
The dedicated key is independent of every wallet/signing key. Store it privately
outside the VPS too: R2 cannot recover it.

## Job limits and billing boundary

This account also serves other projects. The user accepted bounded Keryx job usage
and account budget alerts despite residual account-wide billing risk. Cloudflare
budget alerts are notifications, **not spending caps**; other applications can consume
the shared free allocation. This feature does not promise a zero-dollar invoice.
R2 Standard free allowances are account-wide: 10 GB-month storage, 1 million Class A
and 10 million Class B requests. No Worker or paid Workers upgrade is required.

- One single-part upload attempt per UTC day, including failed or ambiguous attempts.
- Maximum encrypted object: 32 MiB; retained remote snapshots: 24 (768 MiB),
  with at most 25 (800 MiB) during upload or ambiguous-PUT recovery.
- Maximum plaintext snapshot: 256 MiB. Oversized databases require an explicit design
  change; local retention is 48 by default, configurable only within 1–168.
  Encrypted staging has independent local retention of the same count: provision disk
  for both gzip and encrypted copies, plus one transient uncompressed snapshot.
- Reserve 32 requests durably before each remote upload attempt; maximum 1,000 reserved
  requests per UTC month. All GET/LIST/PUT/DELETE attempts count against this job ledger,
  including failures. Remote restore reserves one request. No retries or multipart.
- One LIST page with `max-keys=26`; truncated responses, unrecognized objects, overlarge
  responses and inventory over 25 fail closed. No pagination or remote traversal.
- Retention preserves previous backups until PUT succeeds, then deletes the oldest
  recognized encrypted snapshot. A previous uncertain PUT/failed DELETE leaving 25
  is reconciled before another upload. Each operation has a 30-second deadline.
- Local snapshot, upload, rotation and remote retrieval share an exclusive host lock.
  Never run another uploader against this bucket or use a second host's ledger.

The dedicated bucket must remain private, Standard storage only, with an Object Read
and Write S3 token scoped to this bucket. Configure a 30-day expiry lifecycle for
`keryx-` objects as a fallback if the uploader stops. Preserve abort-incomplete-multipart
lifecycle rules even though this uploader never uses multipart. Account budget alerts
at $1 and $10 are operational warnings, not free-tier enforcement. A user-bound token
also depends on its owner's access and expires; track renewal separately.

## Setup and recovery-key handling

Put configuration in an owner-only environment file, never command arguments, Git or
logs. Generate the dedicated random 32-byte key without displaying it. Keep a protected
independent copy of that file/key away from the VPS. The configuration names are:

```text
KERYX_SQLITE_PATH=/absolute/path/to/keryx.sqlite
KERYX_BACKUP_ENCRYPTION_KEY=<64 hex characters; dedicated random key>
KERYX_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
KERYX_R2_BUCKET=keryx-backups
KERYX_R2_ACCESS_KEY_ID=<bucket-scoped credential>
KERYX_R2_SECRET_ACCESS_KEY=<bucket-scoped credential>
KERYX_R2_UPLOAD=1
```

Remove legacy `KERYX_BACKUP_REMOTE`. It is refused with a nonzero status after retaining
the local gzip: plaintext rclone uploads and their unbounded retries are no longer supported.
Use Node 24 (the operational host and CI runtime) for `node:sqlite`.

Initialize exactly once on a **new empty dedicated bucket**, under the same backup lock:

```bash
npm run backup -- --init-r2
npm run backup
```

Initialization creates `data/backups/r2-budget.json` before its one LIST request. Keep
this ledger across releases and machine recovery. Never delete/reset it to retry or
reinitialize a used bucket. A missing/corrupt ledger, stale lock or `.pending` ledger
requires operator investigation; uploads fail closed. Month rollover is automatic and
clock rollback does not reopen a consumed UTC day. Protect the ledger against edits.
If continuity is lost, disable uploads for the remaining month or restore its verified
conservative accounting before any network operation. Do not infer request usage from
the surviving objects: failed and deleted requests count too.

An operational release can use the seven runtime files from one verified commit via
`git archive`: `scripts/backup-db.mts`, `backup-rotation.ts`, `backup-files.ts`,
`backup-encryption.ts`, `backup-r2.ts`, `restore-backup.ts`, and `restore-backup.mts`
(all under `scripts/`). Keep that release outside the web checkout. Run from the app
directory with its Node 24 runtime, absolute existing tsx loader, and owner-only env:

```bash
node --import /path/to/app/node_modules/tsx/dist/loader.mjs --no-warnings \
  --env-file=/path/to/app/.env.local --env-file=/private/backup.env \
  /path/to/pinned-release/scripts/backup-db.mts --init-r2
```

Omit `--init-r2` on subsequent runs. After a successful real upload/download/drill,
replace only the existing hourly backup cron command with this pinned command. Keep
other cron jobs intact; no web restart or payment-path deployment is needed. Record
the exact verified source commit in the operational handoff. Hourly local snapshots
continue, but the durable daily ledger prevents hourly remote uploads.

## Offline restore drill

Use a **new separate directory**, never the live data directory:

```bash
npm run backup:restore -- /path/to/snapshot.sqlite.enc /path/to/new-offline-drill
# Retrieve an actual off-host object with the same budget ledger, then verify:
npm run backup:restore -- --r2 keryx-2026-09-30T01-00-00-000Z.sqlite.enc /path/to/new-offline-drill
# Or download only for transfer to an independently keyed offline machine:
npm run backup -- --download-r2 keryx-2026-09-30T01-00-00-000Z.sqlite.enc /path/to/new-download.enc
```

Remote retrieval retains its private encrypted download under `data/backups/restore-download-*`
for inspection; remove completed drill/download artifacts deliberately. A downloaded
SHA computed from itself is not independent evidence. Record the encrypted object's
SHA-256 independently before upload and compare it after retrieval for the operational
drill; GCM verification separately authenticates the content with the retained key.

The restore authenticates into a private temporary compressed file **before** bounded
decompression. It verifies SQLite integrity and foreign keys in read-only mode and
creates `restore-receipt.json` only on success. Existing target directories are refused;
failed drills can leave quarantined artifacts but no acceptance receipt. Receipt digest
describes the restored database; it does not prove freshness or current settlement state.
The filename's capture time is not authenticated metadata. No app, signing or scheduler
is started, and `signingResumeAuthorized` and `fullServiceRecoveryVerified` remain false.

This protects the application's SQLite snapshot only. Private withdrawal mint journals,
relay observations, environment keys and other runtime files are separate recovery domains;
do not claim complete payment/service recovery from this drill. Before any eventual live
restore, stop **all** writers and signing processes, reconcile ambiguous payments and
journals against external evidence, and follow the maintenance/WAL/session-revocation
requirements in [the deployment guide](deployment-guide.md#backups-sqlite-is-the-source-of-truth).
