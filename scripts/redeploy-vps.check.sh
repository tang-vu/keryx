#!/usr/bin/env bash
# Hermetic deployment orchestration: fake SSH/sleep, no hosts or app files touched.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fixture=$(mktemp -d /tmp/keryx-redeploy.XXXXXX)
[[ "$fixture" == /tmp/keryx-redeploy.* ]] || exit 1
trap 'rm -rf -- "$fixture"' EXIT
export DEPLOY_TEST_TRACE="$fixture/trace"
export DEPLOY_TEST_DIR="$fixture"
expected=$(printf 'c%.0s' {1..40})
export DEPLOY_TEST_REMOTE_SHA="$expected"
cat > "$fixture/ssh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
input=""
if [[ "$args" == *'bash -s'* || "$args" == *'/usr/bin/node --input-type=module - '* ]]; then input=$(cat); fi
printf '%s\n' "$args" >> "$DEPLOY_TEST_TRACE"
case "$args" in
  *'cd /root/keryx && git fetch'*)
    # Execute the actual remote shell gate, with Git isolated below. Merely seeing
    # a compare in the trace would not prove that mismatch prevents reset.
    cd "$DEPLOY_TEST_DIR"
    bash -c "${2#cd /root/keryx && }" ;;
  *'cd /root/keryx && test ! -e .next.tmp'*)
    cd "$DEPLOY_TEST_DIR"
    bash -c "${2#cd /root/keryx && }" ;;
  *'npm run typecheck'*)
    cd "$DEPLOY_TEST_DIR"
    node() { :; }
    npm() {
      printf 'NPM %s\n' "$*" >> "$DEPLOY_TEST_TRACE"
      [[ "$*" != 'run typecheck' || "${DEPLOY_TEST_BAD_TYPECHECK:-0}" != 1 ]]
    }
    export -f node npm
    bash -c "${2#cd /root/keryx && }" ;;
  *'bash -se')
    # Execute the actual remote install block against stubbed node/npm. Each word of
    # DEPLOY_TEST_INSTALL is one npm ci outcome: `ok` or the npm error code it reports.
    # Other remote heredocs keep their previous inert handling.
    [[ "$input" == *'dependency-state.mjs check'* ]] || exit 0
    cd "$DEPLOY_TEST_DIR"
    node() {
      printf 'NODE %s
' "$*" >> "$DEPLOY_TEST_TRACE"
      [[ "$*" != *' check' || -z "${DEPLOY_TEST_INSTALL:-}" ]]
    }
    npm() {
      printf 'NPM %s
' "$*" >> "$DEPLOY_TEST_TRACE"
      local count outcome
      count=$(( $(cat "$DEPLOY_TEST_DIR/npm-ci-count" 2>/dev/null || echo 0) + 1 ))
      echo "$count" > "$DEPLOY_TEST_DIR/npm-ci-count"
      outcome=$(cut -d' ' -f"$count" <<< "$DEPLOY_TEST_INSTALL")
      [[ "$outcome" != ok ]] || return 0
      echo "npm error code $outcome" >&2
      return 1
    }
    export -f node npm
    bash -c "${input//cd \/root\/keryx/cd .}" ;;
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
cat > "$fixture/git" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf 'GIT %s\n' "$*" >> "$DEPLOY_TEST_TRACE"
case "$*" in
  'fetch -q origin'|'log -1 --oneline') ;;
  'rev-parse origin/main') printf '%s\n' "$DEPLOY_TEST_REMOTE_SHA" ;;
  'reset -q --hard '*)
    if [[ "${DEPLOY_TEST_LATE_BUILD:-0}" == 1 ]]; then mkdir "$DEPLOY_TEST_DIR/.next.tmp"; fi ;;
  *) exit 1 ;;
esac
FAKE
cat > "$fixture/sleep" <<'FAKE'
#!/usr/bin/env bash
printf 'SLEEP %s
' "$*" >> "$DEPLOY_TEST_TRACE"
FAKE
chmod +x "$fixture/ssh" "$fixture/git" "$fixture/sleep"
export PATH="$fixture:$PATH" KERYX_SSH_BIN="$fixture/ssh"
run() { bash "$script_dir/redeploy-vps.sh" > "$fixture/output" 2>&1; }
managed() {
  KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER=1 \
  KERYX_REDEPLOY_REVIEWED_PM2_CONFIG=/root/.local/share/release/roles.json \
  KERYX_REDEPLOY_REVIEWED_PM2_SHA256=$(printf 'a%.0s' {1..64}) \
  KERYX_REDEPLOY_EXPECTED_COMMIT="${DEPLOY_TEST_EXPECTED_SHA-$expected}" run
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
grep -q 'NODE_OPTIONS=--max-old-space-size=2560 npm run typecheck && test ! -e .next.tmp && test ! -L .next.tmp && NODE_OPTIONS=--max-old-space-size=1536 NEXT_DIST_DIR=.next.tmp npm run build' "$DEPLOY_TEST_TRACE"
! grep -q 'rm -rf .next' "$DEPLOY_TEST_TRACE"
grep -qx "GIT reset -q --hard $expected" "$DEPLOY_TEST_TRACE"
first_validate=$(grep -n 'roles.json .* validate' "$DEPLOY_TEST_TRACE" | head -1 | cut -d: -f1)
first_sync=$(grep -n 'git fetch' "$DEPLOY_TEST_TRACE" | head -1 | cut -d: -f1)
first_retained_check=$(grep -n 'test ! -e .next.tmp.*test ! -L .next.bak' "$DEPLOY_TEST_TRACE" | head -1 | cut -d: -f1)
(( first_validate < first_sync ))
(( first_retained_check < first_sync ))
# A moved remote branch must fail before reset, env mutation, install, build or role start.
clear_trace
if DEPLOY_TEST_REMOTE_SHA=$(printf 'd%.0s' {1..40}) managed; then exit 1; fi
grep -qx 'GIT rev-parse origin/main' "$DEPLOY_TEST_TRACE"
! grep -Eq '^GIT reset|KERYX_COMMIT=|bash -se|npm run typecheck|roles.json .* (a2a|web)|mv .next' "$DEPLOY_TEST_TRACE"
# Both cold directories are recovery evidence; refusal must precede the first source fetch.
for retained in .next.tmp .next.bak; do
  mkdir "$fixture/$retained"
  clear_trace
  if managed; then exit 1; fi
  ! grep -Eq 'git fetch|KERYX_COMMIT=|bash -s -- stop|npm run typecheck|roles.json .* (a2a|web)|mv .next' "$DEPLOY_TEST_TRACE"
  rmdir "$fixture/$retained"
done
# A temporary build appearing after preflight must also be retained at the build boundary.
clear_trace
if DEPLOY_TEST_LATE_BUILD=1 managed; then exit 1; fi
[[ -d "$fixture/.next.tmp" ]]
grep -qx 'NPM run typecheck' "$DEPLOY_TEST_TRACE"
! grep -Eq '^NPM run build|rm -rf .next|roles.json .* (a2a|web)|mv .next' "$DEPLOY_TEST_TRACE"
rmdir "$fixture/.next.tmp"
# Dangling symlinks are retained objects too, even though test -e is false.
if [[ "$(uname -s)" != MINGW* && "$(uname -s)" != MSYS* ]]; then
  for retained in .next.tmp .next.bak; do
    ln -s "$fixture/absent-build" "$fixture/$retained"
    clear_trace
    if managed; then exit 1; fi
    ! grep -q 'git fetch' "$DEPLOY_TEST_TRACE"
    rm -- "$fixture/$retained"
  done
fi
clear_trace
if DEPLOY_TEST_BAD_CONFIG=1 managed; then exit 1; fi
! grep -Eq 'git fetch|bash -s -- stop|pm2|mv .next' "$DEPLOY_TEST_TRACE"
clear_trace
if DEPLOY_TEST_BAD_HEALTH=1 managed; then exit 1; fi
grep -q 'hold current processes' "$fixture/output"
! grep -Eq 'rm -rf .next|pm2 (restart|reload)|bash -s -- resume|crontab' "$DEPLOY_TEST_TRACE"
# One dropped registry connection is repeated; the stamp follows the successful install.
install() { rm -f "$fixture/npm-ci-count"; clear_trace; DEPLOY_TEST_INSTALL="$1" managed; }
install 'ECONNRESET ok'
[[ $(grep -cx 'NPM ci --no-audit --no-fund' "$DEPLOY_TEST_TRACE") == 2 ]]
grep -qx 'SLEEP 15' "$DEPLOY_TEST_TRACE"
[[ $(grep -cx 'NODE scripts/dependency-state.mjs record' "$DEPLOY_TEST_TRACE") == 1 ]]
last_install=$(grep -nx 'NPM ci --no-audit --no-fund' "$DEPLOY_TEST_TRACE" | tail -1 | cut -d: -f1)
recorded=$(grep -nx 'NODE scripts/dependency-state.mjs record' "$DEPLOY_TEST_TRACE" | cut -d: -f1)
invalidated=$(grep -nx 'NODE scripts/dependency-state.mjs invalidate' "$DEPLOY_TEST_TRACE" | cut -d: -f1)
(( invalidated < last_install && last_install < recorded ))
grep -q 'roles.json .* web' "$DEPLOY_TEST_TRACE"
# Integrity or lockfile failures are never repeated, and nothing is recorded, built or started.
if install 'EINTEGRITY ok'; then exit 1; fi
[[ $(grep -cx 'NPM ci --no-audit --no-fund' "$DEPLOY_TEST_TRACE") == 1 ]]
! grep -Eq '^SLEEP|dependency-state.mjs record|npm run typecheck|roles.json .* (a2a|web)|mv .next' "$DEPLOY_TEST_TRACE"
# Persistent network failure stops after three attempts with the same retained refusal.
if install 'ECONNRESET ETIMEDOUT EAI_AGAIN ok'; then exit 1; fi
[[ $(grep -cx 'NPM ci --no-audit --no-fund' "$DEPLOY_TEST_TRACE") == 3 ]]
grep -q 'npm ci failed on attempt 3' "$fixture/output"
! grep -Eq 'dependency-state.mjs record|npm run typecheck|roles.json .* (a2a|web)|mv .next' "$DEPLOY_TEST_TRACE"
# A verified unchanged install is still reused without touching the registry.
clear_trace
managed
! grep -Eq '^NPM ci|dependency-state.mjs (invalidate|record)' "$DEPLOY_TEST_TRACE"
# Default path still pauses/resumes workers and uses its existing reload behavior.
clear_trace
if DEPLOY_TEST_BAD_TYPECHECK=1 managed; then exit 1; fi
! grep -Eq 'roles.json .* (a2a|web)|pm2 (restart|reload)|mv .next' "$DEPLOY_TEST_TRACE"
clear_trace
run
grep -q 'bash -s -- stop' "$DEPLOY_TEST_TRACE"
grep -q 'bash -s -- resume' "$DEPLOY_TEST_TRACE"
grep -q 'pm2 reload' "$DEPLOY_TEST_TRACE"
grep -qx 'GIT reset -q --hard origin/main' "$DEPLOY_TEST_TRACE"
# Invalid inputs refuse before the SSH sanity call.
for bad in '' abc1234 "$(printf 'A%.0s' {1..40})" 'main;false'; do
  clear_trace
  if DEPLOY_TEST_EXPECTED_SHA="$bad" managed; then exit 1; fi
  [[ ! -s "$DEPLOY_TEST_TRACE" ]]
done
for bad in 2 yes ''; do
  clear_trace
  if KERYX_REDEPLOY_PRESERVE_HELD_SCHEDULER="$bad" \
      KERYX_REDEPLOY_REVIEWED_PM2_CONFIG=/tmp/roles.json run; then exit 1; fi
  [[ ! -s "$DEPLOY_TEST_TRACE" ]]
done
clear_trace
if KERYX_REDEPLOY_REVIEWED_PM2_SHA256=$(printf 'a%.0s' {1..64}) run; then exit 1; fi
[[ ! -s "$DEPLOY_TEST_TRACE" ]]
echo 'Redeploy orchestration checks passed: exact remote commit, retained builds, managed starts, held schedules, prevalidation, bounded install retry, health hold and legacy defaults.'
