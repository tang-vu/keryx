#!/usr/bin/env bash
# Hermetic lifecycle checks. No real systemd service, wallet, network or journal.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d /tmp/keryx-cycle-deploy.XXXXXX)
[[ "$fixture" == /tmp/keryx-cycle-deploy.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
export CYCLE_TEST_ROOT="$fixture"
cat > "$fixture/systemctl" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
unit=${2:-}
if [[ "$1" == is-active ]]; then unit=$3; fi
case "$unit" in
  keryx-withdrawal-cycle.timer) state_file="$CYCLE_TEST_ROOT/timer" ;;
  keryx-withdrawal-cycle.service) state_file="$CYCLE_TEST_ROOT/service" ;;
  *) exit 1 ;;
esac
read -r loaded active pid kill mode < "$state_file"
case "$1" in
  show)
    case "$3" in
      --property=LoadState) echo "$loaded" ;;
      --property=ActiveState) echo "$active" ;;
      --property=MainPID) echo "$pid" ;;
      --property=SendSIGKILL) echo "$kill" ;;
      --property=KillMode) echo "$mode" ;;
      *) exit 1 ;;
    esac ;;
  stop)
    echo "stop $unit" >> "$CYCLE_TEST_ROOT/trace"
    [[ "${CYCLE_TEST_STOP_FAIL:-}" != "$unit" ]] || exit 1
    [[ "${CYCLE_TEST_STILL_ACTIVE:-}" != "$unit" ]] || exit 0
    echo "loaded inactive 0 $kill $mode" > "$state_file" ;;
  start)
    echo "start $unit" >> "$CYCLE_TEST_ROOT/trace"
    [[ "$unit" == keryx-withdrawal-cycle.timer ]] || exit 1
    echo "loaded active 0 $kill $mode" > "$state_file" ;;
  is-active) [[ "$active" == active ]] ;;
  *) exit 1 ;;
esac
FAKE
chmod +x "$fixture/systemctl"
export PATH="$fixture:$PATH"
run() { bash "$script_dir/withdrawal-cycle-deploy.sh" "$@"; }
state() { echo "$1" > "$fixture/timer"; echo "$2" > "$fixture/service"; : > "$fixture/trace"; }
state 'not-found inactive 0 no control-group' 'not-found inactive 0 no control-group'
[[ $(run stop) == absent ]]; run resume absent; [[ ! -s "$fixture/trace" ]]
state 'loaded inactive 0 no control-group' 'loaded inactive 0 no control-group'
[[ $(run stop) == inactive ]]; run resume inactive
[[ $(cat "$fixture/trace") == 'stop keryx-withdrawal-cycle.service' ]]
state 'loaded active 0 no control-group' 'loaded activating 123 no control-group'
[[ $(run stop) == timer-active ]]
run resume timer-active >/dev/null
[[ $(cat "$fixture/trace") == $'stop keryx-withdrawal-cycle.timer\nstop keryx-withdrawal-cycle.service\nstart keryx-withdrawal-cycle.timer' ]]
state 'loaded inactive 0 no control-group' 'loaded activating 123 no control-group'
[[ $(run stop) == manual ]]; run resume manual
[[ $(cat "$fixture/trace") == 'stop keryx-withdrawal-cycle.service' ]]
state 'loaded active 0 no control-group' 'loaded inactive 0 no control-group'
[[ $(run stop) == timer-active ]]; run resume timer-active >/dev/null
[[ $(cat "$fixture/trace") == $'stop keryx-withdrawal-cycle.timer\nstop keryx-withdrawal-cycle.service\nstart keryx-withdrawal-cycle.timer' ]]
state 'loaded active 0 no control-group' 'loaded activating 0 no control-group'
[[ $(run stop) == timer-active ]]
[[ $(cat "$fixture/trace") == $'stop keryx-withdrawal-cycle.timer\nstop keryx-withdrawal-cycle.service' ]]
for bad in 'loaded failed 0 no control-group' 'loaded deactivating 123 no control-group' 'loaded inactive 123 no control-group' 'loaded active 123 yes control-group'; do
  state 'loaded active 0 no control-group' "$bad"
  if run stop >/dev/null 2>&1; then exit 1; fi
  [[ $(cat "$fixture/trace") == 'stop keryx-withdrawal-cycle.timer' ]]
done
for unit in keryx-withdrawal-cycle.timer keryx-withdrawal-cycle.service; do
  state 'loaded active 0 no control-group' 'loaded active 123 no control-group'
  if CYCLE_TEST_STOP_FAIL="$unit" run stop >/dev/null 2>&1; then exit 1; fi
  state 'loaded active 0 no control-group' 'loaded active 123 no control-group'
  if CYCLE_TEST_STILL_ACTIVE="$unit" run stop >/dev/null 2>&1; then exit 1; fi
done
state 'loaded inactive 0 no control-group' 'loaded active 123 no control-group'
if run resume timer-active >/dev/null 2>&1; then exit 1; fi
[[ ! -s "$fixture/trace" ]]
if run resume invalid >/dev/null 2>&1; then exit 1; fi
echo 'Withdrawal cycle deploy checks passed: timer-first drain, prior-state resume, manual preservation and unsafe/failed stop refusal.'
