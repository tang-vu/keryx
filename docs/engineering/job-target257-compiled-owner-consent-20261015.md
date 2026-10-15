# Original257 compiled owner-consent controls — 2026-10-15

This is a source-only, **incomplete acceptance harness**, not original257 E2E
acceptance. All authored cases, types, browser, build, native, CI and production
checks are **UNRUN** in this session. Only filesystem text/byte/hash inspection
was performed. No repository module, test, compiler, browser, database, provider,
target, ENV, payment, schedule or deployment was executed. Default model, native
policy and existing ChatGPT authentication remain unchanged.

The two new source files are this note and
[`scripts/test-browser-job-target257-built.mts`](../../scripts/test-browser-job-target257-built.mts).
The old `scripts/test-browser-job-target257.mts` remains byte-for-byte unchanged;
its entire existing driver and legacy assertions remain required. It is not
replaced by this harness. The independent session/owner-admission fixture author
owns its two test files and correction note. Those unfinished edits were neither
read as acceptance nor modified, imported or included in consumed runtime pins.

## A concrete reachability limit

The actual current `app/research/page.tsx` computes `available=false` when
`KERYX_FORCE_OFFLINE=1`. It renders `ResearchRequest` only inside the available
branch. `ResearchRequest` mounts `ResearchCheckout`, and the optional account
checkbox is inside checkout's interactive price-review state. Consequently, the
required same-as-284 empty offline testnet boot **does not mount checkout or its
checkbox**. A compiled marker or client-reference manifest does not prove that
the checkbox was rendered, defaulted to false, checked or dispatched a purchase.

Additionally, `lib/buyer/account-owned-transport.ts` requires the literal
`https://keryx.cc` browser origin both when reading and when consuming purchase
consent. A loopback page with intercepted sessions cannot acquire that fixed
origin. No production-origin navigation, virtual-origin rewriting, renderer
injection, runtime availability change, source esbuild surrogate, wallet signing
mock or shipped authentication bypass is supplied here.

The new driver therefore executes only reachable compiled detail controls and
ends with a deliberate nonzero **INCOMPLETE** error if those controls finish.
`run/outcome.json` retains the results and explicit coverage gaps; it never
reports original257 compiled owner-consent PASS. Earlier assertion, setup or
cleanup failures retain their original errors. This limitation must be resolved
by the parent in a separately authorized genuine compiled checkout environment;
it must not be disguised as passing coverage or fixed by weakening runtime.

## Exact current consumption and parent admission

Lifecycle/admission scaffolding is adapted from the read-only 284 donor at
`D:/repos/server/Github/Hackathon/.keryx-worktrees/cli-topic-watch284-native-manual-product-20261015/scripts/test-browser-topic-watches284-built.mts`,
SHA-256 `9254526742535f6cbdf4c0a23bf8faf1f775ef55d426d53242bdc8cfca5d7689`.
The donor is preserved entirely. Its scenario assertions are not claimed as
original257 coverage. The current 257 controls use the real `/research` route,
`ResearchJob`, `ResearchJobDetails`, mounted `AccountJobs`,
`ResearchJobEscalation`, `useJobTargetWarning` and their current transport/hooks.

Runtime imports in the driver are Node builtins, installed Playwright, the
existing config-copy helper and the three pure English copy modules. No source
UI, auth/payment implementation, schema, native adapter or store is imported as
a substitute for compiled rendering. Before boot, the driver reads and hashes
the current non-test files under `app`, `components`, `lib`, `locales`, `public`,
the exact config-copy input graph, package lock, instrumentation, worker, config
helper, preserved old driver and this new driver. The parent must supply the
same sorted path/hash list. Test/spec files and the independent fixture author's
note are excluded. This binds current runtime/product bytes, not their acceptance.

The parent supplies exactly four arguments:

```text
node --import tsx scripts/test-browser-job-target257-built.mts
  --dist=ABSOLUTE_CURRENT_READONLY_NEXT_DIST
  --output=ABSOLUTE_OWN_WORKTREE_OUTPUT_SUBDIRECTORY
  --port=EXPLICIT_OWNED_LOOPBACK_PORT
  --admission=ABSOLUTE_PARENT_ADMISSION_JSON
```

The output directory must already exist, resolve inside this worktree's `output`
and be disjoint from dist. `TEMP`, `TMP` and `TSX_CACHE_DIR` must already bind its
`temp`, `temp` and `tsx-cache` children. No port is guessed or automatically
reserved. The parent owns this future invocation and resource admission.

Admission JSON contains `owner: "ROOT"`, exact `dist`, `output`, `port`, `buildId`,
nonempty `buildEvidence` and `readOnlyDistProof` evidence references, and sorted
`sourcePins` / `compiledPins` arrays of `{path, sha256}`. Every dist file is pinned;
symlink entries refuse. These references are required parent attestations: the
driver cannot infer a successful current build or read-only provenance from
their strings. Parent independent review must inspect the actual referenced
proof. An old SOURCEACCEPT or unchanged-source result is insufficient.

Installed Next is pinned to **16.3.8**. The installed App Router Playwright and
deploying docs were read; they recommend production-code E2E and a genuine Node
server. The driver checks current `/research/page` app-path and client-reference
manifests and real emitted JS markers for checkout, detail ownership and session
transport. It copies the admitted dist into an exclusively created owned runtime,
checks initial copy identity, copies exact config inputs/public assets and uses
read-only installed dependencies. The parent dist and consumed source pins are
checked again on success **and failure**. Runtime mutations stay in the copy.

## Synthetic transport boundaries

All browser API responses are synthetic intercepted same-origin responses. They
do not authenticate a real cookie, create an owner association, settle anything
or establish native store evidence. The actual GET shapes inspected in source
are `/api/auth/session`, `/api/auth/sessions`,
`/api/agent/ask?queryId=a2a_<64 hex>` and
`/api/me/jobs?pending=owned&id=a2a_<64 hex>`. Incidental current consumers use
`/api/me/jobs`, `/api/me/private-jobs/history` with `{cursor:null}`,
`/api/sources` with no query or `?limit=20`, `/api/payments`,
`/api/me/locale-preference` and `/maintenance/status`. Unavailable incidental
responses are explicit 503 JSON, not successful fake domain results.

The synthetic durable tuple is `{id, issuedAt, expiresAt, current:true}` with a
fresh 64-hex selector and a separate synthetic wallet session. These are selectors
and synthetic facts, never production credentials. Current owner reads run the
real pre-body and post-body `/api/auth/sessions` checks and actual metadata-reader
cancellation. The browser fetch observer records credentials, method, path and
timing without substituting hooks. The public bearer GET must omit cookies and
the owner header; the owner observation GET must use `same-origin` credentials.
Foreign account responses return no owned rows; this qualifies suppression on
that reachable response, not malicious foreign-row wallet validation or server
authorization. Native signed-cookie authority remains a separate required gate.

Unknown APIs abort and record failure. No API reaches a compiled server handler.
External browser URLs and all WebSockets are blocked. Server fetch and TCP admit
only the explicit owned loopback listener; the HTTP handler admits only GETs for
the compiled research page/assets. No signing, wallet/provider/RPC, production
API key/cookie/private value, external DB, owner association, real payment or
settlement is involved. The empty offline testnet runtime boot is the donor's
existing isolated boot only; it grants no native/product/financial authority.

## Authored controls, all UNRUN

| Reachable real compiled control | Scope and limit |
| --- | --- |
| 360 phone / 1366 desktop, Quick / Deep failed and explicitly held originals before deadline | Mounted owner-private NeedsReview is distinct from overdue; failed recovery stays unknown; retained held copy requires explicit held response |
| Quick 180000 ms / Deep 300000 ms | Synthetic response deadlines derive from original `createdAt`; later `updatedAt` and polling do not restart them; the real timer consumes retained observation facts |
| Unknown, missing, historical, unowned | No inferred recovery hold or owner alert; historical timing remains unavailable |
| Recorded overdue versus locally elapsed retained observation | Real distinct customer-state selectors; local stale warning does not claim fresh server status or human contact |
| Wait / partial / human guidance | Real buttons change page guidance; no additional non-GET request, recovery/refund/payment execution or financial state write |
| Stalled owner fetch and separately stalled body | Real mounted five-second request lifetime clears attention, cancels body and permits a later actual read after the existing two-second cadence |
| Two native pages: logout, same-wallet replacement, foreign account, direct focus | Existing BroadcastChannel/auth/focus contracts clear old mounted attention; no protocol copied from Root496 |
| Late held body after invalidation or unmount | Actual reader cancellation and DOM observation refuse stale private paint |
| Same-wallet durable tuple replacement during body, without an auth hint | Post-body actual tuple recheck rejects the old request |
| Natural owned cleanup | Page fetch observer restored, streams released/cancelled, contexts and traces closed, browser closed, public HTTP drained, compiled instrumentation closed, Next app/private resources closed, traces flushed |

The held-response fixture supplies a real synthetic byte stream and records
native stream cancellation. It never supplies fake EOF/JSON. Native timers are
not replaced, inflated or slept through. No `.first()`/`nth()` selector, retry,
forced exit, kill, unref, cancelDestroy, disabled preload or weakened assertion is
used. The real original entry preload promise is observed and awaited before
browser work. Every terminal catch sets `process.exitCode=1` before awaited
failure-report writing; original control errors and cleanup failures are retained
together. Exit/close and both EOF observations remain null in the driver report:
only the parent can record actual process lifetime. Screenshots and context traces
remain in the exclusively owned output.

## Purchase controls still required, not implemented as fake success

Actual compiled price review must prove the separate owner checkbox is false by
default for each NEW request, false after refreshed review, and available only
with a fresh durable account tuple. Only an explicit checked consent for that
new request can add `x-keryx-account-job: associate`, `credentials: same-origin`
and `redirect: error` to the literal fixed-origin signed POST. The same original
question, budget, request body, authorization nonce and payment signature must
remain unchanged. Fresh pre-dispatch durable tuple checks, invalidation and
single consumption remain required. Opt-in refusal must not fall back to an
anonymous paid dispatch. Generic/external/anonymous/recovery/resubmit omission
controls require real reachable UI controls or separately labelled existing
transport unit proof. This driver fabricates no signed POST payload or success.

Browser wallet connection/signing, sufficient Gateway balance and actual checkout
availability are additional real product prerequisites, not synthetic session
authority. A wallet-sign mock unsupported by the current UI cannot establish a
genuine successful paid call, receipt, association or settlement. Existing
`lib/buyer/account-owned-transport.test.ts` and `browser-client.test.ts` evidence
must be separately qualified by the parent; this session ran neither.

## Continuing parent and coordinator work

Accepted R150 source/payment peer findings at
`output/resume-root-release63-20261012/refill-successors-20261013-150/worker-review257BrowserConsentAndMountedOwnerProduct/findings.json`
are separate source evidence. Parent's supplied first 198 native/server PASS and
five observed fixture failures are context, not executions observed here. The
independent two-fixture author remains responsible for its correction.

Next: parent independent tiny-harness review, first types, ONE needed current
build with exact current-source/read-only-dist proof, then genuine compiled
controls. Resolve the checkout reachability gap before original257 acceptance.
Keep the Root496 structured auth-notice coupling as a final-main gate; this
harness does not import its unmerged source or duplicate its protocol. Require
actual focused PR aggregate/domain CI and coordinator-serialized merge, record
merged changes awaiting the coordinator's deployment batch and complete final
main/surface/package acceptance. No Git changes or CI invocation occurred here.

This increment adds verification source only. Web/API, desktop, CLI, remote/stdio
MCP, extension and bots retain their runtime/distribution contracts; parent final
surface acceptance remains required. Original257 paid/vendor latency,
first-user/first-answer, remedy policy/execution, real delivery and customer
acceptance remain **OPEN**. This note is a concrete continuation handoff, not an
issue closure, merge/deployment claim or waiver.
