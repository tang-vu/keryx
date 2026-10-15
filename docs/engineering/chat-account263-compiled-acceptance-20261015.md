# Chat account #263 compiled consent acceptance — 2026-10-15

Status: authored, **all new execution/acceptance gates UNRUN**. Only the new
`scripts/test-browser-chat-accounts263-built.mts` and this document are source
writes. Existing runtime, UI, hook, catalogue, store, session, schema, financial,
API, provider, credentials, CI, config, native and test files remain protected.
No Git writes, compiler, build, candidate-module, browser, database, environment, port,
network, provider, wallet, signature, payment or production operations were run.
This is a parent execution handoff, not product/source acceptance or issue closure.

The owner reports actual **41 PASS** (4 old + 8 new + FIRST29 mounted consent UI),
prior 72 and native-authority evidence. Those reports are retained as prior scoped
evidence; this worker did not reproduce them. The parent accepted only two erased
fixture-typing corrections. Neither those controls nor this authored driver prove
the entire product, current-main composition or real compiled delivery.

## Consumed source and boundaries

The driver serves the already-built `/me/chat-accounts` and token-free `/account`
routes through installed **Next 16.3.8**, with the genuine emitted client references,
`ChatAccountLinks`, header/wallet consumers and canonical `useSiweAuth`. It does
not bundle a substitute renderer, component, hook or auth module. Its only fixture
transport is browser interception of same-origin session, account-membership GET,
chat preview/list/complete/unlink and the donor's explicit incidental consumers.
Unknown API, WebSocket and external requests are refused. Raw synthetic credentials
are inspected only in browser POST bodies; request evidence records action/path,
never bodies or tokens. Synthetic account/recipient strings are clearly synthetic.

The readonly adaptation reference is
`D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-topic-watch284-native-manual-product-20261015/scripts/test-browser-topic-watches284-built.mts`.
The owner identified its exact-source 925452/current mechanical a715 lineage;
those identifiers are provenance supplied by the owner, not Git verification by
this worker. The existing own built-server scripts and Next installed custom-server
guide were read as lifecycle context. No unmerged ROOT #496 source was copied.
The existing `test-support/next-config-fixture.ts` supplies the bounded config
evaluation graph; no arbitrary source-tree copy or dependency installation.

The successor read the actual accepted main commit
`ae0eae368d2199416f3ecc2f493f44d2501dfa87` using Git show only. Driver assertions
pin that canonical `useSiweAuth` and `lib/browser-auth-notice` contract (LF-normalized
hashes; admission still pins exact raw source bytes). No shipped hook was copied.
In the canonical hook, foreign legacy `changed` and structured `changed` hints
only clear session state; they start no session IO. Structured logout pending/terminal hints invalidate
state, normalize peer `confirmed` to false, and fence refresh while pending. A
terminal hint permits a new server check; it cannot confirm logout or restore auth.
Only the real notifier's document source distinguishes own structured changes;
this synthetic peer never impersonates it. The existing chat component separately
reloads its private GET on these notices; the held-read gate preserves that
original behavior. No assertion invents a pending peer fence for that consumer.
After terminal delivery, focus must start a fresh canonical server session check.
Existing local-event/focus controls
still exercise fresh server checks. All new native BroadcastChannel controls are
UNRUN, with synthetic server transport and no signed-out/custody authority.
Parent has not composed OWN263 because the separate OpenAPI author remains active.
Ordinary ae composition, current types, strict copy, build and browser gates remain
pending; neither that author's unfinished source nor this contract pin is acceptance.

Synthetic GET session is not a genuine cookie/JWT/web-session proof. The popup
membership GET explicitly returns `account_unauthenticated`; its later synthetic
availability is not enrollment, member lineage or durable native authority.
The five-minute preview/proof is format-shaped synthetic transport, not server
HMAC qualification. Link/unlink/list responses do not qualify native transactions,
provider registration, private chat identity or historical ownership. They do not
settle, sign, fund, send messages or confer financial authority. No server API
handler receives these intercepted requests. The isolated empty offline/testnet
database is used only by actual instrumentation boot, never by these assertions.

## Parent admission and exact commands

These are future parent commands, **not executed here**. ROOT supplies an existing
readonly dist built from the ordinary composed source, exclusive own output,
owned port, exact build/source/input evidence and admission JSON. Do not run with
placeholder values or manufacture evidence. Git, when the parent needs it, is
`C:/Program Files/Git/cmd/git.exe`. No new CLI slot or framework is required.

R157 FIRST actual read-only review returned REQUEST CHANGES, two P2 findings:
`refill-successors-20261013-157/worker-review263FirstCompiledConsentHarness/findings.json`
and `findings.md` under the canonical `output/resume-root-release63-20261012/`.
F1 is the foreign temp/cache junction path; F2 is a cleanup rejection replacing
the scenario failure. This successor authors both corrections; acceptance is UNRUN.
Parent next reviews the tiny changed delta, runs meaningful failure controls,
current types and strict copy, ordinarily composes ae, then performs one applicable
current-source app build under existing parent resource admission.
The parent's applicable command forms are:

```powershell
& node --import tsx node_modules/typescript/bin/tsc --noEmit --incremental false
& npm run build
```

Use the existing parent build wrapper/admitted `NEXT_DIST_DIR` and source-restoration
controls when needed; this driver does not build or modify configs. Preserve
original actual failure and type evidence and reuse unchanged-input acceptance.
Neither an admission string nor a BUILD_ID alone proves current-main provenance.

Use the following invocation within the owned worktree after ROOT supplies actual
values through the four parameters. The output directory, temp/cache directories
and admission file must already exist; `runtime` and `run` must be absent.

```powershell
param(
  [Parameter(Mandatory)][string]$Chat263Dist,
  [Parameter(Mandatory)][string]$Chat263Output,
  [Parameter(Mandatory)][int]$Chat263Port,
  [Parameter(Mandatory)][string]$Chat263Admission
)
$env:TEMP = Join-Path $Chat263Output 'temp'
$env:TMP = Join-Path $Chat263Output 'temp'
$env:TSX_CACHE_DIR = Join-Path $Chat263Output 'tsx-cache'
$env:NODE_OPTIONS = '' # Existing parent child-environment isolation: no inherited preloads.
# Read-only built-in preflight: no tsx, candidate import or write operation.
# Must succeed BEFORE starting the write-capable node/tsx child below.
$Chat263PhysicalPreflight = @'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.cwd()), output = path.resolve(process.argv[1]);
const physical = fs.realpathSync(output), part = path.relative(path.join(root, 'output'), physical);
assert(part && !path.isAbsolute(part) && part !== '..' && !part.startsWith('..' + path.sep));
// Reject every reparse-link ancestor, not merely a matching lexical prefix.
function directory(p) {
  for (let cursor = p;; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Existing physical directory only: ' + cursor);
    if (path.dirname(cursor) === cursor) break;
  }
}
directory(output);
assert.equal(fs.realpathSync(output), physical);
for (const [name, leaf] of [['TEMP','temp'], ['TMP','temp'], ['TSX_CACHE_DIR','tsx-cache']]) {
  const expected = path.join(physical, leaf), supplied = path.resolve(process.env[name] || '');
  assert.equal(supplied, path.join(output, leaf)); directory(supplied);
  assert.equal(fs.realpathSync(supplied), expected);
  assert.equal(fs.readdirSync(supplied).length, 0, 'Fresh exclusive empty leaf; no inherited links/cache files');
}
'@
& node -e $Chat263PhysicalPreflight $Chat263Output
if ($LASTEXITCODE -ne 0) { throw 'Chat263 physical temp/cache admission failed; do not start tsx' }
& node --import tsx scripts/test-browser-chat-accounts263-built.mts `
  "--dist=$Chat263Dist" "--output=$Chat263Output" `
  "--port=$Chat263Port" "--admission=$Chat263Admission"
```

The parameterized invocation consumes actual supplied paths, not literal
placeholders. ROOT's existing child-process capture must additionally retain
actual `exit`, `close`, exit code/signal and separate stdout/stderr EOF. Do not
use this interactive invocation's last output line as natural-exit proof.

The read-only reference is the parent's existing
`output/resume-distribution63-audit-20261012/run-watch284-first-current-compiled.mjs`:
it exclusively creates a fresh output and physical temp/cache leaves and checks
lstat/realpath before the tsx child. ROOT must prepare these exclusive directories
under its own admitted output, verify the existing parent before any creation,
and require empty temp/cache leaves before launch (no inherited hardlinked files),
and keep them exclusively owned through exit. Never reuse arbitrary links or
foreign destinations. The preflight above performs no writes and loads only Node
built-ins; the driver repeats positive directory/no-link/exact realpath leaf checks
before its first output writes and Chromium. No permission/ACL/config override.

Admission JSON fields are `owner: "ROOT"`, `currentMainCompositionEvidence`,
`buildEvidence`, absolute `dist`, absolute `output`, numeric `port`, actual `buildId`,
ordered `sourcePins` and ordered `compiledPins`. Each pin is `{path, sha256}`.
No template admission with invented values is provided. The script defines the
exact sorted source list (config graph, lockfile, instrumentation, page/client,
canonical hook and relevant account files plus driver); compiled pins cover the
entire emitted tree sorted by path, including chunks, page/client-reference
manifests, BUILD_ID and required-server files. ROOT must independently bind these
to the actual build inputs/current-main composition, including relevant transitive
auth/session/config coupling. Source files and readonly dist are checked again
after scenarios. No whole-product acceptance is inferred from these pins.

Lexical and realpath containment require dist within this worktree and output
within its `output/`. Dist/output cannot contain one another. Admission must
resolve within output. Emitted-tree symlinks are refused. Fresh runtime receives
only admitted compiled bytes, the existing exact config graph and a readonly
node_modules junction. Only named pages/favicon and finite pinned static assets
can reach Next; browser API calls never reach it. Inherited credential/provider/
storage variables are removed inside the isolated process. Only the donor's
explicit offline/testnet boot variables and essential OS/temp values are assigned;
no envfile, new schema, provider key or source activation variable is installed.
Server fetch and TCP reject outbound origins/ports/pipes. Browser external delivery
attempts are refused and retained, never silently continued.

## Authored scenario acceptance

- Only 360px and 1366px. Actual initial fragment intake must scrub before **every
  observed browser fetch**, including canonical session consumers, and no token
  may enter server HTML, requests/queries/referrers, console or public storage.
  The observer never scrubs on the component's behalf. Any hydration ordering
  gap is a genuine failed gate for parent review, not permission to change UI here.
- Explicit load renews the synthetic preview; checkbox begins unchecked and
  completion is absent until checked/clicked. Exact completion consent includes
  `financialAuthorityUnchanged: true` and `pastRunIds: []`. Exact unlink and list
  refresh preserve the static historical-unavailable copy.
- Two actual same-origin browser pages, native BroadcastChannel, direct window
  focus, logout and session replacement clear private account/link/preview/checkbox
  state. Same-wallet replacement cannot reuse established token or consent;
  a new intake requires fresh preview and unchecked consent.
- Held native response JSON bodies for load, preview, complete, completion refresh,
  unlink and unlink refresh cross channel/focus/logout boundaries. A DOM mutation
  observer is armed before invalidation. Released bodies cannot repaint private
  markers/consent/success or start follow-up private IO. Browser/body deadlines
  remain 10 seconds; no sleeps, retries, force clicks, locator first/nth, skips
  or increased deadlines.
- Anonymous initial 401 and enrolling 409 retain only initial intake. `/account`
  opens an actual separate tab without opener, token or referrer; returning uses
  synthetic current-session availability, fresh preview and explicit checkbox.
  There is no wallet signing or membership write. Unknown fragment, expired
  preview, unavailable preview and 401/409/503 private-reload refusals leave no
  private UI projection or completion.

Natural cleanup releases held synthetic streams, closes every page/context/browser,
awaits the **original existing** Next entry preload promise, drains the public HTTP
listener, calls actual instrumentation close, actual Next server close and Next
app close, flushes traces and naturally drains observed private HTTP listeners.
Every scenario, including the fresh-session nested scenario, retains its original
rejection. If cleanup also fails, AggregateError contains the original object and
the cleanup error, with the original as cause; all page/context cleanup attempts
still run. Closed pages remain distinct from crashed open pages, whose evaluate
failure is retained. This source correction has no crash/close PASS evidence yet.
NextCustomServer uses allSettled internally, so the actual underlying server close
is also awaited directly to retain failure. No forced exit, kill, unref, stream
destruction, disabled/substituted preload or swallowed cleanup failure is used.
Terminal catches set `process.exitCode = 1` first, before awaited failure writes,
and rethrow the original failure or AggregateError. JSON leaves actual process
exit/close/EOF null; only parent external observation establishes those facts.

## Frozen handoff and remaining gates

The explicitly requested `output/compiled-consent-handoff.json` is retained as an
evidence artifact alongside the two new source files. It records raw original
absence (`null`) for both new files, exact new raw bytes (base64 plus SHA-256),
and full inverse actions deleting only these newly created files. Existing #263
files and protected English/runtime/native/typing paths from the successor,
catalogue and research inventories are frozen as exact raw bodies and hashes.
The artifact labels existing-file snapshots as captured after authoring, not as
independently measured pre-turn before/after equality or accepted current source.
This worker's writes were restricted to the two source additions and this expressly
requested artifact. Existing handoffs and actual failed captures remain untouched.
Parent compares the freeze with its pre-turn accepted pins, preserves the full
inverse and refreshes the new file hashes after any reviewed correction.

`output/compiled-consent-successor-handoff.json` retains full raw before/after and
inverse restoration bytes for this two-file correction, plus the original 69 raw
protected snapshots with their original post-authoring qualification. It compares
them with physical bytes before/after this successor; that does not retroactively
establish independent pre-authoring equality. R158 owns only `lib/openapi-spec.ts`,
`lib/chat-accounts/openapi.ts`, `lib/chat-accounts/openapi.test.ts` and
`docs/engineering/chat-account263-api-contract-20261015.md`. Those precise active,
unconsumed paths are excluded from comparison, never accepted or edited here;
the original other 69 protected snapshots stay exact.

| Gate | Status / next owner action |
| --- | --- |
| R157 FIRST review | REQUEST CHANGES — two P2 source corrections authored here |
| Tiny changed-delta review and meaningful failure controls | UNRUN — parent next |
| Current types | UNRUN — parent, preserve prior accepted typing correction |
| Strict copy and auth-relevant meaningful failure controls | UNRUN — parent on current inputs |
| Ordinary actual current-main composition | UNRUN — parent before build |
| One applicable actual app build/input provenance | UNRUN — parent |
| Compiled scenario run | UNRUN — parent with explicit admission |
| Actual exit/close/separate EOF + listener drain | UNRUN — parent external capture |
| Required aggregate/domain CI and focused PR review | UNRUN — parent/coordinator |
| Focused PR merge directly into main | UNRUN — coordinator serializes; do not wait for other PRs |
| Combined release | UNRUN — one batch under existing release owner |
| Original provider/private command and production acceptance | OPEN — independent genuine evidence required |
| Original historical exact-list attachment | OPEN — lacks verified retained chat-user provenance |

Parent continues through review, types, one build, genuine compiled scenarios,
required CI, focused PR and coordinator merge, then records merged work awaiting
one batched deployment. This source-only task restriction is not a completed
product outcome. Original #263 remains open until original provider/private
link/unlink/whoami, future owned history with unchanged treasury authority,
native selected-store/session/member guards and production criteria have actual
acceptance. Historical attachment remains explicitly unavailable; synthetic UI
evidence cannot satisfy it. Default model/native policy/auth and financial
authority remain unchanged.

## R162 serialized callback source correction — 2026-10-15

R162's concrete P2 names the assigned authObserved and release arrows inside
observePage, serialized by context.addInitScript. Both now use the unnamed
array-element expression pattern retained in the accepted #284 serialization
evidence: [callback][0]. Callback bodies, event registration/removal, logout
observation, response body cap, return values, cleanup, original preload promise,
IO/state, assertions, deadlines and pageerror refusal are unchanged. No naming
helper global/shim, suppression, auth implementation or policy change is added.

Source tracing of observePage and adjacent evaluate/waitForFunction callbacks
found no additional case with the same demonstrated naming-helper escape.
Property-assigned fetch/json arrows, inline callback arguments and object methods
remain unchanged; this is source inspection, not fresh serialization acceptance.
R162's source acceptance of prior F1/F2 corrections is reused; meaningful failure
controls remain UNRUN. The original 69 protected pins and the four separate
OpenAPI paths remain byte-exact across this correction; no security re-audit or
OpenAPI acceptance is claimed. Full raw before/after, unique literals and
conditional full inverse are in output/self-contained-callback-handoff.json.

Tests, imports/module execution, compiler/types, browser, DB, Git, build and
provider execution were UNRUN. Parent retains definition-only actual
serialization validation, meaningful failure controls, changed types, strict
copy, ordinary current-main composition, one current build with provenance,
compiled acceptance and natural exit/close/separate EOF, required CI/review and
coordinator merge, then one deployment batch. No current-source/runtime or
delivery PASS is inferred. Original #263 remains OPEN.
## Current compiled acceptance — 2026-10-15

The current708/full22 build `4qiVXEMFJDmAfQPdYLvdl` passed once with no runtime source drift. Its 34 original synthetic browser controls now pass in three fixed disjoint captures: remaining16, refresh-initial9 and refresh-late9. Each actual invocation retained the original page-error, private-IO, fragment/session/consent, late-body, request-cap, deadline and natural-cleanup assertions. No selected invocation claims the unselected cases passed. The three clean captures together cover each original name exactly once. Prior attribution/cap failures remain retained.

The shipped harness now uses the same independently reviewed locale/session read attribution and fixed-selection protocol demonstrated by those captures. This is an external test-driver change after the build; the application, emitted UI and canonical auth-hook bytes used by the browser proof are unchanged. No rebuild is inferred or performed for this harness-only correction. Local server/native/route controls and focused types retain their separate qualified captures; production, real chat-provider messages and historical ownership remain unaccepted. Original #263 stays open.

Use all three fixed selection IDs with fresh owned outputs and exact parent admissions. The original per-invocation 2,048 HTTP cap is preserved. Required exact-head PR CI and the coordinator's release checks remain gates. The captured stock DATA is an immutable observation, with fresh metadata checks at execution boundaries; it is never described as a new hash scan.
