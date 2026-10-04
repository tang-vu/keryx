# Deployment Guide — keryx.cc

How Keryx ships to production. **The live site is served from a VPS**, not Vercel.

**Post-mainnet workflow (October 4, 2026):** use the
[update flow](mainnet-update-flow.md) before executing this runbook. Production
uses reviewed role configuration, sealed storage and deliberately held schedules.
Preserve those exact inputs and states; a bare default redeploy may install
reconciliation cron or use a legacy launcher. Historical provisioning/backup
examples below do not establish the active mainnet configuration.

## Topology
- **VPS** (`root@`, app at `/root/keryx`) runs the Next.js app under **pm2** (process `keryx`, port **3939**).
- **Cloudflare named tunnel** maps `https://keryx.cc` → `http://localhost:3939` on the VPS (already configured).
- Routine deploys use `npm run redeploy` (`scripts/redeploy-vps.sh`), which SSHes in and checks out `origin/main`. `npm run deploy` is the separate provisioning path.
- ⇒ **The VPS serves whatever is on `origin/main`.** Local edits are invisible until committed **and pushed**.

## One-time prereqs (already set up on this machine)
- SSH alias `keryx-vps` in `~/.ssh/config` with key auth (`ssh keryx-vps` works passwordless).
- The provisioning path copies `.env.local` to the VPS. Routine redeploys retain the VPS environment and update the release identifier. Never commit or print its secrets.
- VPS has Node 24, pm2, cloudflared, and 2 GB swap (the script provisions these; re-runnable).
- Cloudflare tunnel `keryx.cc → :3939` live.

## Standard release — reviewed PR, then current origin/main

Work on a focused feature branch; pass required CI and review, then merge the PR.
Do not push a feature directly to main. Documentation-only updates require no
runtime deployment. For user-visible product updates, inspect the actual mainnet
role/storage/policy state and use the reviewed deployment mode below.

```bash
# On the feature branch, after appropriate validation
git add <in-scope-files>
git commit -m "feat(scope): what changed"
git push -u origin <feature-branch>

# Open the PR, pass required CI/review, merge, and verify the merged commit.
# Inspect source, custody/schema compatibility and actual worker/scheduler state.
# Supply the validated reviewed-role and held-scheduler inputs described below.

# Deploy only after that preparation; never run this bare on the reviewed mainnet host.
npm run redeploy

# Verify expected commit/network and operational state; do not publish private telemetry.
curl -fsS https://keryx.cc/api/health
```
The build runs **on the VPS** and can remain quiet for several minutes. A September 9
build compiled in 6.7 minutes before page generation and reload; this is historical
timing, not a current estimate. **The reviewed mainnet path requires web and A2A
writers positively stopped before source sync/build**, so plan a maintenance window.
The prior build is retained for recovery. Only the legacy non-reviewed path keeps
the old `.next` serving while `.next.tmp` builds; do not promise that availability
for the reviewed mainnet procedure.

The full TypeScript graph and the Next build have separate memory limits. The
release typecheck uses a 2,560 MiB V8 old-space allowance; Next and its static
worker keep the 1,536 MiB allowance. These do not cap total process RSS or host
memory. The phases remain sequential, and typecheck failure prevents
building or swapping the live app. On October 4 the 1,536 MiB typecheck failed
before build; an uncached check at 2,560 MiB completed with 1,741 MiB of heap in
use and 1,959 MiB peak RSS on the development machine. This is not a VPS duration
or host-capacity guarantee. Retain adequate RAM/swap and keep failed-deploy workers
under explicit operator control.

Web Tailwind sources are explicit (`app`, `components`, `lib`, `shared`). This
keeps retained `.next.*` builds and operational evidence out of generated CSS.
Keep recovery artifacts: moving or deleting them to make CSS compilation pass
is not part of the build. New web class-bearing source roots need an explicit
entry in `app/globals.css` and the source-scope regression. See Tailwind's
[source discovery documentation](https://tailwindcss.com/docs/detecting-classes-in-source-files#disabling-automatic-detection).
On October 4, the full VPS build timed out receiving from its PostCSS subprocess;
the same stylesheet with bounded sources processed directly on that VPS in
2.1 seconds at about 115 MB RSS. That isolated result establishes CSS processing,
not complete-build success or a general host-capacity guarantee.

On Windows where `bash.exe` resolves to unavailable WSL, use the installed Git
Bash without changing the deployment script or its checks:

```powershell
$env:PATH = 'C:\Program Files\Git\bin;' + $env:PATH
$env:KERYX_SSH_BIN = '/c/Windows/System32/OpenSSH/ssh.exe'
$env:MSYS_NO_PATHCONV = '1'
npm run redeploy
```

These environment settings apply to the current shell. Preserve any existing
deployment role/scheduler inputs and the configured SSH host-key verification.

### Reviewed role transition with held schedulers

For an explicitly drained release or network transition, `npm run redeploy` also accepts:

```bash
KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER=1 \
KERYX_REDEPLOY_REVIEWED_PM2_CONFIG=/root/.local/share/keryx-release/roles.json \
KERYX_REDEPLOY_REVIEWED_PM2_SHA256=<sha256-of-exact-protected-json-bytes> \
npm run redeploy
```

The paired PM2 inputs are optional; the scheduler flag defaults to `0`. A malformed
pair refuses before deployment. With preservation enabled, the script neither
stops/resumes the private worker or withdrawal cycle nor rewrites reconciliation
cron. Existing schedules and unknown originals remain held. Before starting this
mode, the operator must positively drain every owned web, A2A, private and scheduled
writer, exclude concurrent deploys, and retain the original recovery evidence.
This flag does not stop writers or authorize payments, environment replacement,
database migration, or a network transition.

The reviewed JSON must be root-owned, mode `0600`, a single regular file under
`/root/.local/share/`, with root-owned non-writable ancestors. It contains only
`{"apps":[...,...]}` for `keryx` and `keryx-a2a-worker`. Each app requires
`script: "/usr/bin/env"`, `interpreter: "none"`, `cwd: "/root/keryx"`, an explicit
boolean `autorestart`, and `kill_timeout` between `330000` and `900000`. Its exact
argument prefix is:

```json
["-i", "PATH=/usr/bin:/bin", "NODE_ENV=production", "/usr/bin/node", "--env-file=/root/keryx/.env.local"]
```

Append `['/root/keryx/scripts/next-public-server.mjs','--port','3939']` for web,
or `['--import','/root/keryx/node_modules/tsx/dist/loader.mjs',
'/root/keryx/scripts/a2a-research-worker.mts']` for A2A. No inline `env` object or
arbitrary arguments are accepted. Optional fields are `exec_mode: "fork"`,
`instances: 1`, boolean `merge_logs`/`time`, and `out_file`/`error_file` beneath
`/root/.pm2/logs/` using a simple `.log` basename. The separately reviewed server
ENV file supplies the rail, registry, identity, policy and secrets; this helper
does not infer or change that authority.

The reviewed launcher requires Node 24.16 or later and the pinned Next 16.3.6.
The reviewed server gives Next the public metadata `keryx.cc:443` while listening
physically on `127.0.0.1:3939`. This preserves the normal HTTPS origin used by
Session originals; supplying the physical loopback address as Next metadata caused
an origin mismatch in the controlled QA flow. It admits only public Host and
forwarded HTTPS requests before Next, without rewriting request URLs or headers.
Deployment health checks use the fixed trusted headers `Host: keryx.cc` and
`X-Forwarded-Proto: https` over loopback; health has no origin exemption.

Its 100-second idle keep-alive timeout exceeds the observed cloudflared 2026.6
origin pool default of 90 seconds. Requests per socket remain unlimited, independently
of the separate QA proxy fix. The launcher's only alternate CLI port is `3940` for
controlled QA; reviewed production PM2 inputs require `3939`. Existing stopped clean
Next CLI definitions, with or without the preceding loopback/keep-alive flags, remain
recognizable solely for retention and replacement. Local development and the default
Next CLI workflow retain their existing localhost behavior.

Protected JSON hashes and stopped/absent PM2 definitions are checked before source
changes, and again at role replacement. Active, duplicate or changed definitions
refuse. Each replacement first retains an exclusive root-only sanitized stopped
definition reference beside the config; raw PM2 environment values are never
exported. Only recognized old npm wrappers or the exact clean launcher can be
replaced. These references preserve executable arguments and the ENV-file path,
not a complete secret-bearing PM2 dump. Preserve the original protected ENV backup
separately. The helper never stops, signals, retries or reloads a running role.

Reviewed deployment retains `.next.bak` after success and refuses an existing
backup before swapping builds. A failed start or commit health check leaves the
current process/build and recovery artifacts for inspection; it does not roll back
automatically. Recover explicitly from the retained original after checking payment,
worker, configuration and database compatibility. These changes affect VPS
deployment orchestration only; web/API, desktop, CLI, MCP, extensions and bots keep
their application contracts and distribution versions.

### Successful dependency installation state

`scripts/dependency-state.mjs` uses only Node built-ins, so it can run before installation.
Reuse requires a stamp in `node_modules` matching the manifest, lockfile, Node/ABI,
platform, npm version/effective configuration and installed hidden lockfile; direct
dependency package manifests must still exist. Registry/auth configuration is hashed
in memory and never printed or persisted in plaintext by this helper.

Only root release-version metadata is ignored, and only when root install hooks,
workspaces and local dependencies are absent. Dependency resolutions/integrities,
scripts and install settings remain significant. An absent, invalid or unreadable
stamp requires installation. The stamp is removed before `npm ci` and written only
after that command succeeds, so a failed install cannot become reusable merely because
Git's reflog changed. Existing unmarked installations reinstall once.

This is evidence of a completed installation under matching inputs, not a byte-level
audit of every package file or a concurrent-deployment lock. Keep deployments serialized.
The local checks cover version-only reuse, meaningful changes, missing dependencies,
invalidated/failed attempts and absence of plaintext configuration in the stamp:
`node --test scripts/dependency-state.check.mjs`.

The behavior of clean installation and lifecycle hooks was checked against
[npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) and
[npm scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/) on September 9.

### Interrupted observations

Keep the original deploy handle. A quiet build or SSH observation timeout does not
prove the remote command stopped; check the same handle, remote process state and
public/internal health before retrying. On September 9, public HTTP 530 and SSH
timeouts recovered without a VPS reboot, and the original deployment completed.
The root cause of that interruption was not established. Do not claim the dependency
reuse change fixes host or tunnel outages.

> Deployment checks out origin/main on the VPS. Pushing a feature branch alone
> does not deploy it: merge the reviewed PR first. The server-side hard reset can
> discard tracked server edits; inspect and preserve unexpected server work before
> deployment. The development checkout is a separate filesystem.

On Windows, the npm script enters WSL to run Bash but automatically delegates SSH back to Windows
OpenSSH so it uses the documented `keryx-vps` alias. Set `KERYX_SSH_BIN` only when a different SSH
client/config should be used.

## Release (required for a versioned product milestone)

Before merging a user-visible milestone, bump the root `package.json` and lockfile version. After
the `main` CI gate succeeds, the `publish-release` job reads that version and creates the missing
`vX.Y.Z` tag plus a public GitHub Release with generated notes. If the release already exists, the
job is idempotent.

```bash
# verify CI made the release visible
gh release view vX.Y.Z --web

# manual recovery only if the release job itself failed
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "Keryx vX.Y.Z" --generate-notes --latest

# hackathon traction/product update to arc-canteen:
npm run arc:update -- "Product: redesigned UI shipped to keryx.cc"
npm run arc:update -- --traction "<REAL settled numbers only>"
```

The GitHub Release is part of completion, not an optional announcement. **Only send `--traction`
when the numbers are real and settled.** `arc:update` posts publicly to the hackathon org.

## Attributable Arc RPC

`KERYX_RPC_URL` is server-only. Production may use the tokenized endpoint returned by
`arc-canteen rpc-url` so registry/indexer/watchdog reads are attributable to the project's Canteen
account. Store it only in the VPS `.env.local`; never paste it into an issue, build log, screenshot,
`NEXT_PUBLIC_*` variable, or committed file. `/api/health` and `/proof` deliberately expose only the
safe provider label plus the head block retained by the registry watchdog.

Useful read-only verification before a release:

```bash
arc-canteen rpc eth_chainId
arc-canteen rpc eth_blockNumber
# For eth_getCode, use the registry from the verified selected-network profile.
# Do not copy a historical testnet address into a mainnet check.
```

On Windows, keep Python text I/O in UTF-8 when using CLI releases that still rely on the platform
default encoding: `$env:PYTHONUTF8='1'`. This is a compatibility workaround, not a reason to expose
the RPC URL.

## Rollback
```bash
# After confirming no deployment is still running, revert the identified bad change
# locally, validate it, push the correction, then use the normal temporary-build path.
npm run redeploy
```
The legacy non-reviewed path attempts an automatic build rollback when its health
gate fails. **Reviewed-role deployment does not:** it retains builds and stops for
inspection. After an economic migration attempt it holds public writers and
forbids automatic rollback, including when the response is lost. Inspect actual
original migration evidence and worker/config/database compatibility before a
reviewed forward fix or rollback; never overwrite newer financial state with an
older snapshot or resume an old writer against a new sealed schema.

## Backups (SQLite is the source of truth)

**Mainnet boundary:** first resolve the actual enrolled storage target, identity
and schema from the protected runtime manifest. Do not assume the legacy path
below is the financial database. The generic backup command reads
KERYX_SQLITE_PATH with a data/keryx.sqlite fallback; this is not proof that it
selects the enrolled mainnet target. Use the reviewed identity-aware backup and
migration procedure, retain manifest/policy/custody bindings privately, and verify
restoration separately. The economic migration's native snapshot/receipt checks
are described in [economic recovery](engineering/mainnet-economic-recovery.md).
Do not rerun that migration to obtain an unrelated backup.

The remaining path/cron examples in this section describe the legacy ordinary
SQLite deployment. Neither their path nor hourly scheduling is asserted for
current mainnet. Its retained held schedules must not be activated by this text.

The legacy ordinary SQLite deployment uses `/root/keryx/data/keryx.sqlite`. `npm run backup` takes a
consistent snapshot of the LIVE db (`VACUUM INTO`, safe under WAL — no downtime), gzips it, rotates the
last `KERYX_BACKUP_KEEP` (default 48) under `data/backups/`, and — when configured — copies it off-box.
`npm run deploy` installs an **hourly cron** that runs it automatically.

```bash
# manual snapshot (local or on the VPS)
ssh keryx-vps "cd /root/keryx && npm run backup"
```

Restore requires a maintenance window: stop the web process, A2A worker, automation
and scheduled database writers, then verify no process still holds the database.
Restore into a separate staging file, verify its checksum/integrity and initialize
the target schema offline before replacing the live file. Keep a rollback copy and
handle the stopped database's WAL/SHM files deliberately; stopping only the web process
is insufficient. Full service-restore acceptance remains open in the delivery plan.

For the legacy ordinary adapter, before restored data serves requests, clear the ephemeral `auth_challenges` and
`web_sessions` tables after schema initialization. A stale snapshot must not resurrect
a consumed login challenge or revoked web session. This requires users to sign in
again. Preserve all payment grants, reservations, authorizations and research journals;
account-session cleanup is not a payment-state reset. Mainnet enrolled storage
requires its reviewed schema/identity-aware procedure; do not apply legacy SQL or
initialization directly to an enrolled financial store. See
[revocable-session recovery](./engineering/revocable-sessions-2026-09-09.md).

**Encrypted off-box copy** uses a dedicated private Cloudflare R2 Standard bucket and AES-256-GCM. The job uploads at most once per UTC day, retains 24 encrypted snapshots (32 MiB each maximum), reserves a bounded monthly request budget before network operations, and refuses legacy plaintext rclone configuration. Account alerts are notifications, not spending caps; other projects share the free allowance. See [encrypted backup setup, job limits and offline restore drills](encrypted-backups.md).

## Monitoring & alerts

- **Source upkeep** uses an isolated Cloudflare Free hourly trigger and an authenticated,
  bounded VPS job over verified RSS sources. The existing bulk CLI is separate manual upkeep.
  See [limits, deployment evidence and rollback](cloudflare-source-upkeep.md); this moves
  scheduling only, leaving SQLite, paid content and registry/payment authority on the VPS.


### Read-only release operations inventory

On the deployment host, run `npm run preflight:ops` from `/root/keryx`. It reads
the current crontab, PM2 PIDs, systemd states and `.env.local` webhook assignment.
It prints only fixed labels and presence/state summaries; it does not print the
webhook value, call the webhook, change services, or perform a payment. A missing
required check exits 1. The withdrawal cycle is currently gated from activation
as described in [withdrawal supervision](./withdrawal-supervision.md), so an
absent timer and service are informational by default. If the intended release
requires a scheduled cycle, run `npm run preflight:ops -- --require-withdrawal-timer`;
an absent, inactive or incomplete timer/service then fails. A partial installation
fails in either mode.

This inventory is repeatable configuration evidence, not proof that jobs ran,
alert delivery works, backups restore, workers are ready for paid work, or M5 is
accepted. Retain the output with the release review and perform those drills
separately. Keep `.env.local` private.

- **Treasury watchdog** — `npm run check-treasury` reads the funder wallet's on-chain USDC reserve + native gas and alerts before either runs dry (settlements would otherwise start failing silently). `npm run deploy` installs it as an hourly cron. Thresholds: `KERYX_TREASURY_MIN_USDC` (2) / `KERYX_TREASURY_MIN_GAS` (0.02).
- **Registry parity watchdog** — `npm run check-registry` enumerates every record on the on-chain SourceRegistry (`sourceIds`) and field-compares payout wallet, author splits, fetch price, and active flag against the DB discovery cache. Payment challenges and browser price checks independently refresh registry authority, while a mismatch still signals indexer drift or a tampered catalog and therefore alerts. `npm run deploy` installs it as an hourly cron (`# keryx-registry`, minute :45); the summary lands in `sync_state.registryParity` and renders on [`/status`](https://keryx.cc/status).
- **Reasoning-provider watchdog** — `npm run check-llm` asks every credentialed model one real `decompose` question through the same shared catalog-engine constructor and bounded transport as runtime picks. DeepSeek V4 JSON steps explicitly disable thinking; watchdog probes must retain that provider identity. Transient deadline failures remain real probe failures even if a later hourly check recovers. The live agent crosses configured providers before the heuristic, with transport deadlines and DB-shared circuits scoped per provider + reasoning step. Failed half-open probes back off from 30 minutes to four hours, and an atomic probe lease prevents the web and volume processes retrying the same unhealthy tier together. The watchdog still reports a broken model even when another provider saved the dispatch. `npm run deploy` installs it as an hourly cron (`# keryx-llm`, minute :15), logging to `data/backups/llm.log`. `/status` separately aggregates the run receipts: failures, circuit skips, cross-provider saves and the engine that actually served each reasoning step.
- **Dispatch-outcome watchdog** - `npm run check-dispatches` reads completed query receipts from the last six hours (`KERYX_DISPATCH_WINDOW_HOURS`). Since D-237 removed self-initiated research, an empty window is **idle**, not an outage. Completed public-only zero-spend answers still count. Set `KERYX_EXPECT_DISPATCHES=1` only when a separately configured scheduler promises regular completed runs; this enables missing-dispatch alarms, but creates no scheduler or spend permission. Model fallback and zero-decision anomalies remain visible. Real completed runs with current failed, pending or incomplete creator-ledger evidence raise `payment-unsettled`, including partial per-source failures without declaring the answer lost; inspect receipts and reconciliation before any retry. `/status` and `/api/health` expose the same summary; real-run payout counts and amounts use current canonical settled creator rows rather than immutable completion counters. The hourly cron runs at :50 and logs to `data/backups/dispatches.log`. This completed-receipt window cannot observe synchronous requests that abort before saving a receipt; separate A2A worker/queue health and settlement reconciliation continue to detect their own failures. Do not create paid queries merely to clear an idle alert.
- **Settlement parity watchdog** — `npm run check-settlement` takes every wallet Keryx has ever paid and asks Circle's public balance API what it actually holds for that address. This exists because Gateway payouts settle off-chain: their receipt is a Circle transfer id, not an EVM hash, so no payout row can be checked on ArcScan and "trust our database" was the only proof creators had. The invariant is one-directional — `gateway + wallet >= paid − withdrawn − tolerance` — so a wallet holding *more* than Keryx accounts for (their own deposits, or payouts from any other x402 service) never alerts; only a claim nothing accounts for does. A shortfall gets a second reading against the wallet's plain on-chain USDC balance first, because a Gateway balance belongs to its owner and they may cash out through Circle's CLI or any other tool, leaving no row here; that is reported as a cash-out, not a discrepancy. Tolerance is Circle's withdraw fee per recorded cash-out plus dust. `npm run deploy` installs it as an hourly cron (`# keryx-settlement`, minute :55), logging to `data/backups/settlement.log`; the summary lands in `sync_state.settlementParity` and renders on [`/status`](https://keryx.cc/status) and on each creator page.
- **Failed-settlement alerts** — a real-mode citation reward that fails to settle (a creator owed USDC that didn't land) fires the same alert channel.
- **Pending-authorization age alerts** — the ten-minute reconciler marks one-hour-old unresolved
  x402 authorizations stale and 24-hour-old ones critical. `/api/health` stays HTTP 200 for deploy
  readiness but reports `status: degraded`; `/status` shows the oldest age. The alert is deduplicated
  by authorization/status after webhook delivery succeeds. Missing or failed webhook delivery is
  logged and retried on the next ten-minute run while the incident remains unresolved; a delivered
  alert stays quiet until the fingerprint changes or recovery clears it. The reconciler exits 1
  for an unresolved incident even when alert delivery fails. Age never releases capacity: only exact
  Circle accepted/failed evidence can change the pending row or its grant reservation. A legacy
  treasury row with no exact expiry may be operator-acknowledged only through the evidence-gated
  procedure in
  `docs/pending-reconciliation-acknowledgement.md`; it stays pending and continuously reconciled,
  while browser reservations and Circle mismatches remain impossible to acknowledge away.
- **Alert channel** — configure a dedicated Telegram operations bot and private "Keryx ops" group using `KERYX_ALERT_TELEGRAM_BOT_TOKEN` and `KERYX_ALERT_TELEGRAM_CHAT_ID`; follow [the setup and delivery acceptance guide](telegram-ops-alerts.md). `KERYX_ALERT_WEBHOOK` remains supported for Discord/Slack. Process logs alone are not delivered alert evidence.
- **Uptime/health** — point an external monitor (UptimeRobot, etc.) at [`/api/health`](https://keryx.cc/api/health); a same-box check can't catch the box being down.

## Troubleshooting
- **Build OOM on VPS** — ensure swap is active (`ssh keryx-vps "swapon --show"`); the script creates 2 GB on KVM. Containers can't swap → build locally and ship `.next`.
- **App logs** — `ssh keryx-vps "pm2 logs keryx --lines 60"`; status `pm2 status`.
- **502 at keryx.cc but :3939 OK** — Cloudflare tunnel down: `ssh keryx-vps "systemctl status cloudflared"`.
- **x402 URLs wrong** — `BASE_URL` must be `https://keryx.cc` in the VPS `.env.local` (the deploy script forces this).

## Quick reference
| Action | Command |
|---|---|
| Deploy current reviewed `origin/main` | `npm run redeploy` with validated role/held-scheduler inputs |
| Provision a host | `npm run deploy` — separate provisioning scope, never a routine update |
| Full flow | Feature branch → checks/review → PR merge → prepared redeploy → commit/network verification |
| Verify live | `curl -fsS https://keryx.cc/api/health` plus relevant read-only acceptance |
| VPS app logs | `ssh keryx-vps "pm2 logs keryx --lines 60"` |
| Manual DB backup | Resolve current storage identity and use its reviewed backup procedure; legacy command above is not a mainnet selector |
| Announce update | `npm run arc:update -- "…"` |
