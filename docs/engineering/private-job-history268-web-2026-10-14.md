# ORIGINAL268 completed private jobs webpage — 2026-10-14

NEXT cohort, source only. **All new DOM fixtures and browser/type/build/HTTP
checks remain UNRUN.** This increment belongs to the existing owned ORIGINAL268
outcome and its focused PR, rather than a separate contract or issue. Delivered64,
production, financial authority and private holds are unchanged by this author.
HEAD is `ae298ff41c239b292a043b3442df33f1701a4b99`. The observed local
`origin/main` ref at final readback is `866acfa7ef3e95774321fc53576cfa08fe1cf2f6`;
this author performed no Git writer or ref refresh.

The existing ROOT allocation grants exactly these four new files and one existing
widget link. ROOT retains review, validation, PR/CI and delivery ownership. No
additional owner, board, validation framework, release, version or schedule was
created. Canonical/local AGENTS and override, current origin-main coordination
and development workflows, the pilot common rules, applicable local planning/
review skills and gateway-spend/demo-critical/verified-invariants references were
present and read. Installed Next's server/client and metadata guides were read.

## Observable source behavior

[`/me/private-jobs`](../../app/me/private-jobs/page.tsx) has constant private
noindex/nofollow and no-referrer metadata. Its server shell receives no private
wallet, question, rows or result. The client initially renders only sign-in
checking text, including during server prerender; data reads start after mount.
One non-prefetched Link in the existing
[`ResearchPrivateJobs`](../../components/keryx/research-private-jobs.tsx) makes the
page discoverable. The complete old widget jobs/payment/result implementation
and its `/history` and `/result` contracts remain intact.

[`PrivateJobHistoryWorkspace`](../../components/keryx/private-job-history-workspace.tsx)
uses the existing `useSiweAuth` session as its sole owner authority. A connector,
body, expected-wallet header, cursor or ID does not authenticate. Connector
changes can only invalidate the view; a different connector wallet cannot select
another payer. New hook session object identity remounts the private child even
for the same address. Every exposed auth-state change also resets it. Capture
listeners for `keryx:auth` and focus and the existing cross-tab auth channel abort
pending IO and clear the child before permitting a fresh verified hook session.
If refresh leaves the old object unchanged, the view stays cleared until a manual
sign-in check succeeds. Logout and unmount abort the lifetime controller.
Per-action cancellation, action versions, lifetime/current-session checks and
list-effect cleanup suppress old responses, including abort-ignoring transports
and a closed detail arriving after a newer detail. No auth hook is changed.

The only history requests are fixed same-origin POSTs:

| Path | Body |
| --- | --- |
| `/api/me/private-jobs` | Existing shared strict filters, limit and optional cursor |
| `/api/me/private-jobs/detail` | Existing shared strict `{id}` |
| `/api/me/private-jobs/export` | Applied shared strict filters plus `format:"json"` |

Requests use `credentials:"same-origin"`, `cache:"no-store"`,
`redirect:"error"`, `referrerPolicy:"no-referrer"`, JSON content type and only the
existing expected-wallet precondition. No bearer/key, caller wallet body,
query selector, localStorage, private record href or public permalink is created.
The three API mounts, their helper/factory and schemas remain frozen.

Decoded response streams are bounded before fatal UTF-8 decoding and JSON/schema
parsing: 1,500,000 bytes for list/detail and 2 MiB for export, with the existing
15-second read and 25-second export limits. Declared oversized length and wrong
MIME refuse as well. Both transport and stream reads race cancellation; checks
after IO/parsing prevent stale publication. Request JSON is bounded at 8 KiB.
Actual shared page/detail/export schemas check format, scope, capabilities,
qualification, row wallets and NULL money. The top-level wallet must match the
current verified session. Additional checks enforce unique/decreasing list
positions, applied literal/surface/network/date filters, valid body cursors,
scan/row counts, export page counts and exact selected-detail identity. Detail
allows its actual null list timestamp but must match every other selected row
field. Corrupt, foreign or mismatched data clears the workspace and refuses.

The UI retains one page of at most 25 completed rows, with explicit scanned-intent
count, bounded-scan/continuation/exhaustion wording, manual next/previous navigation
and a 20-page cursor trail. It never accumulates unbounded rows. A valid empty
continuing scan says that more intents remain; a valid exhausted current-store
scan does not claim all archives or a transaction snapshot. Unsupported or
unavailable storage returning 503 is an error, not successful empty history.
401/403/409 wipe all private state and require a fresh sign-in check; 404 explains
missing detail; other errors remain unavailable. There is no automatic data retry,
polling or schedule. Refresh and applying filters are manual actions.

Rows show exact recorded network and surface, with absent legacy provenance/model
labelled UNKNOWN. Settled incoming original price uses the recorded integer
micro-USDC amount and evidence source; independently verified chain finality is
explicitly absent. Own settled source spend, creator rewards and paid creators
remain unavailable (NULL). No creator receipt, creator ledger, finality,
linked-wallet inheritance or payment authority is inferred.

Detail displays only the bounded safe result projection as React-escaped plain
text: answer, claims, recorded decisions/citations and optional saved evidence/
coverage. Stored URLs and markup are text, never links or HTML. BUY in a historical
decision is a label, not an action. Offer price and recorded reward attribution
are explicitly distinct from settled own spend and creator settlement. Opening
detail causes no search, source fetch, synthesis, model call or paid operation.

Manual JSON/CSV downloads both request the existing private export endpoint's
schema-bearing JSON format, so the exact wallet/schema can be checked before any
download. CSV is serialized locally from that validated metadata, with quoted
cells, formula-prefix protection, qualification/bounds/continuation metadata and
blank unavailable money. This deliberately avoids downloading an opaque CSV
response that cannot supply the complete shared JSON envelope schema. Neither
download contains private result bodies or authorizations. Output is rechecked
against 2 MiB. A detached temporary Blob download anchor uses a generic filename,
is never mounted as a share link and is immediately revoked. Truncation is explicit;
even a complete bounded current-store scan excludes archives and linked wallets.

## Authored fixtures and parent acceptance

[`private-job-history-workspace.test.ts`](../../lib/history/private-job-history-workspace.test.ts)
uses jsdom/React DOM and the actual workspace/shared schemas, controlling only
synthetic hook auth and HTTP. Its `.test.ts` path already matches
`lib/**/*.test.ts` in the existing CI glob; no runner/config edit is needed.
Fixtures cover no private SSR/checking/signed-out DOM, fixed body-only requests,
NULL economics and recorded provenance, 401/403/409/503 and missing detail,
malformed schema/foreign wallet/unsupported capabilities/money, bounded paging and
empty continuation, filter/export query binding, decoded multi-byte/declared byte
overflow, malformed UTF-8/JSON/MIME, hung transport/stream deadlines, same-wallet
session replacement/relogin/focus/auth/cross-tab invalidation, connector/auth-state
change, logout/unmount, late list/detail/export, close/reopen races, escaped private
content and bounded formula-safe JSON/CSV download cleanup. These are synthetic
auth/HTTP failure fixtures, **not real store, signature, payment or delivery proof**.

Two concrete parent framework gates remain:

1. `next.config.ts` currently gives the three API paths `runClaimPrivateHeaders`,
   but its map excludes `/me/private-jobs`. Parent must add exactly
   `"/me/private-jobs",` to that existing map after the global rule, retaining
   the existing `runClaimPrivateHeaders` values (no-store, no-referrer,
   noindex/nofollow). This author did not edit config. Metadata alone cannot prove
   the final HTTP header, especially because the global configured Referrer-Policy
   can override another value. Verify ordinary Next page/RSC and API HTTP, preserving
   global CSP and existing credential Vary behavior.
2. The frozen shared schema's value import of
   `privateHistoryCursorSchema` reaches `lib/db/private-research-intents.ts` →
   `lib/db/supabase-authority.ts` → `lib/db/storage-identity.ts`, which imports
   `node:crypto` and initializes hash constants. The new browser value import
   exposes this dependency graph. No browser bundle/compiler was executed, so
   successful tree-shaking or browser compatibility is **not established**.
   Parent must resolve this with its focused actual browser/Next build check.
   If that graph is retained, a separately scoped parent source correction must
   isolate the shared cursor/response schemas from server storage imports while
   preserving the exact accepted contracts. Do not bypass it with a divergent
   browser contract, node polyfill, config fallback or simulated build success.

ROOT next action is different focused review, new DOM fixtures and focused types,
actual Next HTTP/browser/build checks and the coherent SAME-outcome focused PR's
required aggregate/domain/platform CI. Reuse valid unchanged old-reader acceptance;
do not rerun old-source inventories/reviews without a changed input. Parent is
completing the independent old mounted P2 byte proof missed by
`OSCreateProcessAsUserW5`; this author did not retry that command.
Actual admitted-store/rollout and original API/MCP/CLI/Desktop/extension/bot/A2A
same-contract delivery criteria, account/multiwallet authority, privacy mutations,
creator-ledger/receipt acceptance and original268 closure remain **OPEN**. No
delivery, issue closure, production activation or synchronized surface claim is made.

## Exact forward, whole inverse and unchanged bytes

Only four additions and the one widget link belong to this increment. The files
are the complete forward payload, without overlays. Before, the four new paths
were absent; after, the three code pins are:

| Path | After raw bytes | SHA-256 |
| --- | ---: | --- |
| `app/me/private-jobs/page.tsx` | 871 | `2fee5bb8ad90f0a6a9243f16fae6bc3b575af593f547699fc554f3181298d6af` |
| `components/keryx/private-job-history-workspace.tsx` | 26609 | `ad79358eb563b8e2ec2034848eaac9e7e665e34206537c3924d5d108ac7c4b9b` |
| `lib/history/private-job-history-workspace.test.ts` | 28671 | `043e19cf16e60aa17e7473b4680b036b65cedabb1229bd3cc2eafbc24e1dbce9` |
| This new WebDOC | Final external receipt | Final external receipt |

The old widget was **7995 bytes**, SHA-256
`f0b778058e0769b606c848534d483d77d16a8a60ef05e4aefcdc17eed7771536`.
It is now **8139 bytes**, SHA-256
`ce5ccc99d773995a7b13a7f0420c729d81ed4d83f1b4137f7a904cc1f1b1bddb`.
Its exact forward addition, occurring once after the capacity notice, is:

```tsx
    <Link href="/me/private-jobs" prefetch={false} className="mt-3 inline-block text-sm underline">Completed private jobs and downloads</Link>
```

Read-only Git diff shows only that single added line. Removing that exact line
and its newline **in memory** reconstructs the full original 7995 bytes and its
whole-file before SHA-256, proving old widget logic and raw line endings are
unchanged. No inverse was executed. The complete inverse is removing exactly
that line and restoring absence of the four new files above. Preserve every
prior API/helper/config/document addition and every other path.

All 29 protected old pins in the prior handoff still match their full hashes.
The old completion document remains exactly **36523 bytes**, SHA-256
`22c844398350169a5656e16606789882049099c3fcaa84f3aeafcccf153e80c5`.
The existing config remains 7006 bytes at
`9097d6be4c622a06542968133dc7e00163b407cb7c252c3e6ae9eab6ed215399`;
the mounted helper, fixture and three routes retain their R75/R72 pins. Frozen
auth hook/profile-view inputs remain `54cb0516f874f715d4a2ad843dbd796ae8aa6ce22dc4e01509cf340082662b4d`
and `8d501421bb372a72785fb0306aca818767e016b7951d9d8d3f9811369c5bde4e`.
The assigned external output records full pins and this new document's nonrecursive
self pin. No API/core/DB/auth/hooks/oldDOC/next.config/catalogue/header source was
edited by this author. No tests/compiler/app/module/build/DB/DDL/provider/target/
ENV/key/model/search/payment/Git writer/native-denial retry/activation/schedules/
merge/version/deploy/closure occurred. Default auth/model/tier/effort/native policy,
spending limits, custody, all private holds and App54 authority remain unchanged.


## R81 narrow integration repair — source only, 2026-10-14

This append supersedes the R79 frozen-hook/config and unresolved-source-graph
statements above for exactly this repair. ROOT remains the SAME owned268 outcome
owner. R80's whole source review and R79 handoff/pins were read; both previous
workers had ended with exit 0/null signal/full EOF. The existing ROOT assignment
owns only the hook, workspace/fence fixture, identifier/schema import partitions,
new browser-contract fixture, one config entry and this WebDOC append. No other
worktree or old document was changed.

The real header and workspace each mount an independent `useSiweAuth`. Logout
now publishes an ordered shared privacy boundary synchronously BEFORE signout IO.
Every mounted hook clears its session and advances its local revision; old initial
and explicit session lookups additionally check the shared boundary before using
HTTP/JSON results. Pending logout blocks fresh session lookup/sign-in. End events
clear again without automatically refreshing. Failure retains the exact truthful
“Sign-out could not be confirmed. Please retry.” error and cleared private state;
only a newly verified session response or the existing fresh verification authority
can restore sign-in after all pending logout attempts end. Old sign-in continuations
cannot restore a session across the boundary. Unmount also fences late lookups.

Per-tab sequence snapshots retain concurrent pending attempts and ignore duplicate
or late channel start/end messages. The hook relays each accepted channel boundary
to synchronous local listeners. The workspace ignores raw logout snapshots on its
own channel, avoiding duplicate/late invalidation; its existing capture listener
aborts private transport, body and action generations. Initiation is not confirmed
signed-out. Only a successful HTTP + JSON acknowledgement emits the existing local
`signed-out` notification, including for existing custody-lock listeners; confirmed
remote notifications are relayed only after ordered acceptance. The existing
15-second logout abort signal, nonce/SIWE/signature/verify/server authority, account
and Circle wallet signing and all financial callers remain intact. No server auth
route or WalletMenu was edited.

The EXACT existing `privateResearchIdSchema` and `privateHistoryCursorSchema`
definitions now reside in `lib/a2a/private-research-identifiers.ts`, whose only
import is zod. The old intent and DB modules import/re-export those same instances;
the existing DB cursor type alias remains intact. The shared contract changes only
its cursor import. Regex, datetime offset option, strict shape, schema identity,
DB/SQL/query/authorization/result bodies and old reader behavior are unchanged by
this extraction. The browser contract no longer imports the server cursor module.
Actual Next browser/build acceptance remains OPEN; no tree-shaking success is
inferred from this source correction.

The sole config repair is adding exactly `"/me/private-jobs", ` to the existing
`runClaimPrivateHeaders` source map. Removing that token in memory reconstructs
the complete preceding 7006-byte config and its R79 raw SHA-256. API namespace,
private-header helper, CSP, Vary, caching/security predicates and all other config
bytes are preserved. Actual page/RSC/API HTTP header acceptance remains OPEN.

The workspace fixture adds **11 UNRUN real-hook cases** after the existing broad
synthetic suite. Auth and Link are explicitly unmocked; header actor and workspace
mount TWO real independent hook instances with synthetic wagmi/HTTP inputs and
native event/channel delivery. Download APIs are observed to assert no action.
Cases release previously valid deferred list/detail/export transport or bodies
while signout JSON acknowledgement is pending or failing, assert synchronous
private abort before signout fetch, retain truthful unconfirmed errors, reject
both hooks' old initial/refresh session bodies, retry, obtain a genuinely fresh
session, handle concurrent/out-of-order/duplicate channel notifications and unmount
with private/auth IO outstanding. Only actual confirmed acknowledgement may emit
`signed-out`. Existing broad mocked-auth cases are not this real-hook proof.

The new browser-contract fixture has **3 UNRUN cases** for exact schema instance
identity, compatible re-export source bindings, original-validator input behavior,
offset/UTC distinctions, strict keys and cursor bounds. A failing server-module
mock guards its contract import; narrow reads check only the pure module's import
and the exact adjacent compatibility bindings. It opens no database and adds no
source walker or framework. These synthetic fixtures are authored source, not
execution, real session/store/signature/payment or delivery evidence.

ROOT next action: different focused security review of these changed partitions,
then FIRST focused execution of the affected/new auth/workspace/browser-contract
fixtures and types; actual Next browser/build and page/RSC/API HTTP checks;
coherent SAME-outcome focused PR with required aggregate and applicable CI. Reuse
unchanged-source/input evidence. The preceding mounted-P2 byte gate remains
parent-owned. Original268, rollout, actual store and the previously recorded
multi-surface/account/creator/privacy gates remain OPEN.

### R81 exact forward and WHOLE byte inverse

Forward is seven scoped modifications plus exactly two new source files and this
append. The workspace fixture changes only its Vitest `describe` import and adds
the real-hook suite; prior broad case bodies are unchanged. Schema extraction
changes only the two imports/re-exports/declarations and the contract import.

The own external `worker-repairPrivate268RealIntegration/source-pins.json` receipt
records each captured before raw pin, after raw/Git pin and exact minimal UTF-8
byte edits. Its edits reconstruct the complete after bytes forward and complete
before bytes in inverse, including original CRLF/LF. These comparisons were done
in memory only; no inverse was written. Whole inverse: apply those byte edits
backwards in descending after-byte offset, restore absence of exactly the pure
identifier module and new browser-contract fixture, and remove exactly this
append after the original **13002-byte** WebDOC. Preserve ALL prior R79/R75/R72
and older outcome changes. The document's nonrecursive final pin is external.

| Path | After raw bytes | Raw SHA-256 | Git blob SHA-1 |
| --- | ---: | --- | --- |
| `lib/hooks/use-siwe-auth.ts` | 10957 | `023da90006fc5b831a66311178c081e2151acd48c0b46999657afc9d9b6ffcea` | `9f816a6278096f894d034ab55364e152c4d1e798` |
| `components/keryx/private-job-history-workspace.tsx` | 26832 | `e92f2f394b8c885203e1e7b8eb03fb49dce123f633b2bc0fae396298cae75e45` | `dbcafc7f2f7273a72079150a20fbae76f59c8fc9` |
| `lib/history/private-job-history-workspace.test.ts` | 40883 | `5ca58cc2022e6b42e9c9090932c52fbc7cec45bfab33ec4bc07be8ce4e859075` | `267026b1a67db728c7e4647deab8c87205206adf` |
| `lib/a2a/private-research-identifiers.ts` | 249 | `f4f5b347c1520c3d41c7f5e05cfa09805a43a20d16e2f4b48a56d4ce9cd0fa00` | `058c702d42859b0c97cac49d783e80e59ae2c38b` |
| `lib/a2a/private-research-intent.ts` | 3106 | `6b5cece1d5081bcf0d569f30af56260d0f0793db2e31e587b48595a53d13db69` | `7fdd86e2dfad35086ff672db1d66968cb4644fe9` |
| `lib/db/private-research-intents.ts` | 6903 | `3b439b50b2e52ceb4c38cadd68d2d9637be681ead4f15232e32318fe84a9fb23` | `e16432cc1809a529eab14406b16933e0959672e7` |
| `lib/history/private-job-history-contract.ts` | 8996 | `a1c05f87fb2b83f3b811e19bbf2e5a3e98ea227b81706119fa40ae047a498117` | `45b67837f682836a98b61420c79a06b0fe39a8b5` |
| `lib/history/private-job-history-browser-contract.test.ts` | 3909 | `ed6ef3d65e8c15063623bc6e4ad5fa648c0eaaf31fb03187ffd68e1d16b24d71` | `3d6ab3cc3e7a9c84f16f369b51f47fa03e43b514` |
| `next.config.ts` | 7026 | `490d6102b83086878b714292e51be864ceb8fc937f2c73fb6a2d3c2888568c92` | `c4e34f51c389a451e59e252fd85350cf58e02326` |

Raw `git hash-object --no-filters` differs only for these existing CRLF files:

- `lib/hooks/use-siwe-auth.ts`: `2b741406b1bce1042b2e4908c8b658eaf82f10a3`
- `lib/a2a/private-research-intent.ts`: `cd15cd7feb321ba69c39564d2e8519f5fb7ab201`
- `lib/db/private-research-intents.ts`: `358bb8dec94b44f14bd70e8f943138eb823a66b7`
- `next.config.ts`: `8fb5832590b723a2090a27505c25244812156e62`

All **34** unaffected protected/frozen R79 receipt pins matched in one final
read-only byte comparison; the page and widget also retain their R79 pins. The
old completionDOC remains **36523 bytes** / SHA-256
`22c844398350169a5656e16606789882049099c3fcaa84f3aeafcccf153e80c5`.
Run-provenance, bounded-copy, all API/helper/readers, page/widget link and every
other old body remain frozen outside the expressly allowed schema/hook/config
partitions. These are byte-preservation facts, not old-source behavior acceptance.

No test/compiler/app/module/build/producer/DB/DDL/provider/target/ENV/credential/
model/search/payment/Git writer/native-denial retry/activation/schedule/merge/
version/deploy/closure was performed. Delivered64/main/production, default ChatGPT
auth/model/tier/effort, native policy, custody, spending limits and private holds
are unchanged by this author.


## R85 R83 initiating-unmount and abandoned-peer repair — 2026-10-14

Auth source repair is limited to lib/hooks/use-siwe-auth.ts. Each signout attempt
now owns a short-lived BroadcastChannel through HTTP/JSON completion, closes it
after publishing its ordered terminal snapshot, and survives initiating hook
cleanup. The hook's receive/sign-in channel keeps its existing component cleanup.

A receiver owns a 20-second pending lease (the existing 15-second fetch deadline
plus delivery slack), renewed only by an accepted newer per-source snapshot.
A missing terminal expires to pending:false/confirmed:false, advances the privacy
epoch, clears sessions and retains the sequence tombstone. Other pending sources
continue to block. Duplicate/old starts cannot revive an expired pending entry.
Neither expiry nor terminal delivery restores a session or starts private IO.
An anonymous channel "changed" hint clears state without automatic lookup.
Focus/manual action needs new server session authority; null/unavailable auth
keeps private data refused. Local active attempt counting, synchronous initiation
and private abort, HTTP-success plus JSON ok:true confirmation, signing boundaries,
15-second fetch deadline and monotonic sequences remain in place. A channel
source identifier is ordering metadata, never ownership/authentication evidence.

The existing workspace fixture adds **6 UNRUN cases** using separately imported
actual auth modules (separate pending maps/epochs), actual workspace hooks and
native BroadcastChannel delivery. The initiator and surviving receiver have
separate React roots, but share jsdom's window: these are independent module
lifetime fixtures, not browser-realm or actual WalletMenu acceptance.

- Confirmed and failed delayed JSON ACK after only initiating hook unmount:
  receiver remains pending until its native terminal arrives; old session JSON
  and abort-ignoring export body cannot paint/download; no automatic lookup;
  a null fresh session refuses, then fresh verified HTTP reopens private history.
- Two abandoned sources expire separately, retain the concurrent pending fence
  until both end, emit no confirmed logout, reject old/duplicate sequence replay
  after fresh recovery, and refuse automatic private IO from a channel hint.
- Delayed nonce/signature/verify completion remains stale after peer expiry;
  none resumes signing/verify/session/private delivery beyond its old epoch.
  Only a new server-verified session permits recovery.

All preceding assertions remain byte-identical after removing this added suite.
The prior 11 actual-hook cases and 3 browser-contract cases are still UNRUN;
together with these 6, **20 new cases remain UNRUN**. Signing/HTTP responses here
are controlled fixtures, not real session/signature/store/payment evidence.

Only this hook, the existing workspace fixture and this WebDOC append changed.
All other R81 extraction/workspace/config pins and ALL R82 client/CLI/MCP inputs
are retained. External worker-repairPrivate268LogoutTerminalLifetime/source-pins.json
records before/after raw bytes, SHA-256 and raw/LF Git blobs, minimal byte edits
and whole in-memory inverse reconstruction. Inverse removes exactly this append
after the previous 22247 bytes, removes the new fixture suite and restores the
10957-byte R81 hook. No inverse is written; older output receipts are retained.

ROOT next actions remain a different focused source/security review, FIRST
affected/new auth/DOM/browser-contract/type checks (including all 20 UNRUN cases),
current Next browser/build and private page/RSC/API HTTP-header verification,
then the SAME focused outcome PR with actual aggregate/applicable required CI.
The prior mounted-P2 byte proof and original268 whole-history, both-store bounded
pagination/filter, every-surface ownership, several-wallet/revoked-key/claimed-run,
account/creator/privacy and rollout acceptance remain parent-owned and OPEN.

No test/compiler/app/module/build/producer/DB/DDL/provider/target/ENV/financial
execution or Git writer, policy/auth/runner workaround, activation/version/deploy
or closure was performed. Original268 stays OPEN; published 0.4.20 does not yet
contain the new tools. Delivered64, production and main were not changed here.

## R88 minimum R86 P2 local-source ownership repair — 2026-10-14

The local logout counter and publisher sequence now stay separate from peer
ordering snapshots. Inbound notices claiming this document's advertised UUID
are ignored, including after local completion. Neither pending value nor a high
sequence can replace an owned attempt, bypass its pending fence, or reject its
real terminal ACK. Local publication advances the privacy epoch directly.

Peer pending starts one 20-second receiver lease at its first observed start.
Higher pending sequences update ordering without restarting that timer; expiry
uses the latest sequence and retains an exhausted lease/tombstone. Further
pending sequences remain nonpending until a terminal hint ends that interval.
An accepted later start after a terminal hint has its own finite lease. Peer
source/sequence values remain ordering metadata; all inbound confirmation claims
are reduced to unconfirmed invalidation. Only a local successful HTTP response
with JSON ok:true publishes confirmed logout. No channel notice restores auth,
confirms custody, signs, or starts a session/private lookup.

The workspace fixture adds **3 UNRUN cases**: both pending claims learn the
actual local source from native channel publication, forge MAX_SAFE_INTEGER and
confirmed:true, close the peer, preserve the local pending fence and stale
session/export refusal, then accept the real sequence-2 ACK and recover only
through fresh server HTTP. The independent receiving-module case sends increasing
sequences, closes the sender at t=19999ms, asserts pending at 19999 and idle at
20000, refuses higher pending/confirmation claims after expiry, fences old
bodies, and requires fresh session authority before private recovery. These
share jsdom's window and are not separate browser realms or WalletMenu evidence.
The preceding **20** new auth/DOM/browser-contract cases remain UNRUN; **23**
new cases in total have no execution/pass claim here.

Only the hook, workspace fixture additions and this WebDOC append were edited.
The attempt-owned unmount channel, 15-second IO deadline, HTTP/JSON confirmation,
stale private body/export/signing fences and fresh verified recovery remain.
R87 profile work in its separate worktree, concurrent MCP work and parent's
23-argv/discovery corrections are preserved. R88 source-pins.json/minimal.patch
in worker-repairPrivate268LocalSourceOwnership bind raw pins and whole in-memory
inverse reconstruction to the exact pre-repair R85 files; old receipts remain.

Parent next action: different focused review of this delta, FIRST real auth/DOM
workspace and types, then browser-contract and current Next browser/build,
independent two-tab/unmount/abandonment and private page/RSC/API HTTP-header
acceptance, and the coherent focused PR with successful required aggregate/domain
CI. Original268 remains OPEN with its broader existing acceptance gates. No
tests/compiler/modules/app/build/producer/DB/DDL/provider/target/ENV/auth/spend,
Git writers, native-denial retry, activation, version, main or production AE64
mutation was performed by this repair author.

## R91 R90 P2 exhausted-interval recovery repair — 2026-10-14

Further higher pending notices of the same exhausted 20000ms interval now update
only its normalized nonpending sequence tombstone. They return before advancing
the privacy epoch or dispatching an auth event, so they cannot change a hook
revision, clear verified auth or abort newly verified private IO. An accepted
terminal still advances the boundary and ends that interval; a later accepted
pending start receives a new finite lease. Older terminal/start notices remain
rejected by sequence. Expiry itself still invalidates old in-flight bodies.

The R88 fixture's post-expiry inputs preceded fresh recovery and missed R90's
held fresh session and post-recovery invalidation path. This repair adds **1
UNRUN actual-channel regression**, bringing the total new cases to **24 UNRUN**.
After first-start expiry it refuses old session/export bodies, starts genuine
fresh session HTTP with held successful JSON, delivers a higher pending notice
while that JSON is held, and requires its verified session to publish and start
new private IO. Another higher pending/confirmed claim arrives while the fresh
private body is held; that body must publish. Four higher pending notices after
actual private recovery must retain the exact verified session and private DOM
without new IO. An older terminal is refused; an accepted terminal and new
interval still clear/fence private state. The fixture uses actual independent
hook modules and native channel delivery with controlled HTTP/wagmi in shared
jsdom, and supplies no separate-browser, WalletMenu or runtime acceptance.

R86 local counter/publisher ownership, inbound local-UUID rejection, attempted
logout's unmount-surviving channel, 15000ms deadline, successful HTTP plus JSON
ok:true confirmation, and stale body/export/signing fences are unchanged. No
peer confirmation supplies authentication or custody authority. R88's captured
Rust allocation failure (2097152 bytes, exit 3221226505, final missing) remains
retained as an abnormal unfinished lifecycle; no CLI or checks were retried.

Only the same three claimed paths were edited. R91 source-pins.json and
minimal.patch in worker-repairPrivate268ExhaustedPeerEpoch bind the R90-verified
raw before files, current files and complete in-memory inverse/forward
reconstruction. No inverse source file was written. All tests remain UNRUN.

Parent next: focused different source review, FIRST changed auth/DOM workspace
and types, then browser-contract/current browser/build and genuine two-tab
unmount/abandonment acceptance, current private page/RSC/API HTTP headers and
required aggregate/domain CI for the coherent focused PR. ROOT owns merge and
one batched delivery. Original268 stays OPEN. Parent MCP/client/CLI/discovery,
shared native bundle/MAX4/schema/inventory/migration, main, versions, production
AE64, private holds, custody, payTo, caps and App54 were not changed here.

## R99 independent ORIGINAL268 two-tab browser control - 2026-10-14

New source: [`test-private-job-history-workspace-browser.mts`](../../scripts/test-private-job-history-workspace-browser.mts).
**All four new browser scenarios, bundling, browser startup and the parent command
below are UNRUN.** This author performed source authoring/readback and raw-byte
capture only. Parent's existing actual294 focused cases/types are separate; this
control neither replaces, reruns, edits nor re-reviews them. No runtime, server,
auth hook, contract, SDK/MCP, existing fixture, config or old browser script changed.

The old `test-browser-private-history.mts` bundles `ResearchPrivateJobs`, stubs
`useSiweAuth`, and uses old `/history` and `/result` endpoints. It supplies no
acceptance of this new workspace, actual hook or independent browser realms.
The new control bundles the actual `PrivateJobHistoryWorkspace`, `useSiweAuth`,
shared schemas and Next Link. Only wallet/connector/provider import boundaries
are shimmed; signing/SIWE entry points throw. Each scenario creates two independent
Chromium pages in one context, sharing a loopback origin and native BroadcastChannel.
Auth object/state changes flow through actual hook requests and synthetic HTTP
session responses. Connector connection alone must produce zero private reads.
There is no public/global authenticated flag, hook stub or runtime timer replacement.

The synthetic server accepts only GET `/`, GET `/fixture.js`, GET
`/api/auth/session`, and POST `/api/auth/signout`, `/api/me/private-jobs`, and
`/api/me/private-jobs/detail`. Both browser transport and context routing deny
all other URLs/methods, including queries, nonce/verify, provider/RPC, models,
research, payment and export. POST origin must match the owned loopback origin.
Private JSON bodies remain exactly `{limit:25}` and `{id}` with the existing
expected-wallet precondition, same-origin credentials, no-store, no redirects and
no-referrer. Private response Vary remains
`Cookie, Authorization, X-Keryx-Expected-Wallet`; auth responses retain no-store
and the actual null-session 401/successful JSON `ok:true` shape. Server requests
are capped at 256, per-page requests at 128, request JSON at 8192 bytes and fixture
list/detail bytes below the unchanged 1,500,000-byte cap. This checks control
transport shape, not compiled/current production header delivery.

| UNRUN scenario | Observable assertions |
| --- | --- |
| Normal ACK and two-tab stale fences | Both pages first retain the actual rendered completed owner result and escaped body. Logout initiation clears both, aborts local private IO before signout HTTP, and cancels the peer's pending body reader while JSON ACK is held. Late private transport/body and old real-hook session responses cannot repaint. Replayed source/sequence cannot end the owned interval. Only local successful JSON ACK emits confirmed signed-out; peer terminal is unconfirmed. Normal ACK has no observed timeout cancellation through completion. |
| Local workspace unmount | Its held detail attempt aborts; the peer attempt is still un-aborted before response completion. No peer auth event occurs. Peer detail can publish, late local detail cannot remount, and remount uses a new actual hook lookup/request. |
| Actual 15-second logout cancellation | The original AbortSignal timeout is observed, the exact unconfirmed error is displayed, and an unconfirmed terminal ends pending without restoration. Releasing the late ACK records discard, never confirmed signout. Old detail/session completions cannot revive the terminal. |
| Vanished publisher and real 20-second receiver lease | An actual pending publisher tab closes naturally. Three finite storms send 24 higher pending/confirmation claims at 5/10/18 seconds. The actual receiver expiry event must carry sequence 25, pending:false/confirmed:false at its first-start bound, with no automatic session/private lookup. Late old detail/session and unrelated confirmation cannot restore auth. A null fresh check still refuses. Two deliberately fresh real-hook HTTP session responses and a new private request establish a fresh epoch despite higher exhausted notices. Old terminal/exhausted pending cannot clear or restart it. An accepted terminal clears/cancels; only a terminal-ended new interval can become pending, and subsequent recovery again requires fresh HTTP. |

Timing evidence uses actual abort and auth expiry events measured with browser
performance.now. Observation timeouts do not change the runtime's 15000/20000ms
limits. Upper timing assertions allow only 2 seconds of host scheduling slack;
there is no fake clock, deadline inflation or fixed sleep used as proof. The
5/10/18-second timers are finite adversarial stimuli, not acceptance assertions.
Mutation observation plus completed render frames detect private repaints after
stale release. Successful private reads' normal finally-abort is deliberately
excluded from the pre-response cancellation assertions.

### Parent executable command and owned resources (UNRUN)

After different focused source review, parent reserves a fresh output directory,
existing compatible read-only dependencies and installed Chromium, and either an
OS-assigned `127.0.0.1:0` listener or one explicitly reserved nonprivileged port.
No dependency install/browser download, shared cache, database, .next output,
production app or environment file is required. Keep existing browser binaries
as immutable inputs; do not point a browser installer at this control's output.
Prepare the following output/temp/cache directories and process environment in
the parent-owned execution context only, then execute from this worktree:

```powershell
$browser268Output = 'D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-99/worker-completePrivateHistoryTwoTabBrowser/browser-control-parent-first'
# Parent creates this fresh directory and its temp/tsx-cache children beforehand.
$env:TEMP = Join-Path $browser268Output 'temp'
$env:TMP = $env:TEMP
$env:TSX_CACHE_DIR = Join-Path $browser268Output 'tsx-cache'
node --import tsx scripts/test-private-job-history-workspace-browser.mts --output="$browser268Output" --port=0
```

`run/` is created exclusively; an existing run refuses overwrite. The bundle is
in-memory and bounded to 3 MiB. Build observation is bounded at 20 seconds,
Chromium launch at 15 seconds, the four-scenario sequence at 95 seconds and each
owned cleanup at 8 seconds. Tabs/React roots/channels, browser/context, esbuild
service and HTTP listener close through their ownership APIs; no kill, destroy,
unref or forced connection cleanup is authored. Parent captures stdout/stderr
and actual natural exit/EOF; require exit 0 and the final cleanup-completed line.
An interrupted/failed run or surviving process is not a pass. Do not retry a
native denial or change policy/auth/model/tier/effort to obtain execution.

On successful execution, `run/synthetic-evidence.json` records synthetic scope,
measured lease/abort timings, actual browser/tool versions, finite HTTP requests,
actual bundle inputs and unchanged-before/after raw source pins. It contains no
live private output or settlement. This author created no execution result.

### R99 exact source capture and remaining gates

Own external capture is under
`worker-completePrivateHistoryTwoTabBrowser/source-capture` in ROOT's existing
`refill-successors-20261013-99` output. `source-pins.json`, `minimal.patch`,
`inverse.patch`, whole raw before/after images and `source-handoff.md` bind this
new file plus this additive doc tail. The doc's complete preceding **32588 bytes**
are preserved with SHA-256
`0b7374d0ab0242c2afb10d4e10d7bd043900fbdb69be27e159661411b673f301`.
Whole inverse restores that complete raw image and the new script's preceding
absence; forward restores the captured complete after images. No inverse source
edit was performed. Frozen input pins are compared read-only and captured outside
the document to avoid recursive receipt hashes.

Parent owns FIRST execution of this new browser control, different focused source
review, the remaining current compiled Next ordinary page/RSC/API HTTP-header
acceptance, and packed stdio/remote MCP cancellation/discovery gates. These remain
OPEN until actual corresponding evidence is recorded; bundled source-browser
synthetics do not establish those surfaces or live SIWE/store/payment acceptance.
Original268 whole-history/both-store bounded query, ownership and broader existing
account/creator/privacy/rollout gates retain their separate recorded status. Parent
owns the coherent PR and successful aggregate/applicable required CI; the sole
coordinator owns merge and one batched delivery. No runtime activation, production
change, version, Git writer, credentials, DB/DDL, provider/financial execution,
ENV mutation, spend, App54, policy workaround or issue closure occurred here.

## R106 first observed control failure - 2026-10-14

The first parent invocation actually failed before logout, while saved() waited
8000ms for the exact synthetic retained answer. It naturally exited 1 with a null
signal and separate stdout/stderr EOF after 13655ms. The normal-JSON scenario
never reached its logout assertions; **none of the four scenarios is accepted**.
The immutable original proof is in
output/resume-distribution63-audit-20261012/private268-first-two-tab-control-20261014/
(actual-result.json, first-two-tab-control.capture.json and raw stderr).
The later parent metadata deepEqual/undefined omission error is separate from
this already-captured child failure.

Source tracing of the finite fixture, guarded transport, actual workspace post/
detail checks and shared pure schemas found no statically proven fixture defect.
The synthetic row retains the exact owner, NULL own-spend/rewards/paid-creators,
schema fields and incoming-only evidence. Detail changes only intentCreatedAt
to NULL; the workspace excludes precisely that field from list/detail equality.
Request bodies, expected-wallet headers, private response headers and byte caps
match the workspace contract. This static trace does not establish why the
rendered answer was absent, or prove a runtime defect or a correct UI refusal.

Only the existing saved-answer wait now has a failure-only diagnostic. After that
same wait fails, one bounded read observes this synthetic workspace's DOM (16384
characters), at most eight role alerts (512 characters each), existing per-page
admitted request records (128) and transport guard messages (128, 512 characters
each). It also records at most 256 existing admitted loopback method/path pairs
and counts server guards, blocked requests and page errors. It writes exclusively
to the fresh owned run/saved-answer-failure.json. The observation/write has its
own 1000ms ceiling; a capture failure emits only a fixed synthetic notice.
**The original caught timeout object is rethrown in either case.** No HTTP replay,
new API request, refresh, click, response substitution or success assertion was
added. All DOM/transport values come from this guarded fixed synthetic fixture,
never live private data.

The original exact-answer, escaped/no-image and NULL metric assertions, owner
and row checks, four scenarios, native BroadcastChannel, 15000ms abort, 20000ms
lease, all existing deadlines, allowlists, byte caps and cleanup remain intact.
No runtime/auth/schema file changed. R102 source acceptance stays scoped to its
old pins; the failed execution does not become accepted by this source delta.
Parent's prior 294 focused cases/types keep only their unchanged-input scope.

Own raw before/after images, minimal/inverse patches and pins are retained under
output/resume-root-release63-20261012/refill-successors-20261013-106/worker-correctPrivateHistoryFirstControlFailure/source-capture/.
Parent next: different tiny-delta review, then **ONE changed-source observation**
with fresh owned output and unchanged execution constraints. Inspect the failure
diagnostic if it fails; do not blindly repeat the old source. All four genuine
scenario records and original natural cleanup/exit/EOF requirements still gate
source-browser acceptance. Current compiled Next, packed MCP, live authentication,
required coherent-PR CI and whole Original268 acceptance remain **OPEN**. Parent
owns checks/PR; the sole coordinator owns merge and batched delivery. This worker
ran no module, compiler, test, browser, build, DB, provider or Git writer.


### Observed browser control focus boundary correction

The first changed two-tab observation remained failed: focusing View saved result
cleared the workspace before a detail request. Its retained diagnostic has no
server guard, external-request or page errors. The capture-phase window focus
listener also received descendant control focus, while the auth hook refreshes
only a window focus event. The workspace now invalidates for focus events whose
target is the window, preserving real window/auth/channel boundaries. A genuine
DOM regression covers button/input focus, a pending detail request, window-focus
abort, late-body refusal and no stale-session reopening. Source review and this
new case/two-tab execution remain pending; no original issue closure is claimed.
