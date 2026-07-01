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

# 3. deploy (local → VPS: reset to origin/main, ship .env.local, npm ci, build, pm2 reload)
npm run deploy            # = bash scripts/deploy-vps.sh

# 4. verify
curl -s -o /dev/null -w '%{http_code}\n' https://keryx.cc      # expect 200
ssh keryx-vps "cd /root/keryx && git log -1 --oneline"          # expect your commit
```
The build runs **on the VPS** (~2–5 min on 1 GB RAM + swap). pm2 reloads with zero/near-zero downtime and `pm2 save` persists it across reboots.

> **If you forget to push**, the deploy silently ships the *previous* commit (`git reset --hard origin/main` discards nothing local — it just checks out what GitHub has). Always push first.

## Release (optional — tag + announce)
Not required to be live; do this to mark a milestone.
```bash
# bump version in package.json, then:
git tag vX.Y.Z && git push origin vX.Y.Z
gh release create vX.Y.Z --title "vX.Y.Z — <name>" --notes "…"   # optional GitHub Release

# hackathon traction/product update to arc-canteen:
npm run arc:update -- "Product: redesigned UI shipped to keryx.cc"
npm run arc:update -- --traction "<REAL settled numbers only>"
```
Current tag: `v0.1.0`. **Only send `--traction` when the numbers are real and settled.** `arc:update` posts publicly to the hackathon org — confirm before announcing.

## Rollback
```bash
# fast: pin the VPS to a known-good commit and rebuild
ssh keryx-vps "cd /root/keryx && git reset --hard <good-sha> && npm ci && NODE_OPTIONS=--max-old-space-size=1536 npm run build && pm2 reload keryx"
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

**Off-box copy (survives a dead disk):** set `KERYX_BACKUP_REMOTE` in the VPS `.env.local` to any
[rclone](https://rclone.org) remote path (e.g. `r2:keryx-backups` for Cloudflare R2), and run
`rclone config` once on the box to add the credentials. Each hourly snapshot is then `rclone copy`d
there. Without it, snapshots are kept locally only (still protects against corruption / accidental delete).

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
