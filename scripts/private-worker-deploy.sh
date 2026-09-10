#!/usr/bin/env bash
# Runs on the deployment host. Never deletes locks, enables a service, or reads keys.
set -euo pipefail
unit=keryx-private-worker.service
mode=${1:-}
case "$mode" in
  stop)
    if ! command -v systemctl >/dev/null; then echo absent; exit 0; fi
    loaded=$(systemctl show "$unit" --property=LoadState --value)
    if [[ "$loaded" == not-found ]]; then echo absent; exit 0; fi
    [[ "$loaded" == loaded ]] || { echo "Private worker unit needs inspection" >&2; exit 1; }
    active=$(systemctl show "$unit" --property=ActiveState --value)
    pid=$(systemctl show "$unit" --property=MainPID --value)
    if [[ "$active" == inactive && "$pid" == 0 ]]; then echo inactive; exit 0; fi
    [[ "$active" == active && "$pid" =~ ^[1-9][0-9]*$ ]] || { echo "Private worker is not in a stable running state" >&2; exit 1; }
    # This can wait for an active job to drain. A long wait is not permission to kill/restart.
    systemctl stop "$unit" >/dev/null
    [[ $(systemctl show "$unit" --property=ActiveState --value) == inactive
      && $(systemctl show "$unit" --property=MainPID --value) == 0 ]] || { echo "Private worker has not stopped" >&2; exit 1; }
    echo active
    ;;
  resume)
    case "${2:-}" in
      absent|inactive) exit 0 ;;
      active)
        systemctl start "$unit" >/dev/null
        systemctl is-active --quiet "$unit"
        # Started is process state, not an idle observation or checkout-readiness promise.
        echo "Private worker service started; operational inspection remains required"
        ;;
      *) echo "Invalid private worker deployment state" >&2; exit 1 ;;
    esac
    ;;
  *) echo "Usage: private-worker-deploy.sh stop | resume <absent|inactive|active>" >&2; exit 1 ;;
esac
