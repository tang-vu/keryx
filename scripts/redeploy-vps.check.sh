#!/usr/bin/env bash
# Hermetic deployment orchestration: fake SSH/sleep, no hosts or app files touched.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d /tmp/keryx-redeploy.XXXXXX)
[[ "$fixture" == /tmp/keryx-redeploy.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
export DEPLOY_TEST_TRACE="$fixture/trace"
cat > "$fixture/ssh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
input=""
if [[ "$args" == *'bash -s'* || "$args" == *'/usr/bin/node --input-type=module - '* ]]; then input=$(cat); fi
printf '%s\n' "$args" >> "$DEPLOY_TEST_TRACE"
case "$args" in
  *'npm run typecheck'*)
    [[ "${DEPLOY_TEST_BAD_TYPECHECK:-0}" != 1 ]] || exit 1 ;;
  *'/usr/bin/node --input-type=module - '*)
    [[ "$input" == *'export function deployReviewedRole'* ]] || exit 1
    [[ "${DEPLOY_TEST_BAD_CONFIG:-0}" != 1 ]] || exit 1 ;;
  *'bash -s -- stop'*)
    if [[ "$input" == *'keryx-private-worker.service'* ]]; then echo inactive; else echo inactive; fi ;;
  *'git rev-parse --short HEAD'*) echo abc1234 ;;
  *'curl -fsS '*)
    [[ "${DEPLOY_TEST_BAD_HEALTH:-0}" != 1 ]] || exit 1
    echo '{"commit":"abc1234"}' ;;
esac
FAKE
cat > "$fixture/sleep" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE
chmod +x "$fixture/ssh" "$fixture/sleep"
export PATH="$fixture:$PATH" KERYX_SSH_BIN="$fixture/ssh"
run() { bash "$script_dir/redeploy-vps.sh" > "$fixture/output" 2>&1; }
managed() {
  KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER=1 \
  KERYX_REDEPLOY_REVIEWED_PM2_CONFIG=/root/.local/share/release/roles.json \
  KERYX_REDEPLOY_REVIEWED_PM2_SHA256=$(printf 'a%.0s' {1..64}) run
}
clear_trace() { : > "$DEPLOY_TEST_TRACE"; }
clear_trace
managed
! grep -Eq 'bash -s -- (stop|resume)|crontab|pm2 (restart|reload)|rm -rf .next.bak' "$DEPLOY_TEST_TRACE"
grep -q 'roles.json .* validate' "$DEPLOY_TEST_TRACE"
grep -q 'roles.json .* a2a' "$DEPLOY_TEST_TRACE"
grep -q 'roles.json .* web' "$DEPLOY_TEST_TRACE"
grep -q 'curl -fsS' "$DEPLOY_TEST_TRACE"
! grep 'curl -fsS' "$DEPLOY_TEST_TRACE" | grep -v "Host: keryx.cc.*X-Forwarded-Proto: https"
grep -q 'NODE_OPTIONS=--max-old-space-size=2560 npm run typecheck && rm -rf .next.tmp && NODE_OPTIONS=--max-old-space-size=1536 NEXT_DIST_DIR=.next.tmp npm run build' "$DEPLOY_TEST_TRACE"
first_validate=$(grep -n 'roles.json .* validate' "$DEPLOY_TEST_TRACE" | head -1 | cut -d: -f1)
first_sync=$(grep -n 'git fetch' "$DEPLOY_TEST_TRACE" | head -1 | cut -d: -f1)
(( first_validate < first_sync ))
clear_trace
if DEPLOY_TEST_BAD_CONFIG=1 managed; then exit 1; fi
! grep -Eq 'git fetch|bash -s -- stop|pm2|mv .next' "$DEPLOY_TEST_TRACE"
clear_trace
if DEPLOY_TEST_BAD_HEALTH=1 managed; then exit 1; fi
grep -q 'hold current processes' "$fixture/output"
! grep -Eq 'rm -rf .next|pm2 (restart|reload)|bash -s -- resume|crontab' "$DEPLOY_TEST_TRACE"
# Default path still pauses/resumes workers and uses its existing reload behavior.
clear_trace
if DEPLOY_TEST_BAD_TYPECHECK=1 managed; then exit 1; fi
! grep -Eq 'roles.json .* (a2a|web)|pm2 (restart|reload)|mv .next' "$DEPLOY_TEST_TRACE"
clear_trace
run
grep -q 'bash -s -- stop' "$DEPLOY_TEST_TRACE"
grep -q 'bash -s -- resume' "$DEPLOY_TEST_TRACE"
grep -q 'pm2 reload' "$DEPLOY_TEST_TRACE"
# Invalid inputs refuse before the SSH sanity call.
for bad in 2 yes ''; do
  clear_trace
  if KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER="$bad" \
      KERYX_REDEPLOY_REVIEWED_PM2_CONFIG=/tmp/roles.json run; then exit 1; fi
  [[ ! -s "$DEPLOY_TEST_TRACE" ]]
done
clear_trace
if KERYX_REDEPLOY_REVIEWED_PM2_SHA256=$(printf 'a%.0s' {1..64}) run; then exit 1; fi
[[ ! -s "$DEPLOY_TEST_TRACE" ]]
echo 'Redeploy orchestration checks passed: managed starts, held schedules, prevalidation, health hold and legacy defaults.'
