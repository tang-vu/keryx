# Encrypted off-host SQLite backups

`npm run backup` admits a bounded, consistent local gzip snapshot. With a dedicated
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
- Maximum encrypted object: 32 MiB; remote admission stops at 24 (768 MiB).
  A historical ambiguous 25th object is preserved for inspection.
- Maximum plaintext snapshot: the existing identity-bound enrolled primitive keeps
  its 64 MiB ceiling; explicit legacy offline/testnet capture permits 256 MiB. Oversized
  databases require a separately reviewed design, not a larger environment cap.
- Before snapshot output, admit conservative complete staging while leaving at least
  2 GiB of **usable** available space, excluding root-reserved free blocks. Include raw
  SQLite/journal allowance, worst-case gzip/encrypted expansion and bounded metadata.
  Compression checks capacity again as it streams. Unrelated writers can consume space
  concurrently; this job cannot reserve disk on their behalf.
- All regular retained/staging bytes below the backup directory, including plaintext,
  partial, monthly, drill and unknown artifacts, share a 512 MiB admission budget.
  `KERYX_BACKUP_MAX_BYTES` may only tighten it. Count limits remain default 48, range 1–168
  per recognized final format. **No prior snapshot is automatically deleted:** no
  genuine independently verified offhost-copy receipt is implemented. At either bound,
  capture holds and preserves latest recovery copies. No links are followed or pruned.
- Reserve 32 requests durably before each remote upload attempt; maximum 1,000 reserved
  requests per UTC month. Historical reservations remain consumed; current LIST/PUT/GET
  attempts, including failures, retain that accounting. Remote restore reserves one
  request. No retries or multipart.
- One LIST page with `max-keys=26`; truncated responses, unrecognized objects, overlarge
  responses and inventory over 25 fail closed. No pagination or remote traversal.
- A remote catalog of 24 or 25 holds upload without PUT or DELETE; the reserved
  UTC day remains consumed. PUT acknowledgement cannot authorize deleting a previous
  recovery object. Each network operation has its unchanged 30-second deadline.
- Local snapshot, upload and remote retrieval share an exclusive host lock.
  Never run another uploader against this bucket or use a second host's ledger.

The dedicated bucket must remain private, Standard storage only, with an Object Read
and Write S3 token scoped to this bucket. Any existing external expiry lifecycle is
outside this job's preservation proof; review it separately before relying on offhost
recovery. This change grants no new lifecycle or deletion authority. Account budget alerts
at $1 and $10 are operational warnings, not free-tier enforcement. A user-bound token
also depends on its owner's access and expires; track renewal separately.

## Setup and recovery-key handling

Put configuration in an owner-only environment file, never command arguments, Git or
logs. Generate the dedicated random 32-byte key without displaying it. Keep a protected
independent copy of that file/key away from the VPS. The configuration names are:

```text
KERYX_SQLITE_PATH=/absolute/path/to/keryx.sqlite
KERYX_STORAGE_MANIFEST=/absolute/path/to/protected-enrolled-manifest.json
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

Use one complete source-bound release with the backup helpers and their identity-bound
storage dependencies. The historical seven-file archive is insufficient for this
capture path. Verify its dependency graph before deploying a separate pinned release.
Run from the app directory with its Node 24 runtime, existing absolute tsx loader and owner-only env:

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

The enrolled backup command requires the protected storage manifest, its exact declared SQLite
target, matching network selectors and native stored identity/fences. Real enrolled
capture requires Linux and protected ownership/ancestors. It does not initialize an
adapter or adopt a schema. Omitting a manifest cannot bypass an existing identity marker.
Unenrolled capture requires explicit `KERYX_NETWORK=arcTestnet`,
`NEXT_PUBLIC_KERYX_NETWORK=arcTestnet`, `KERYX_FORCE_OFFLINE=1` and an isolated legacy
database. Windows support is offline fixture verification with file flushing only,
not a production directory-durability claim. Source read transactions end immediately
after snapshot work; compression and network operations hold no extra SQLite read lock.
It invokes the existing readonly snapshot primitive within this process; it adds no
new subprocess-isolation or heap-limit claim. The scheduler's existing child/deadline
envelope remains the production boundary.

The reviewed current mainnet scheduler already binds commit/manifest/target, retains
the same hourly cadence, and explicitly disables R2 and alerts. This change enables
neither. Actual deployment/pins and offhost drills remain separate operational gates.

Private `backups/backup-status.json` records `held` or `captured-local`, a closed reason,
the genuine `lastSuccessfulCapture.capturedAt`, and observed remote state. Held attempts
do not refresh successful capture time. Full remote inventory is `retention-limit`;
PUT success is `put-acknowledged` with
`offhostVerified:false`. This is local/admin evidence, not an integrated public health
or alert contract. Retain `backup-capture.pending.json`, partial files and partial
status replacement after interruption; the next capture refuses them. Inspect original
uncertainty rather than removing markers to retry. New files use exclusive creation,
no-replace publication, file/directory flushing and readback. Only newly owned temporary
staging is removed after durable local publication; prior recovery artifacts are preserved.

`npm run preflight:ops` recognizes the hourly `# keryx-backup` entry in its legacy
npm form or the approved pinned form: `/usr/bin/node`, the absolute app loader
`/root/keryx/node_modules/tsx/dist/loader.mjs`, `--no-warnings`, the app
`--env-file=.env.local` followed by `--env-file=/root/.config/keryx-backup.env`, and
`/root/.local/share/keryx-backup/<40-lowercase-hex-commit>/scripts/backup-db.mts`.
It requires the app working directory and fixed backup log redirection; duplicate
entries, extra flags or shell commands and altered paths fail inventory. This is
a read-only command-shape check, not verification of pinned file contents, backup
execution, off-host retention or restore acceptance.

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
Transfer-only `backup -- --download-r2` requires the existing private backup directory
and request ledger selected by `KERYX_SQLITE_PATH`; it does not require a readable live
database or create one. This administrative retrieval does not grant capture, restore,
schema or signing authority. `backup:restore -- --r2` keeps its separate offline drill.

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
