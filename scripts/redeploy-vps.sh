#!/usr/bin/env bash
#
# redeploy-vps.sh — low-downtime code deploy to the already-provisioned VPS.
#
# The live build keeps serving the whole time: we build the new release into a TEMP
# dist dir (.next.tmp) while keryx still serves the old .next, then atomically swap it
# in and `pm2 reload` (a ~1-2s blip, not a multi-minute build outage). The live .next is
# never touched until the build SUCCEEDS — so a failed or OOM-killed build leaves
# keryx.cc exactly as it was (no stale-lock outage). After reload we hit /api/health and
# automatically roll back to the previous build if the new one doesn't come up.
#
# Use this for code-only changes. For dependency installs the lockfile triggers an
# `npm ci`; for first-time provisioning (Node, pm2, swap, cloudflared) use deploy-vps.sh.
#
# Prereq: `ssh keryx-vps` works by key (see deploy-vps.sh) and the box is already provisioned.
set -euo pipefail

SSH=keryx-vps
APP_DIR=/root/keryx
PORT=3939
HEALTH="http://localhost:$PORT/api/health"

say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

# 0. sanity: key auth must already work
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH" true 2>/dev/null \
  || { echo "ERROR: 'ssh $SSH' failed — provision first with scripts/deploy-vps.sh" >&2; exit 1; }

# 1. sync source — the OLD .next keeps serving (git touches source only, not .next)
say "1/5 syncing source at $APP_DIR (live build keeps serving)"
ssh "$SSH" "cd $APP_DIR && git fetch -q origin && git reset -q --hard origin/main && git log -1 --oneline"

# 2. install deps only when the lockfile actually moved (npm ci is the slow part)
say "2/5 deps (npm ci only if package-lock changed)"
ssh "$SSH" bash -se <<'REMOTE'
set -euo pipefail
cd /root/keryx
if git diff --quiet 'HEAD@{1}' HEAD -- package-lock.json 2>/dev/null; then
  echo "lockfile unchanged → skip npm ci"
else
  echo "lockfile changed (or unknown) → npm ci"
  npm ci --no-audit --no-fund
fi
REMOTE

# 3. build into .next.tmp — the live .next is untouched, so an OOM here is harmless
say "3/5 building into .next.tmp (old build still live)"
ssh "$SSH" "cd $APP_DIR && rm -rf .next.tmp && NODE_OPTIONS=--max-old-space-size=1536 NEXT_DIST_DIR=.next.tmp npm run build"

# 4. atomic swap + reload + stamp the deployed commit for /api/health & /status
say "4/5 swapping in the new build + reload"
COMMIT=$(ssh "$SSH" "cd $APP_DIR && git rev-parse --short HEAD")
ssh "$SSH" "cd $APP_DIR \
  && (grep -q '^KERYX_COMMIT=' .env.local && sed -i 's/^KERYX_COMMIT=.*/KERYX_COMMIT=$COMMIT/' .env.local || echo 'KERYX_COMMIT=$COMMIT' >> .env.local) \
  && rm -rf .next.bak && mv .next .next.bak && mv .next.tmp .next \
  && pm2 reload keryx --update-env"

# 5. health-gate: roll back to the previous build if the new one doesn't answer 200
say "5/5 health check ($HEALTH)"
ok=""
for i in $(seq 1 20); do
  code=$(ssh "$SSH" "curl -s -o /dev/null -w '%{http_code}' $HEALTH" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then ok=1; echo "healthy after ${i}s — $COMMIT live"; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "!! new build unhealthy — rolling back to the previous build" >&2
  ssh "$SSH" "cd $APP_DIR && rm -rf .next && mv .next.bak .next && pm2 reload keryx --update-env"
  echo "rolled back; keryx.cc is serving the previous build." >&2
  exit 1
fi

ssh "$SSH" "cd $APP_DIR && rm -rf .next.bak"
echo "✅ redeploy complete — $COMMIT live on keryx.cc (low-downtime)"
