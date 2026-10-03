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
# Use this for code-only changes. Changes to successful-install inputs trigger an
# `npm ci`; for first-time provisioning (Node, pm2, swap, cloudflared) use deploy-vps.sh.
#
# Prereq: `ssh keryx-vps` works by key (see deploy-vps.sh) and the box is already provisioned.
set -euo pipefail

SSH=keryx-vps
APP_DIR=/root/keryx
PORT=3939
HEALTH="http://localhost:$PORT/api/health"
# The public-origin server checks these fixed trusted ingress fields before Next.
# Keep loopback transport; do not exempt health or accept caller-selected origins.
HEALTH_CURL="curl -fsS -H 'Host: keryx.cc' -H 'X-Forwarded-Proto: https' $HEALTH"
PRESERVE_HELD=${KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER:-0}
REVIEWED_CONFIG=${KERYX_REDEPLOY_REVIEWED_PM2_CONFIG:-}
REVIEWED_SHA=${KERYX_REDEPLOY_REVIEWED_PM2_SHA256:-}
case "$PRESERVE_HELD" in 0|1) ;; *) echo "Invalid scheduler preservation input" >&2; exit 1 ;; esac
if [[ -n "$REVIEWED_CONFIG" || -n "$REVIEWED_SHA" ]]; then
  [[ "$REVIEWED_CONFIG" =~ ^/root/\.local/share/[a-zA-Z0-9_./-]+\.json$ &&
     "$REVIEWED_CONFIG" != *..* && "$REVIEWED_SHA" =~ ^[a-f0-9]{64}$ ]] \
    || { echo "Invalid paired reviewed PM2 inputs" >&2; exit 1; }
fi
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# `npm run redeploy` on Windows enters WSL through bash.exe. That shell can run as a different
# Linux user (and therefore miss the Windows-side `keryx-vps` SSH alias) even though `ssh
# keryx-vps` works from PowerShell. Prefer Windows OpenSSH when it is mounted in WSL; native Linux
# and macOS keep using `ssh`. KERYX_SSH_BIN remains an explicit escape hatch for other setups.
SSH_BIN=${KERYX_SSH_BIN:-ssh}
SSH_ARGS=()
if [[ -z "${KERYX_SSH_BIN:-}" && -x /mnt/c/Windows/System32/OpenSSH/ssh.exe ]] \
  && /mnt/c/Windows/System32/OpenSSH/ssh.exe -V >/dev/null 2>&1; then
  SSH_BIN=/mnt/c/Windows/System32/OpenSSH/ssh.exe
fi

# Some WSL installations mount Windows executables but disable interop, so the path above exists
# yet cannot run. In that case use native WSL ssh with the Windows alias/known-host file; the WSL
# home still supplies its permission-safe private key. An explicit KERYX_SSH_BIN always wins.
if [[ -z "${KERYX_SSH_BIN:-}" && "$SSH_BIN" = ssh ]]; then
  for candidate in /mnt/c/Users/*/.ssh/config; do
    if [[ -r "$candidate" ]] && grep -Eiq '^[[:space:]]*Host[[:space:]]+keryx-vps([[:space:]]|$)' "$candidate"; then
      SSH_ARGS=(-F "$candidate")
      known_hosts="$(dirname "$candidate")/known_hosts"
      if [[ -r "$known_hosts" ]]; then
        SSH_ARGS+=(-o "UserKnownHostsFile=$known_hosts")
      fi
      break
    fi
  done
fi

run_ssh() { "$SSH_BIN" "${SSH_ARGS[@]}" "$@"; }
reviewed_role() {
  run_ssh "$SSH" /usr/bin/node --input-type=module - "$REVIEWED_CONFIG" "$REVIEWED_SHA" "$1" \
    < "$SCRIPT_DIR/redeploy-reviewed-roles.mjs"
}

say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

# 0. sanity: key auth must already work
run_ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH" true 2>/dev/null \
  || { echo "ERROR: 'ssh $SSH' failed — provision first with scripts/deploy-vps.sh" >&2; exit 1; }

# Validate protected bytes and positively exited definitions before any source or
# scheduler mutation. The operator must drain all owned writers beforehand.
if [[ -n "$REVIEWED_CONFIG" ]]; then reviewed_role validate; fi

PREVIOUS_COMMIT=$(run_ssh "$SSH" "$HEALTH_CURL" 2>/dev/null \
  | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' || true)

# Both workers import repository code and dependencies while running. Pause cycle
# scheduling and drain workers BEFORE changing either. Failed deploys leave them
# stopped for inspection; never restart against partial code or delete recovery locks.
if [[ "$PRESERVE_HELD" == 0 ]]; then
WITHDRAWAL_CYCLE_STATE=$(run_ssh "$SSH" bash -s -- stop < "$SCRIPT_DIR/withdrawal-cycle-deploy.sh")
case "$WITHDRAWAL_CYCLE_STATE" in absent|inactive|manual|timer-active) ;; *) echo "Invalid withdrawal cycle stop observation" >&2; exit 1 ;; esac
PRIVATE_WORKER_STATE=$(run_ssh "$SSH" bash -s -- stop < "$SCRIPT_DIR/private-worker-deploy.sh")
case "$PRIVATE_WORKER_STATE" in absent|inactive|active) ;; *) echo "Invalid private worker stop observation" >&2; exit 1 ;; esac
fi

# 1. sync source — the OLD .next keeps serving (git touches source only, not .next)
say "1/5 syncing source at $APP_DIR (live build keeps serving)"
run_ssh "$SSH" "cd $APP_DIR && git fetch -q origin && git reset -q --hard origin/main && git log -1 --oneline"
COMMIT=$(run_ssh "$SSH" "cd $APP_DIR && git rev-parse --short HEAD")
# Next can inline server env while bundling, so the commit must be present BEFORE the build.
run_ssh "$SSH" "cd $APP_DIR \
  && (grep -q '^KERYX_COMMIT=' .env.local && sed -i 's/^KERYX_COMMIT=.*/KERYX_COMMIT=$COMMIT/' .env.local || echo 'KERYX_COMMIT=$COMMIT' >> .env.local)"

# 2. Reuse only a recorded successful install for these inputs, never Git reflog state.
say "2/5 deps (verify successful installation state)"
run_ssh "$SSH" bash -se <<'REMOTE'
set -euo pipefail
cd /root/keryx
if node scripts/dependency-state.mjs check; then
  echo "verified install inputs unchanged → skip npm ci"
else
  echo "install inputs changed (or unverified) → npm ci"
  node scripts/dependency-state.mjs invalidate
  npm ci --no-audit --no-fund
  node scripts/dependency-state.mjs record
fi
REMOTE

# 3. typecheck, then build into .next.tmp — the live .next is untouched on any failure
say "3/5 typechecking + building into .next.tmp (old build still live)"
run_ssh "$SSH" "cd $APP_DIR && node --max-old-space-size=1536 scripts/check-next-worker-memory.cjs && NODE_OPTIONS=--max-old-space-size=1536 npm run typecheck && rm -rf .next.tmp && NODE_OPTIONS=--max-old-space-size=1536 NEXT_DIST_DIR=.next.tmp npm run build"

# 4. Start/restart the new durable worker before exposing the async route, then swap the web build.
# PM2 gives an in-flight worker up to 330s to finish after SIGINT; started jobs are never requeued.
say "4/5 starting A2A worker + swapping in the new build + reload"
if [[ -n "$REVIEWED_CONFIG" ]]; then
  reviewed_role validate
  # Retained builds are recovery evidence, never disposable rollback scratch.
  run_ssh "$SSH" "cd $APP_DIR && test ! -e .next.bak && test ! -L .next.bak && test -d .next.tmp"
  reviewed_role a2a
  run_ssh "$SSH" "cd $APP_DIR && if test -e .next; then mv .next .next.bak; fi && mv .next.tmp .next"
  reviewed_role web
  run_ssh "$SSH" "pm2 save >/dev/null"
else
run_ssh "$SSH" "cd $APP_DIR \
  && (pm2 restart keryx-a2a-worker --update-env 2>/dev/null || pm2 start npm --name keryx-a2a-worker --kill-timeout 330000 -- run a2a-worker) \
  && test \"\$(pm2 pid keryx-a2a-worker)\" != \"0\" \
  && pm2 save >/dev/null"
run_ssh "$SSH" "cd $APP_DIR \
  && rm -rf .next.bak && mv .next .next.bak && mv .next.tmp .next \
  && KERYX_COMMIT=$COMMIT pm2 reload keryx --update-env"
fi

# 5. health-gate: roll back unless the new build answers 200 AND reports the pushed commit
say "5/5 health check ($HEALTH)"
ok=""
for i in $(seq 1 20); do
  body=$(run_ssh "$SSH" "$HEALTH_CURL" 2>/dev/null || true)
  if printf '%s' "$body" | grep -q "\"commit\":\"$COMMIT\""; then
    ok=1
    echo "healthy after ${i}s — $COMMIT live"
    break
  fi
  sleep 1
done
if [ -z "$ok" ]; then
  if [[ -n "$REVIEWED_CONFIG" ]]; then
    echo "Reviewed deployment unhealthy; hold current processes and retain .next/.next.bak for inspection." >&2
    exit 1
  fi
  echo "!! new build unhealthy — rolling back to the previous build" >&2
  run_ssh "$SSH" "cd $APP_DIR && rm -rf .next && mv .next.bak .next \
    && KERYX_COMMIT=$PREVIOUS_COMMIT pm2 reload keryx --update-env"
  echo "rolled back; keryx.cc is serving the previous build." >&2
  exit 1
fi

if [[ -z "$REVIEWED_CONFIG" ]]; then run_ssh "$SSH" "cd $APP_DIR && rm -rf .next.bak"; fi
if [[ "$PRESERVE_HELD" == 0 ]]; then
run_ssh "$SSH" bash -s -- resume "$PRIVATE_WORKER_STATE" < "$SCRIPT_DIR/private-worker-deploy.sh"
run_ssh "$SSH" bash -s -- resume "$WITHDRAWAL_CYCLE_STATE" < "$SCRIPT_DIR/withdrawal-cycle-deploy.sh"
# Code deploys are the normal production path, so operational schedules introduced by a release
# must be refreshed here too (deploy-vps.sh only runs during first provisioning).
run_ssh "$SSH" bash -se <<REMOTE
set -euo pipefail
NPM=\$(command -v npm)
RECONCILE="*/10 * * * * cd $APP_DIR && \$NPM run reconcile-payments >> $APP_DIR/data/backups/reconcile.log 2>&1 # keryx-reconcile"
( crontab -l 2>/dev/null | grep -v '# keryx-reconcile' || true ; echo "\$RECONCILE" ) | crontab -
echo "reconciliation cron installed"
REMOTE
else
  echo "Held schedulers preserved; no worker resume or cron rewrite."
fi
echo "✅ redeploy complete — $COMMIT live on keryx.cc (low-downtime)"
