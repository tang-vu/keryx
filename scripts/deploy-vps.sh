#!/usr/bin/env bash
#
# deploy-vps.sh — provision & deploy Keryx to the always-on VPS, driven from the
# local machine over SSH. Contains NO secrets: it relies on the `keryx-vps` SSH
# host alias (~/.ssh/config) for the connection and scp's the local .env.local
# (which carries the real wallet/LLM keys) straight onto the box.
#
# Prereqs (one-time, done by you):
#   1. SSH key installed on the VPS so `ssh keryx-vps` works without a password.
#   2. Run from the repo root:  bash scripts/deploy-vps.sh
#
# Re-runnable: every step checks state first, so running it again just updates.
set -euo pipefail

SSH=keryx-vps                                   # ~/.ssh/config alias
REPO=https://github.com/tang-vu/keryx.git
APP_DIR=/root/keryx
PORT=3939                                       # matches `npm run start -p 3939`
PUBLIC_URL=https://keryx.cc                     # BASE_URL the app advertises in x402 URLs

say() { printf '\n\033[1;36m=== %s\033[0m\n' "$*"; }

# --- 0. sanity: key auth must already work -----------------------------------
say "0/7 checking SSH key auth"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH" 'true' 2>/dev/null; then
  echo "ERROR: 'ssh $SSH' needs a password. Install your public key first:" >&2
  echo "  Get-Content \$env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh root@<ip> \\" >&2
  echo "    \"mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\"" >&2
  exit 1
fi
[ -f .env.local ] || { echo "ERROR: .env.local not found in repo root" >&2; exit 1; }

# --- 1. base packages + Node 24 + pm2 + cloudflared --------------------------
say "1/7 provisioning packages (Node 24, pm2, cloudflared, git, build tools)"
ssh "$SSH" bash -se <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential ufw >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null 2>&1
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  dpkg -i /tmp/cf.deb >/dev/null
fi
echo "node=$(node -v)  pm2=$(pm2 -v)  cloudflared=$(cloudflared --version | head -1)"
REMOTE

# --- 2. swap (only on KVM; 1GB RAM OOMs during `next build` without it) -------
say "2/7 ensuring 2G swap"
ssh "$SSH" bash -se <<'REMOTE'
set -euo pipefail
virt=$(systemd-detect-virt || echo unknown)
if swapon --show | grep -q swap; then
  echo "swap already active: $(swapon --show --noheadings)"
elif [ "$virt" = kvm ] || [ "$virt" = qemu ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "created 2G swap"
else
  echo "WARN: virt=$virt (container) — cannot create swapfile. Build may OOM;"
  echo "      build locally and ship the .next output instead."
fi
REMOTE

# --- 3. clone or update the repo ---------------------------------------------
say "3/7 syncing repo at $APP_DIR"
ssh "$SSH" "if [ -d $APP_DIR/.git ]; then cd $APP_DIR && git fetch -q origin && git reset -q --hard origin/main; else git clone -q $REPO $APP_DIR; fi && cd $APP_DIR && git log -1 --oneline"

# --- 4. ship secrets (.env.local) + force production BASE_URL ----------------
say "4/7 copying .env.local and setting BASE_URL=$PUBLIC_URL"
scp -q .env.local "$SSH:$APP_DIR/.env.local"
ssh "$SSH" "cd $APP_DIR && (grep -q '^BASE_URL=' .env.local && sed -i 's#^BASE_URL=.*#BASE_URL=$PUBLIC_URL#' .env.local || echo 'BASE_URL=$PUBLIC_URL' >> .env.local) && echo 'BASE_URL set:' && grep '^BASE_URL=' .env.local"

# --- 5. install deps + build (swap-backed) -----------------------------------
say "5/7 npm ci + build (this is the slow step on 1GB)"
ssh "$SSH" "cd $APP_DIR && npm ci --no-audit --no-fund && NODE_OPTIONS=--max-old-space-size=1536 npm run build"

# --- 6. start under pm2, persist across reboot -------------------------------
say "6/7 (re)starting app under pm2 on :$PORT"
ssh "$SSH" "cd $APP_DIR && (pm2 reload keryx 2>/dev/null || pm2 start npm --name keryx -- run start) && pm2 save && pm2 startup systemd -u root --hp /root >/dev/null 2>&1; pm2 status"

# --- 7. hourly cron: consistent DB backup + treasury watchdog ----------------
# Backup snapshots the live db (off-box when KERYX_BACKUP_REMOTE set); the watchdog alerts before
# the funder runs dry (via KERYX_ALERT_WEBHOOK). Both cd into the app dir so npm run picks up .env.local.
say "7/7 installing hourly backup + treasury-watchdog cron"
ssh "$SSH" bash -se <<REMOTE
set -euo pipefail
NPM=\$(command -v npm)
mkdir -p $APP_DIR/data/backups
# cron has a bare PATH, so the npm path is absolute. Idempotent: drop any prior keryx lines first.
BACKUP="0 * * * * cd $APP_DIR && \$NPM run backup >> $APP_DIR/data/backups/backup.log 2>&1 # keryx-backup"
TREASURY="30 * * * * cd $APP_DIR && \$NPM run check-treasury >> $APP_DIR/data/backups/treasury.log 2>&1 # keryx-treasury"
( crontab -l 2>/dev/null | grep -vE '# keryx-(backup|treasury)' || true ; echo "\$BACKUP"; echo "\$TREASURY" ) | crontab -
echo "cron installed:"; crontab -l | grep -E 'keryx-(backup|treasury)'
REMOTE

cat <<DONE

✅ App built and running on the VPS at http://localhost:$PORT (internal).
   Verify:  ssh $SSH "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:$PORT"

Next — expose it at keryx.cc with a Cloudflare named tunnel (headless path):
  1. Add keryx.cc to a free Cloudflare account; switch nameservers at Namecheap to Cloudflare's.
  2. Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create tunnel (Cloudflared).
  3. Copy the shown "install" command (has a token) and run it ON the VPS:  ssh $SSH
  4. In the tunnel's Public Hostname tab: keryx.cc  →  http://localhost:$PORT
  (Optional seed:  ssh $SSH "cd $APP_DIR && npm run seed-sources")
DONE
