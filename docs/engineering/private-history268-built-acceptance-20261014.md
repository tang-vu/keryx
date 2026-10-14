# Private268 compiled browser control — 2026-10-14

Status: **app and operations types, one production build and all four compiled browser
cases passed. The accepted control naturally closed in152,159ms, with zero cleanup
failures and the original95s scenario aggregate unchanged (ROOT acceptance below)**.
The author handoff and UNRUN statements below describe the earlier source-only stage.
This adds only [the compiled driver](../../scripts/test-browser-private-history268-built.mts)
and this document at base HEAD `ae298ff41c239b292a043b3442df33f1701a4b99`.
Both files were absent at the initial R117 assignment start. Existing runtime, source controls,
handoffs, dependency owners and coordinator65 remain untouched. Original268 is open.

## Retained evidence and exact references

The existing evidence directory is
`D:/repos/server/Github/Hackathon/keryx/output/resume-distribution63-audit-20261012/private268-window-target-affected-validation-20261014`.
Its exact relevant names are `actual-browser-result.json`,
`run/synthetic-evidence.json`, `changed-browser-invocation-consumed.json`,
`source-changed-two-tab-control.capture.json`, and the corresponding
`source-changed-two-tab-control.stdout.raw` / `.stderr.raw`.
There is no `preparation` child in that directory. The actual preparation/source
references, relative to `output/resume-distribution63-audit-20261012`, are:

- `prepare-private268-window-target-validation-20261014.mjs`
- `private268-window-target-affected-validation-20261014.mjs`
- `refill-successor-prep/refill-round102-20261013/normal-allocation-plan.json`
- `private268-window-focus-correction-20261014/source-pins.json`
- `private268-window-target-successor-20261014/source-manifest.json`

The preparation also consumes
`output/resume-pr440-recovery-20261012/private268-r106-failure-diagnostic-independent-source-review.json`
and `private268-window-target-independent-source-review-20261014.json` in that
same recovery output directory. These are read-only references, not runners to
execute again. R102/R106/R111's existing control and `useSiweAuth` behavior are
retained; this driver does not replace them or reinterpret their failed evidence.

The accepted source-browser capture reports **44,733 ms**, four passing scenarios,
Node `v24.21.0`, Chromium `153.0.8010.12` and esbuild `0.28.2`. It observes a
15,009 ms abort and a 20,004.1 ms lease with 24 pending storm claims. These are
retained observations of that source run, **not measurements of this new driver**.
The run's source pins are:

| Actual source input | SHA-256 in retained synthetic evidence |
| --- | --- |
| `scripts/test-private-job-history-workspace-browser.mts` | `d40a4b46d91b5f213856d6daa5c3e9edd26be4ffa6d5720ca10a385ab60d8252` |
| `lib/hooks/use-siwe-auth.ts` | `6511402d9cc34566d72ff52154761d4ff2a25ce859113d054d89ad03affb5426` |
| `components/keryx/private-job-history-workspace.tsx` | `5887a6f9e2450a943025fc25810ecd9787f96f7d1d31c9b2fa94403844981cb2` |
| `lib/history/private-job-history-contract.ts` | `a1c05f87fb2b83f3b811e19bbf2e5a3e98ea227b81706119fa40ae047a498117` |

The outer capture's script byte count differs from the nested run's byte count;
their SHA-256 agrees. Preserve both originals rather than rewriting that metadata.
The new external source handoff records fresh filesystem pins. Existing standalone
passes do not establish compiled Next, native storage, live SIWE, MCP, payment or
production acceptance.

## Actual built path and fixture boundary

The driver serves the emitted `/me/private-jobs` page through pinned Next `16.3.8`
with `dev: false`. It requires the real compiled page/client-reference manifest,
all three mounted private-history handlers, and the compiled auth session/signout
handlers. It never creates another page, React root, workspace clone or auth stub.
The page mounts the real header `WalletMenu` and `PrivateJobHistoryWorkspace`,
including their real `useSiweAuth` instances and native `BroadcastChannel`.
The repaired driver uses a 1440×900 desktop viewport so the actual `lg` header
logout and About controls are visible. The mobile menu remains unmounted,
preserving exactly two canonical hook instances without forced clicks.
Playwright is the existing installed `1.63.0` dependency.

This follows [the existing compiled harness](../../scripts/test-browser-evidence-drafts.mts)
and [its config-copy boundary](../../test-support/next-config-fixture.ts).
The installed custom-server and Playwright guides were read under
`node_modules/next/dist/docs/01-app/02-guides/` before authoring. The compiled dist
is copied to the exclusive owned runtime so traces/cache writes cannot mutate the
donor. Only the already installed dependency junction is borrowed read-only.

The fixture selects **Arc testnet / offline**, a fresh local SQLite file and a
random local JWT secret. It inherits no provider, custody, enrolled storage,
Supabase or wallet credentials, and copies no envfile. The existing `SqliteAdapter`
initializes only that disposable fixture. Following the existing
[SQLite private-history fixture](../../lib/db/private-history.test.ts), an unfunded
ephemeral EOA locally signs a synthetic historic commitment; the unchanged
`preparePrivateResearchIntent` verifies it. The key is never exported, submitted
or used by a browser wallet. This establishes no real wallet or payment authority.

Four local fixture tables receive explicitly synthetic intent, incoming evidence,
worker and saved-result rows. The schema's `paymentMode: "real"` and
`circle-facilitator-success` fields are **synthetic stored inputs**, required to
exercise the existing completed reader. They are not facilitator success,
native capability proof, public settlement or paid execution. No payment, claim,
result producer or native admission verifier is substituted or invoked. No
original database/table is opened. The four fixture originals are compared
byte-for-byte throughout the control, including signed transport and the hidden
saved field; session rows are the separate mutable local auth fixture.

`issueWebSession` creates real durable rows and local cookies under that fixture
secret. The actual compiled handlers verify the JWT and current row, revalidate
the current session after reading, and project the actual SQLite originals.
Browser positive list/detail/auth responses are not fabricated or fulfilled with
fixture JSON. A finite fetch observer delays their actual loopback response or
decoded body. This preserves transport, owner preconditions, same-origin cookies,
body selectors, request bounds, private headers and cancellation fences. Auth is
never derived from a connector, notice, question or result ID.

The compiled page/RSC probes require private headers and a shell free of the
synthetic owner/question/answer. Actual mounted API probes require 405/Allow,
401 without auth, 403 for foreign Origin, 409 for a wrong expected owner, 401 for
explicit malformed Bearer despite a valid cookie, and 400 for an unknown owner
selector. These refusals must release no private fixture fields. Positive browser
reads require the retained answer as escaped text, testnet network, UNKNOWN legacy
provenance, NULL own-spend/reward/creator counts, and no private browser persistence.

Only incidental header `/api/payments` and `/api/me/locale-preference` GETs receive
explicit 503 fixtures. Unrelated link prefetches also receive counted 503s before
application rendering. They do not establish public-ledger/preference acceptance.
Other API routes, arbitrary page navigation and external browser/server fetches
refuse. LocaleProvider's actual extra session lookups are observed separately
from the two canonical hooks, using their existing request options; they are not
mistaken for additional authenticated actor instances.

## Four scenario distinctions

| Scenario | Authored compiled assertions |
| --- | --- |
| Normal JSON ACK and two-tab stale fences | Two actual page realms hold private detail/streaming body and both canonical hook sessions. Real menu logout cancels local private IO before HTTP and the peer's pending body reader. A replay cannot acquire publisher authority. Late old bodies do not repaint; releasing the actual successful JSON ACK emits exactly one local `signed-out`, never peer confirmation. |
| Local workspace unmount | Actual Next client navigation to `/about` unmounts the page/workspace. Its pending request aborts; the peer request and auth events remain unchanged. The peer can still display its real built response; late local completion cannot repopulate the new page. |
| Genuine 15-second abort without ACK | The unchanged `AbortSignal.timeout(15000)` aborts the held original logout response. The original 14.9–17 second observation bounds apply. No confirmed event is emitted; releasing the late ACK records discard and stale private/session results cannot repaint. |
| Vanished publisher, 20-second lease, 24-claim storm and fresh epoch | The original signout route completes local revocation, then the publisher document genuinely closes with its ACK still held. Twenty-four higher pending/confirmed claims cannot renew the first-start lease. Original 19.9–22 second bounds and sequence 25 remain. Expiry is unconfirmed and starts no canonical lookup. A deliberate new durable session and held real HTTP lookups establish the fresh epoch; exhausted notices cannot cancel it, while a later accepted terminal remains a clearing boundary. |

The actual compiled page has no test Actor buttons/data attributes. Descendant
focus exercises the canonical hooks' existing refresh listeners while the
accepted `target === currentTarget` workspace filter leaves detail IO live.
Real window focus exercises deliberate fresh authority recovery. The driver
observes real events, requests and DOM instead of exposing a replacement actor.
It does not claim to read otherwise inaccessible hook state directly.

The source control's 95-second total four-scenario observation budget and
8-second default browser waits remain. No clock replacement, deadline waiver,
automatic replay or shortened timer is introduced. Existing challenge-currentness,
expiry, key-scope/revocation, UNKNOWN refusal and both-store cases retain their
original separate gates; this local issuer fixture does not prove the SIWE
challenge/signature flow, enrolled storage or Supabase.

## Parent admission and natural lifetime

The driver accepts only `--dist=ABSOLUTE --output=ABSOLUTE`. The output must be a
physical descendant of **this worktree's `output`**, disjoint from the read-only
donor. Parent must reserve it and bind `TEMP`/`TMP` to `output/temp` and
`TSX_CACHE_DIR` to `output/tsx-cache` before launching. `run` and `runtime` are
exclusive new directories; existing evidence is never overwritten. The invocation
uses the existing Node/tsx and capture controls, not an alternative runner:

```text
node --import tsx scripts/test-browser-private-history268-built.mts --dist=<ADMITTED_COMPILED_DIST> --output=<OWN_WORKTREE>/output/<RESERVED_NEW_RUN>
```

This is an unexecuted interface description, not permission to launch it in this
source-only session. **No current compiled proof was supplied or accepted here**;
the owned `.next` was absent on inspection. The reachable missing partition is a
current, source/input-bound compiled app containing the six required page/API
entries plus compatible testnet reader/config inputs. Changing runtime ENV cannot
turn a mainnet-inlined or old compilation into that proof. Missing entries or
actual fixture admission must fail visibly; do not add an uncalled helper,
shipped bypass, alternate unsigned store or fabricated positive result.

Parent reuses a valid unchanged-source/input compilation if available. Only if
changed inputs require it or no valid compiled proof exists may ROOT allocate
the **one current host build** under the existing heavy resource owner. Old
`pgPw`/`cKFd` observations are not a current claim. This driver builds nothing,
reserves no host slot and changes no creator dependency or coordinator65 target.
Its source hashes/BUILD_ID observation alone do not prove source-to-build binding;
parent's existing exact-source/input acceptance must supply that binding.

Cleanup follows the installed programmatic server: close browser contexts/browser,
drain the owned HTTP listener, call the actual compiled instrumentation `close()`,
await `app.close()`, and flush Next traces. Local fixture handles close and the
parent environment/cwd are restored. There is no external termination, process
self-exit, unref or fabricated EOF. The in-process `natural-close.json` records
observed resource closures; process exit and stream EOF are explicitly unknown.
Parent must capture actual exit/close, exit code, signal, timeout/overflow and both
stream EOFs using its existing capture utility. A stdout PASS or synthetic JSON
before successful natural process completion is insufficient acceptance. Failures
and disposable fixture evidence remain retained for diagnosis.
The original main failure is retained unchanged when cleanup succeeds. Context,
browser, listener, instrumentation, app, trace, SQLite, restoration and artifact
closure failures are collected while the remaining natural closures are attempted.
Any cleanup failure throws an `AggregateError` with every caught error and its
original cause/stack; an existing main failure is also its first error and `cause`.
This refuses PASS and leaves details to the parent's raw failure capture; the
JSON closure artifact records only observations/counts, never error payloads,
ENV, cookies, headers, private bodies or secrets.

## Source handoff and remaining gates

The initial two-file source-only addition packet remains at:
`D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-117/worker-completePrivate268CompiledAcceptanceControl`.
Its inverse deletes the two originally absent additions. The source-only R119
peer found the hidden desktop controls and discarded cleanup errors; both are
repaired here. Parent separately reported a missing closing brace after
`pinSources()`'s bounded hash return, which is now restored so observation and
the run remain top-level. Parent's `node --check` exit 0 did not establish
TypeScript syntax acceptance; no driver execution followed from it.

This repair's exact raw before/after, minimal patch, full inverse and fresh pins
are retained only at:
`D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-121/worker-repairPrivate268CompiledControlFindings`.
Its inverse restores the two R119-reviewed physical files, including their
unfixed driver findings; it deletes no addition and touches no runtime/handoff.
Pins are external to this document to avoid a self-hash cycle. Source readback,
diff and hash inspection are not compiler, browser or test acceptance.

Next: different focused source peer review and meaningful TypeScript checks,
parent current-main composition and one applicable current build/compiled
acceptance if no valid proof exists, with build provenance and natural capture,
then the coherent Original268 focused PR and actual required aggregate/domain/platform CI. The sole
coordinator serializes merge and accumulates delivery into the existing batch.
Packed stdio/remote MCP discovery/cancellation, deployed/installed surface identity,
native Operator role, extension handoff, bot linkage and the broader Original268
account/creator/privacy/both-store gates remain separately open. No version,
deployment, activation, schedule, funding or current65 change follows from source.

This author executed no module, build, compiler/test, DB/browser/producer,
Git writer, provider/target, ENV mutation, DDL or install, and used no policy
workaround. Current auth/model/tier/effort, custody, spending limits and holds
remain unchanged. **Source alone does not complete Original268.**


## ROOT actual acceptance update — October 15 local

ROOT composed the focused outcome with main d98e22b3 and preserved the delegated
source. The current app typecheck passed with a 6 GiB compiler limit (89.565 s);
operations types passed separately. One genuine production build passed in
60.211 s at source b67796457b5dbd53bee7bf184c485e3352f9bfcd, BUILD_ID
`9GSSqSyMy3vXr7uiGN-gA`. Later driver-only observations reuse that unchanged
compiled runtime; they do not establish a newer runtime build.

The initial compiled run and subsequent narrowly instrumented controls failed
before any browser case. Cleanup completed naturally, but the driver failure
was reported by Next as an uncaught exception with child exit zero. The parent
correctly refused acceptance because the four-result report was absent and
`mainFailureObserved` was true. Exit zero alone is insufficient.

The boundary control recorded a listening exact loopback address and one request
listener, one guarded native fetch, zero TCP accepts and zero HTTP listener
entries. Native undici observation recorded one request/create and beforeConnect,
no connected/headers event; an eight-second abort was observed after 38.820 s.
A separate native loopback echo passed. One native CPU profile was captured to
identify the delayed event loop; no transport fallback or timeout relaxation
was introduced. Actual current cause and the four compiled scenarios remain open.

Captures, raw streams and result JSON are retained under
`output/resume-root-release63-20261012/private268-root-completion-20261014/`
in the canonical checkout. The seven failed compiled controls and their cleanup
records remain retained. Packed MCP, native/both-store, live authentication,
required PR CI, deployment and whole original-issue acceptance are not implied.

The retained native profile shows 39.497 s inclusive in Next
`unstable_preloadEntries` and 37.258 s self time in synchronous file reads; these
are weighted wall-time samples, not CPU utilization. Pinned Next starts this
preload once from its constructor without retaining its promise. The driver now
observes that genuine call and exact returned promise, restores the original
prototype descriptor in `finally`, and awaits the captured promise for the exact
selected server. It neither invokes a second preload nor changes compiled
configuration. Functional acceptance of this correction is pending.

The captured-preload correction subsequently reached real HTTP and browser
startup. The next failure occurred before the observer was installed: Playwright
reported an undefined `flush` control, and installed tsx/esbuild emits lexical
`__name` calls inside the serialized observer. The driver now supplies that
exact naming helper in a local IIFE with the unchanged observer and fixture
arguments. Operations types passed in 32.076 s. The next functional control
remains pending; no four-case pass is claimed.

The compiled private-header check now validates all mandatory Vary cache-key
fields while allowing Next routing dimensions. Actual control bf3b4689 passed
the first three browser cases, including the real 15 s abort (15,001.4 ms), but
the fourth case exceeded the unchanged 95 s aggregate deadline. The whole run
is rejected; failure-phase observation is pending. No timeout was extended.

## ROOT bounded independent timer overlap — 2026-10-15

The phase-observed control naturally closed after169,087ms with child exit0, both EOFs, and outer acceptance FAILED. The first three cases passed in23,998ms,13,730ms and31,675ms; the fourth was still waiting for its genuine20s receiver lease when the original95s aggregate expired. All five teardown completion flags were true, but cleanupFailureCount1 remains a failure. No successful four-case evidence is inferred.

The harness now overlaps only the last two independent BrowserContexts. The first two cases remain sequential. Each pair owns its cookie jar, pages and BroadcastChannel realm; each issueWebSession creates a random32-byte session ID, and signout revokes only that exact hash plus wallet. The shared private originals remain read-only. Every scenario assertion and the95s aggregate,8s ordinary deadline,15s abort and20s lease remain unchanged. Shared diagnostics conservatively fail both cases; results retain unique case names. Both promises settle before a scenario failure is rethrown, and after browser shutdown before database teardown on aggregate failure. No authentication, product runtime or payment change is involved.

This execution change is under independent source review. Operations types and a new finite compiled control will be recorded after actual completion. The same previously accepted build is reused because only the driver and this acceptance document changed. It does not establish final-main composition or production/native/MCP acceptance.

Actual operations TypeScript for the overlap driver passed in80,577ms (exit0, close and both EOFs; no timeout/overflow). Compiled control remains unrun for this delta until the independent source disposition.

The independent last-two overlap control naturally closed214,048ms (child0/fullEOF) but outer acceptance FAILED: original95s aggregate expired at terminal-new-interval. First3 cases passed27,569/17,195/42,431ms; no browser/HTTP errors, cleanupFailureCount1 retained. The next narrowly scoped execution change runs the first two independent contexts together as well, then waits for both before starting the final two. Peak remains two contexts/four pages and every scenario body/assertion/deadline is unchanged. The already accepted random-JTI/cookie/BC isolation proof applies to both stages. No complete compiled pass is claimed.

The staged pair run naturally closed125,005ms (child0/fullEOF) with cleanup0 but FAILED an8s wait: the normal ACK had remained held until its genuine15,008ms abort. Local unmount passed28,371ms; no browser/HTTP errors. A separate four-page local Chromium observation measured two actual animation frames in11–14ms, so frame-throttling is not established as the cause. The next schedule keeps the normal ACK case alone, then runs the three other independently authenticated contexts together. Every case body/deadline remains unchanged; peak is three contexts/six pages, with49,897,140KiB free physical memory observed. No product failure or complete pass is inferred from these harness observations.

## ROOT accepted compiled control — 2026-10-15

The normal-first control at3e5b7ca93cfdfe8d6456e331af6fade300d51023 passed all four uniquely named scenarios and both timer observations. The real abort was15,007.6ms and receiver lease20,001.9ms with24 pending storm claims and a fresh HTTP epoch. Normal ACK passed; actual local navigation remained without peer authority. Original private tables were byte-identical, externalAttempts0, browser/HTTP errors0 and cleanupFailureCount0. All listener/browser/instrumentation/app/trace closure flags were true. Actual capture naturally closed152,159ms, exit0/null, exit+close+separate stdout/stderr EOF, no timeout/overflow, empty stderr.

The existing immutable build atb67796457b5dbd53bee7bf184c485e3352f9bfcd was reused. Only the driver and this document changed afterward; no product auth/session/cookie/storage guard was altered to obtain the result. Scenario bodies and95s/8s/15s/20s deadlines remain unchanged. Independent source peer e2ab023f accepts the normal-first schedule; prior failed captures remain preserved and do not count as accepted runs. Outer acceptance requires exactly four passing case rows plus the two distinct observations, not merely exit0.

This is compiled web/API acceptance with disposable synthetic ArcTestnet originals and genuine local sessions; it is not real settlement, native client, remote MCP, production delivery or closure of original268. Final incoming-main composition, canonical source inputs and required PR CI remain separate gates.

The95s timer encloses the four-scenario browser block. The152.159s parent capture also includes fixture/build preparation, genuine Next startup/preload, HTTP boundary probes and teardown. Accepted case durations were20,045ms for normal ACK, then29,168/47,610/57,379ms for the three overlapping independent cases; no timer is increased or reset.
