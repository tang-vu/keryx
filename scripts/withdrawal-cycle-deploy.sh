#!/usr/bin/env bash
# Pause future cycles before draining the current one. Never installs/enables a
# timer, removes a lock, uses SIGKILL or restarts a manual one-shot cycle.
set -euo pipefail
timer=keryx-withdrawal-cycle.timer
service=keryx-withdrawal-cycle.service
show() { systemctl show "$1" --property="$2" --value; }
case "${1:-}" in
  stop)
    if ! command -v systemctl >/dev/null; then echo absent; exit 0; fi
    timer_load=$(show "$timer" LoadState)
    service_load=$(show "$service" LoadState)
    if [[ "$timer_load" == not-found && "$service_load" == not-found ]]; then echo absent; exit 0; fi
    [[ "$service_load" == loaded && ( "$timer_load" == loaded || "$timer_load" == not-found ) ]] || exit 1
    timer_state=inactive
    if [[ "$timer_load" == loaded ]]; then
      timer_state=$(show "$timer" ActiveState)
      [[ "$timer_state" == active || "$timer_state" == inactive ]] || exit 1
      if [[ "$timer_state" == active ]]; then
        systemctl stop "$timer" >/dev/null
        [[ $(show "$timer" ActiveState) == inactive ]] || exit 1
      fi
    fi
    # The timer is now paused, so no scheduled activation can race the drain.
    state=$(show "$service" ActiveState)
    pid=$(show "$service" MainPID)
    result=inactive
    if [[ "$state" == inactive && "$pid" == 0 ]]; then :
    elif [[ ( "$state" == active || "$state" == activating ) && "$pid" =~ ^[0-9]+$ ]]; then
      result=manual
    else
      echo 'Withdrawal cycle is not in a stable drainable state' >&2; exit 1
    fi
    [[ $(show "$service" SendSIGKILL) == no && $(show "$service" KillMode) == control-group ]] || exit 1
    # Stop even an inactive service to cancel a start job already queued by the
    # timer. Zero MainPID alone does not prove there is no pending activation.
    systemctl stop "$service" >/dev/null
    [[ $(show "$service" ActiveState) == inactive && $(show "$service" MainPID) == 0 ]] || exit 1
    if [[ "$timer_state" == active ]]; then result=timer-active; fi
    echo "$result"
    ;;
  resume)
    case "${2:-}" in
      absent|inactive|manual) exit 0 ;;
      timer-active)
        [[ $(show "$timer" LoadState) == loaded && $(show "$service" LoadState) == loaded
          && $(show "$timer" ActiveState) == inactive && $(show "$service" ActiveState) == inactive
          && $(show "$service" MainPID) == 0 && $(show "$service" SendSIGKILL) == no
          && $(show "$service" KillMode) == control-group ]] || exit 1
        systemctl start "$timer" >/dev/null
        systemctl is-active --quiet "$timer"
        echo 'Withdrawal timer resumed; operational inspection remains required'
        ;;
      *) exit 1 ;;
    esac
    ;;
  *) echo 'Usage: withdrawal-cycle-deploy.sh stop | resume <absent|inactive|manual|timer-active>' >&2; exit 1 ;;
esac
