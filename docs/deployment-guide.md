# Deployment Guide — keryx.cc

How Keryx ships to production. **The live site is served from a VPS**, not Vercel.

## Topology
- **VPS** (`root@`, app at `/root/keryx`) runs the Next.js app under **pm2** (process `keryx`, port **3939**).
- **Cloudflare named tunnel** maps `https://keryx.cc` → `http://localhost:3939` on the VPS (already configured).
- Deploy is **driven from your local machine** by `scripts/deploy-vps.sh`, which SSHes in and does `git reset --hard origin/main`.
- ⇒ **The VPS serves whatever is on `origin/main`.** Local edits are invisible until committed **and pushed**.

## One-time prereqs (already set up on this machine)
- SSH alias `keryx-vps` in `~/.ssh/config` with key auth (`ssh keryx-vps` works passwordless).
- `.env.local` present in repo root (real wallet/LLM keys) — scp'd to the VPS each deploy; never committed.
- VPS has Node 24, pm2, cloudflared, and 2 GB swap (the script provisions these; re-runnable).
- Cloudflare tunnel `keryx.cc → :3939` live.

## Standard deploy — run after every change you want live
```bash
# 1. commit (conventional message, no AI refs)
git add -A && git commit -m "feat(scope): what changed"

# 2. push — MANDATORY: deploy resets the VPS to origin/main
git push origin main

# 3. deploy (local → VPS: reset to origin/main, npm ci, typecheck, build, pm2 reload)
npm run deploy            # = bash scripts/deploy-vps.sh

# 4. verify
curl -s -o /dev/null -w '%{http_code}\n' https://keryx.cc      # expect 200
ssh keryx-vps "cd /root/keryx && git log -1 --oneline"          # expect your commit
```
The build runs **on the VPS** (~2–5 min on 1 GB RAM + swap). pm2 reloads with zero/near-zero downtime and `pm2 save` persists it across reboots.

> **If you forget to push**, the deploy silently ships the *previous* commit (`git reset --hard origin/main` discards nothing local — it just checks out what GitHub has). Always push first.

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
# JSON params: SourceRegistry address + "latest"
arc-canteen rpc eth_getCode '["0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536","latest"]'
```

On Windows, keep Python text I/O in UTF-8 when using CLI releases that still rely on the platform
default encoding: `$env:PYTHONUTF8='1'`. This is a compatibility workaround, not a reason to expose
the RPC URL.

## Rollback
```bash
# fast: pin the VPS to a known-good commit and rebuild
ssh keryx-vps "cd /root/keryx && git reset --hard <good-sha> && npm ci && npm run typecheck && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 reload keryx"
# or do it cleanly via git: revert locally → push → npm run deploy
```

## Backups (SQLite is the source of truth)
All real traction lives in one SQLite file (`/root/keryx/data/keryx.sqlite`). `npm run backup` takes a
consistent snapshot of the LIVE db (`VACUUM INTO`, safe under WAL — no downtime), gzips it, rotates the
last `KERYX_BACKUP_KEEP` (default 48) under `data/backups/`, and — when configured — copies it off-box.
`npm run deploy` installs an **hourly cron** that runs it automatically.

```bash
# manual snapshot (local or on the VPS)
ssh keryx-vps "cd /root/keryx && npm run backup"
# restore: gunzip a snapshot over the db (stop the app first so nothing writes mid-restore)
ssh keryx-vps "cd /root/keryx && pm2 stop keryx && gunzip -c data/backups/<snap>.sqlite.gz > data/keryx.sqlite && pm2 start keryx"
```

**Off-box copy (survives a dead disk) — one-time setup.** The local snapshots above still sit on the
same box, so a dead disk loses them too. Copy each snapshot to Cloudflare R2 (free tier, zero egress,
and you already run Cloudflare). Needs your R2 credentials — the only step that can't be scripted for you:

1. Create an R2 bucket `keryx-backups` and an R2 API token (Cloudflare dashboard → R2 → Manage API
   Tokens) with **Object Read & Write**. Note the Access Key ID, Secret, and your account's S3
   endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
2. Install rclone and register the remote non-interactively (no editor prompt):
   ```bash
   ssh keryx-vps 'curl -fsSL https://rclone.org/install.sh | sudo bash'
   ssh keryx-vps 'rclone config create r2 s3 provider=Cloudflare \
     access_key_id=<KEY_ID> secret_access_key=<SECRET> \
     endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com acl=private'
   ```
3. Point the backup at it and verify the push:
   ```bash
   ssh keryx-vps 'echo "KERYX_BACKUP_REMOTE=r2:keryx-backups" >> /root/keryx/.env.local'
   ssh keryx-vps 'cd /root/keryx && npm run backup'   # expect: [backup] pushed off-box → r2:keryx-backups
   ```

The hourly `keryx-backup` cron already loads `.env.local`, so no cron reinstall is needed — the next
run pushes automatically. Any other rclone remote (S3, Backblaze B2, Google Drive) works identically.
Without this, snapshots are kept locally only (still protects against corruption / accidental delete,
but not a disk loss).

## Monitoring & alerts
- **Treasury watchdog** — `npm run check-treasury` reads the funder wallet's on-chain USDC reserve + native gas and alerts before either runs dry (settlements would otherwise start failing silently). `npm run deploy` installs it as an hourly cron. Thresholds: `KERYX_TREASURY_MIN_USDC` (2) / `KERYX_TREASURY_MIN_GAS` (0.02).
- **Registry parity watchdog** — `npm run check-registry` enumerates every record on the on-chain SourceRegistry (`sourceIds`) and field-compares payout wallet, author splits, fetch price, and active flag against the DB discovery cache. Payment challenges and browser price checks independently refresh registry authority, while a mismatch still signals indexer drift or a tampered catalog and therefore alerts. `npm run deploy` installs it as an hourly cron (`# keryx-registry`, minute :45); the summary lands in `sync_state.registryParity` and renders on [`/status`](https://keryx.cc/status).
- **Reasoning-provider watchdog** — `npm run check-llm` asks every credentialed model one real `decompose` question through the same engine transport. The live agent crosses configured providers before the heuristic, with transport deadlines and DB-shared circuits scoped per provider + reasoning step. Failed half-open probes back off from 30 minutes to four hours, and an atomic probe lease prevents the web and volume processes retrying the same unhealthy tier together. The watchdog still reports a broken model even when another provider saved the dispatch. `npm run deploy` installs it as an hourly cron (`# keryx-llm`, minute :15), logging to `data/backups/llm.log`. `/status` separately aggregates the run receipts: failures, circuit skips, cross-provider saves and the engine that actually served each reasoning step.
- **Dispatch-outcome watchdog** — `npm run check-dispatches` reads the agent's own last 6h of dispatches (`KERYX_DISPATCH_WINDOW_HOURS`) and alerts on five failure shapes: nothing dispatched at all (`silent` — whatever dispatches has stopped), runs answered outright by the deterministic fallback (`unreasoned`), most runs losing a step to it (`degraded`), every run recording no decision (`undecided`), and a window in which no creator earned anything (`nothing-bought`). It complements the reasoning-provider watchdog above, which proves a provider *can* answer but not that a run *used* the answer — after the retired wire name was fixed, the agent still bought nothing for hours because the decide reply had outgrown its token ceiling. Citation rewards settle even when content comes from cache, so an unpaid window means nothing was cited, not that the agent shopped frugally; windows under 3 runs and boxes with no model credentials stay quiet. `npm run deploy` installs it as an hourly cron (`# keryx-dispatches`, minute :50), logging to `data/backups/dispatches.log`; the summary lands in `sync_state.dispatchHealth` and renders on [`/status`](https://keryx.cc/status).
- **Settlement parity watchdog** — `npm run check-settlement` takes every wallet Keryx has ever paid and asks Circle's public balance API what it actually holds for that address. This exists because Gateway payouts settle off-chain: their receipt is a Circle transfer id, not an EVM hash, so no payout row can be checked on ArcScan and "trust our database" was the only proof creators had. The invariant is one-directional — `gateway + wallet >= paid − withdrawn − tolerance` — so a wallet holding *more* than Keryx accounts for (their own deposits, or payouts from any other x402 service) never alerts; only a claim nothing accounts for does. A shortfall gets a second reading against the wallet's plain on-chain USDC balance first, because a Gateway balance belongs to its owner and they may cash out through Circle's CLI or any other tool, leaving no row here; that is reported as a cash-out, not a discrepancy. Tolerance is Circle's withdraw fee per recorded cash-out plus dust. `npm run deploy` installs it as an hourly cron (`# keryx-settlement`, minute :55), logging to `data/backups/settlement.log`; the summary lands in `sync_state.settlementParity` and renders on [`/status`](https://keryx.cc/status) and on each creator page.
- **Failed-settlement alerts** — a real-mode citation reward that fails to settle (a creator owed USDC that didn't land) fires the same alert channel.
- **Pending-authorization age alerts** — the ten-minute reconciler marks one-hour-old unresolved
  x402 authorizations stale and 24-hour-old ones critical. `/api/health` stays HTTP 200 for deploy
  readiness but reports `status: degraded`; `/status` shows the oldest age. The alert is deduplicated
  by authorization/status. Age never releases capacity: only exact Circle accepted/failed evidence
  can change the pending row or its grant reservation. A legacy treasury row with no exact expiry
  may be operator-acknowledged only through the evidence-gated procedure in
  `docs/pending-reconciliation-acknowledgement.md`; it stays pending and continuously reconciled,
  while browser reservations and Circle mismatches remain impossible to acknowledge away.
- **Alert channel** — set `KERYX_ALERT_WEBHOOK` in the VPS `.env.local` to a Discord/Slack incoming webhook. Unset → alerts still print to `pm2 logs`, just not delivered out-of-band.
- **Uptime/health** — point an external monitor (UptimeRobot, etc.) at [`/api/health`](https://keryx.cc/api/health); a same-box check can't catch the box being down.

## Troubleshooting
- **Build OOM on VPS** — ensure swap is active (`ssh keryx-vps "swapon --show"`); the script creates 2 GB on KVM. Containers can't swap → build locally and ship `.next`.
- **App logs** — `ssh keryx-vps "pm2 logs keryx --lines 60"`; status `pm2 status`.
- **502 at keryx.cc but :3939 OK** — Cloudflare tunnel down: `ssh keryx-vps "systemctl status cloudflared"`.
- **x402 URLs wrong** — `BASE_URL` must be `https://keryx.cc` in the VPS `.env.local` (the deploy script forces this).

## Quick reference
| Action | Command |
|---|---|
| Deploy current `origin/main` | `npm run deploy` |
| Full flow | `git commit` → `git push origin main` → `npm run deploy` |
| Verify live | `curl -s -o /dev/null -w '%{http_code}\n' https://keryx.cc` |
| VPS app logs | `ssh keryx-vps "pm2 logs keryx --lines 60"` |
| Manual DB backup | `ssh keryx-vps "cd /root/keryx && npm run backup"` |
| Announce update | `npm run arc:update -- "…"` |
