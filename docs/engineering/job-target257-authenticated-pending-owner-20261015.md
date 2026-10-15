# Atomic authenticated original ownership (#257)

Design updated before implementation on October 15, after ROOT explicitly added
the exact original producer to this source partition. The previous refusal-only
scaffold is superseded. Source implementation and failure tests are authored;
every runtime acceptance check is **UNRUN**.

## Authentication and threat plan

The API consent field is `X-Keryx-Account-Job: associate` on the signed POST to
`/api/agent/ask`. Obtain the ordinary unsigned payment challenge first. Association
requires same-origin POST, the actual signed keryx_session cookie, and no competing
Bearer actor. The server uses the existing configured HS256 verifier, issuer,
audience, JWT type, session TTL and durable web_sessions tuple. Neither candidates,
submitted claims/guards, payer, worker body nor an API key can mint ownership.
Anonymous payments keep their existing original/payment/recovery path.

The private WeakMap proof binds configured network, selected deployment/store
identity, the exact authorization-derived original ID and request hash to the
JWT's original hash/wallet/issuance/expiry. It expires within five minutes and
never after the JWT expiry. It cannot be obtained by presenting a hash selector
or an owner string. Framework/application composition is loaded only by the
route verifier; native storage consumers expose no mint callback or connection.

The route authenticates before financial admission. Its existing synchronous
beforeSettlement hook rechecks that exact durable session under native guards.
This does not hold a SQLite transaction across a provider call. Revocation during
settlement can therefore refuse order admission after a real inbound debit; the
existing retained-payment/recovery path remains authoritative. No paid retry or
replacement owner is manufactured to hide this residual boundary.

## Atomic producer and native port

`createA2aOrder` delegates to a private synchronous extraction of its existing
INSERT OR IGNORE, parameters and readback. `createOwnedA2aOrder` runs it without
await under BEGIN IMMEDIATE with fresh exact source/file/manifest/schema fences
and session tuple/time checks before insertion and commit. Only `created=true`
in this transaction inserts immutable metadata. Existing/replayed/unowned history
never receives a relation; original createdboolean, financial SQL, payment record,
execution/recovery, caps and 180/300-second clocks are preserved.

Readonly mutations refuse before native SQL. Only exact SQLite error 5/6 before
commit is temporary. Other acquired guards, SQL faults and uncertain COMMIT or
post-COMMIT acknowledgement retire the connection and never ACK. A forged or
expired proof is refused before a transaction. Admitted proofs are consumed;
fresh authentication is required for another attempt.

The optional native reader verifies a current actual signed-cookie proof, rechecks
its exact durable session, and filters retained owner/network/original bindings
in SQL before selecting bounded status/financial columns. It never selects worker
input, question, response, payer or authorization nonce. A bounded safe transaction
reference is retained; no raw payment receipt is read. A same-wallet replacement
session may observe retained metadata, while revoked current tokens and foreign
owners/payers cannot. This is no saved-run visibility, claim or financial grant.

The new immutable table belongs to the existing complete native user bundle;
the runtime profile family stays at four. No constructor installs it. An explicit
stopped-writer migration accepts only two exact archive/no-archive old/new pairs,
requires backup admission under an authorizer, and compares byte/type/rowid
snapshots of every original table before and after. Parent owns backup verification,
writer stop and serial composition with sibling domains. No migration was run.

## Mounted observation and review gates

The native `/api/me/jobs` owner projection returns only newly proven original
metadata, including terminal metadata without retrieving saved research text.
Legacy payer-only originals are not backfilled or relabeled as research owners.
Ordinary storage retains its existing payer history; `pending=owned` refuses
when the native port is unavailable. This role boundary needs parent product review.

The existing mounted ResearchJobEscalation includes AccountJobs polling for its
exact original. `pending=owned&id=...` carries NeedsReview for a recorded failure,
even within its original target, and always keeps missing recovery as unknown.
Uncertain creator payment remains unknown/payment-boundary evidence, not settled,
failed, refunded or held. Polling is page-local, aborts on unmount and executes no
financial or recovery command. It stops displaying stale ownership on refusal.

Parent serially composes the already accepted predeadline held-recovery/alert
increment; this source does not invent those facts. Independent payment/security
review, genuine native rollback/concurrency/guard/ack checks, mounted UI checks,
types/build/required CI and createdAt-based alert/customer timing remain required.
Web/API and the shared mounted account view are affected. CLI/MCP/bots retain
existing financial polling roles and gain no account credential inference.
Supabase/ordinary atomic owner admission is unsupported without its own producer.

Authored tests cover actual JWT signature tampering, pure candidate forgery,
original vs replayed admission, payer-not-owner, exact original/current-session
revocation, two genuine connections, native busy, rollback, readonly pre-SQL,
lost commit ACK, restored-input guard revocation, typed migration retention and
mounted Quick/Deep uncertain-payment customer state. All remain **UNRUN**.
No tests/compiler/application/DB/network/payment/provider/target/Git writer,
schema activation, spend, schedule, deployment or delivery was performed.


## 2026-10-15 — Original257 browser consent, predeadline metadata and bounded mounted observation

R143 found no source-level payment/security defect in R140's atomic original-owner admission. This successor preserves that transaction, original SQL, session-proof verifier, fixed schema/family and financial/recovery bodies. SOURCE CORRECTED; every authored control, type/build and CI remains UNRUN. Original #257 remains OPEN.

Optional account-history consent is separate from payment, wallet and custody consent and defaults false for each NEW purchase. The browser displays a freshly authenticated account and binds consent to the existing current durable session selector, issuance and expiry. Local auth, logout, BroadcastChannel and focus invalidate it before dispatch. Fresh bounded session reads precede preparation/signing/claim and dispatch; same-wallet session replacement refuses. The fixed browser-origin transport adds only the association header and same-origin cookie to the original signed POST, preserves body/signature bytes and rejects redirects/foreign destinations. Generic buyerFetch remains byte-identical with credentials omitted. Quotes, challenge, anonymous/CLI/MCP and recovery/import remain unchanged. Proof/headers/payer/wallet selectors cannot mint server ownership: the existing signed-cookie verifier and exact durable session check remain authoritative. Consent is consumed once. Any refusal after the journal claim keeps submission_uncertain, with no retry, new signature, replacement nonce or ownership replay.

Only reviewed R116/R121 predeadline source was reused, with exact before/source hashes in output/product-reuse-provenance.json. Shared customer/native-reader files were composed separately. The existing single observer lock, channel, scan/attempt bounds, original/network incident and reserve-before-send semantics remain. Failed originals and exact explicitly retained recovery facts can need review before original createdAt +180/300 seconds. The native reader accesses <=2048 bytes of the existing a2aWorker fact only after current cookie/session and immutable original owner joins. It matches exact original/query/worker/network/payee and strict acceptance <= start <= update <= hold <= observation; missing, oversized, malformed, superseded and foreign facts remain UNKNOWN. Worker metadata stays internal. The genuine producer is the existing scripts/a2a-research-worker.mts recovery_pending record, not a new authority. This implements the selected native owned metadata path; unsupported profiles/absent port and other unsaved privacy-only lanes retain their existing refusal/unknown boundary.

Actual ResearchJobDetails mounts cookie-authenticated metadata observation with its validated query ID as selector, preserving anonymous following and existing parent props. Account history passes existing status into the predeadline display. A separate 5000ms request deadline covers session/fetch/body reads; active reader cancellation and a cancellation race bound stalls, clear stale state and allow the next mounted read after the existing 2000ms delay. Cleanup/auth/focus invalidate late continuations and abort outstanding work. No new scheduler outside the mounted page or payment/recovery dispatch exists. Visible new English copy is in locales/en/pending-owner257.ts; the retained job-target catalogue and financial notices keep their authority.

Authored controls include actual POST with real unfunded EIP-712 signature verification, genuine signed cookies/durable rows, the real seller helper and native producer; only external vendor transport/readiness/framework selection are synthetic. They cover cookie owner distinct from payer, valid API-key/forged/payer-worker/foreign refusal, before/during-settlement revocation with retained debit/no retry, failed/held/unknown projections and an actual parent-mounted native-route bridge. Additional mounted controls cover both targets, invalid/missing/foreign references, stalled fetch/body recovery and late bodies after logout/same-wallet replacement/unmount. Browser client controls retain price, journal claim, request bytes, no-replay and uncertain-after-claim outcomes. All UNRUN; no real vendor payment or delivery is demonstrated.

Parent gates: distinct payment/source review; execute focused native/crypto/auth/mounted failure controls and all retained atomic rollback/replay/two-connection/readonly/exact 5-6/permanent-drift/uncertain-COMMIT controls; types and one applicable build/current canonical acceptance if inputs change; one focused PR, required aggregate/domain CI and sole-coordinator serialized merge/batched delivery. The unchanged older lib/a2a/pending-owner-session.test.ts uses the pre-successor loose packet/fetch fixture: parent must reconcile that fixture with the now bounded session/packet contract under its authority; it was outside this successor claim and remains whole. Current native family is 20; future >20 composition needs the parent263 finite compiled-inventory constructor bound, with max-four and Library partition preserved. Original latency/first-answer/remedy/paid/vendor/actual delivery acceptance remains open. No production, spend, schedule, App54, Git writer, compiler/check/DB/browser or repository module execution occurred here.


## 2026-10-15 — Current-main498 pending reader controls proposal

SOURCE ONLY / AUTHOR UNRUN. The immutable output/current-main498-pending-reader-controls-proposal
contains append-only afterimages for the existing account-history route, genuine
native owner reader/admission and mounted pending reader test files. Every original
test block/assertion and 5000ms/2000ms/180000ms/300000ms deadline remains literal.
No source file was changed or test/module/compiler/DB/browser/provider executed.

The controls target the frozen composition route afterimage, not this d15 worktree
runtime: default history with a genuine port still uses payer history; only
pending=owned selects proof plus native list. They cover port absence, no payer
fallback on proof/SQL refusal, real owned equal-time pagination and exclusion,
and structured logout invalidation followed by fresh server currentness checks.
The structured notice is a clearly synthetic transport fixture matching immutable
incoming use-siwe-auth, not a mounted auth-hook/provider acceptance claim. Existing
real JWT/native controls and actual mounted parser are reused. Older loose mounted
fixtures remain whole and retain their previously recorded parent reconciliation gate.

Pins and full raw restoration bind the original inputs, all three frozen composition
afterimages and new test afterimages. Existing signed POST new28 and historical
198 plus corrected6 evidence remain unchanged and retain their original scope;
none accepts this proposal or current composed main. PRIMARY owns application,
different-peer source review, actual changed/new tests, types, ordinary composition
build, required PR/CI and serialized merge. No PRIMARY outcome or original #257
latency/vendor/financial/remedy/delivery acceptance is completed by this proposal.

## 2026-10-15 - Honest pending-owner257 draft metadata proposal

Output-only proposal; not applied, reviewed, accepted or activated. Incoming manifest
baseline is exact Git commit 17e68540f1f8c1403543c0d9368b0770d771c812, read with absolute Git show.
The actual local English source is locales/en/pending-owner257.ts with ten unique flat literal leaves.
Normalized UTF-8/LF sourceSha256: 57f905d1d84b7f2886c0eb3c7124dbc87a03a0bf9a78bd1e7123ff970c56eed3.
English is absent from HEAD d15de1a0d6de394bc63d14324220e5a93f6ba3a5 and incoming 17e; its computed local Git
blob identity is not an available object. No Git-show English provenance is claimed.
The current local file bytes and all ten English leaves are retained in the handoff.
The existing checker source was inspected without executing its AST extractor.

The current account-jobs and research-checkout components import this English object
directly. As with the existing #263 direct web-only namespace proposal, this proposes
only empty vi/zh-Hans drafts (machineDraft, review null, entries {}) and the two
existing incoming manifest corrections. Each new row has 10 extracted leaves,
0 authored entries, no covered keys, no identifiers or aliases, all ten keys uncovered.
Namespace count 60 -> 61; English file count 59 -> 60; extracted leaves 5645 -> 5655;
uncovered entries 70 -> 80. All 5554 translations, 21 identifiers, 59 complete
namespaces and every existing row/source binding/coverage remain unchanged.
Top-level complete remains false and authority remains en. This does not compose
unapplied sibling #263 rows; parent must compose disjoint accepted additions if needed.

English critical consent/payment/custody fallback and legal copy stay unchanged.
No central messages import, formatter, framework, loader, default locale activation,
ChatGPT auth/model/native policy, schema or financial authority changes are proposed.
Web-only metadata has no CLI/MCP/API/desktop/extension/bot runtime behavior change.

Only output/honest-pending-copy-preview-proposal was written. This full document
is an afterimage with this truthful append, not an applied source documentation edit.
Whole raw before/after and complete hash-bound unique inverses are retained.
Canonical/local AGENTS and override, pilot common-rules, local/current incoming
workflow/development guidance and installed Next internationalization/use-client docs
were read. Local keryx-review was absent from worktree and session catalog; its
canonical SKILL.md and demo-critical-path reference were read explicitly.

Strict copy, compiler, tests, build, compiled controls and CI are UNRUN. No PASS or
named-human/independent approval is supplied by this source author. No application
module, DB, browser, network, Git writer, dependency or .next operation occurred.
Parent owns application after 17e merge and exact-input reconciliation. Parent runs
the existing no-argument strict-copy check ONCE before ONE current build; remaining
review/CI/delivery gates stay with parent and existing batched release ownership.
