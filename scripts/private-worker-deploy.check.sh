#!/usr/bin/env bash
# Hermetic supervisor tests: fake systemctl, no service, keys, network or app files.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d /tmp/keryx-worker-deploy.XXXXXX)
[[ "$fixture" == /tmp/keryx-worker-deploy.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
export WORKER_TEST_STATE="$fixture/state" WORKER_TEST_TRACE="$fixture/trace"
cat > "$fixture/systemctl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
read -r loaded active pid < "$WORKER_TEST_STATE"
case "$1" in
  show)
    case "$3" in
      --property=LoadState) echo "$loaded" ;;
      --property=ActiveState) echo "$active" ;;
      --property=MainPID) echo "$pid" ;;
      *) exit 1 ;;
    esac ;;
  stop)
    echo stop >> "$WORKER_TEST_TRACE"
    [[ "${WORKER_TEST_STOP_FAIL:-0}" != 1 ]] || exit 1
    [[ "${WORKER_TEST_STILL_ACTIVE:-0}" != 1 ]] || exit 0
    echo 'loaded inactive 0' > "$WORKER_TEST_STATE" ;;
  start)
    echo start >> "$WORKER_TEST_TRACE"
    echo 'loaded active 123' > "$WORKER_TEST_STATE" ;;
  is-active) [[ "$active" == active ]] ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$fixture/systemctl"
export PATH="$fixture:$PATH"
run() { bash "$script_dir/private-worker-deploy.sh" "$@"; }
echo 'not-found inactive 0' > "$WORKER_TEST_STATE"
[[ $(run stop) == absent ]]
run resume absent
[[ ! -e "$WORKER_TEST_TRACE" ]]
echo 'loaded inactive 0' > "$WORKER_TEST_STATE"
[[ $(run stop) == inactive ]]
run resume inactive
[[ ! -e "$WORKER_TEST_TRACE" ]]
echo 'loaded active 123' > "$WORKER_TEST_STATE"
[[ $(run stop) == active ]]
[[ $(cat "$WORKER_TEST_STATE") == 'loaded inactive 0' ]]
run resume active >/dev/null
[[ $(cat "$WORKER_TEST_TRACE") == $'stop\nstart' ]]
echo 'loaded active 123' > "$WORKER_TEST_STATE"
if WORKER_TEST_STOP_FAIL=1 run stop >/dev/null 2>&1; then exit 1; fi
if WORKER_TEST_STILL_ACTIVE=1 run stop >/dev/null 2>&1; then exit 1; fi
for state in 'loaded failed 0' 'loaded deactivating 123' 'loaded inactive 123' 'masked inactive 0'; do
  echo "$state" > "$WORKER_TEST_STATE"
  if run stop >/dev/null 2>&1; then exit 1; fi
done
if run resume invalid >/dev/null 2>&1; then exit 1; fi
echo 'Private worker deployment checks passed: absent/inactive, drain/resume, failed stop and unstable states.'
