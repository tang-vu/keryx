# Passive settlement signal observation for original #293

Original [#293](https://github.com/tang-vu/keryx/issues/293) remains **OPEN**.
This NEXT source increment implements bounded raw-message verification and
request attribution/reconciliation observations. The R126 increment below adds an
optional server transport caller seam; it installs no ingress or retention adapter,
does not promote settlement, and supplies no production, dropped-delivery or
real latency evidence. Frozen64, root recovery and production are untouched.

The existing implementation at base `ae298ff41c239b292a043b3442df33f1701a4b99`
already has `searchCircleTransfer`/`checkPendingTransfer`, pending-payment polling,
private incoming/creator reconciliation and creator notification delivery.
Those paths persist evidence or dispatch notifications under their existing
authority. The new observer imports only the existing tuple verdict function
and uses no existing mutator, search function, DB adapter or SDK at runtime.

## Source and protocol evidence

The read-only donor was
`../website-get-started-20261012/node_modules/@circle-fin/x402-batching`, version
**3.5.0**, inspected as text on October 14. No donor code was imported/executed.

| File | SHA-256 | Relevant contract |
| --- | --- | --- |
| `dist/server/index.d.ts` | `85d79cfad61a0aba99a575851b93a6457061ac3c1802da726ffb49cd75c35ff0` | `BatchFacilitatorClient.onAfterSettle`, lines 146–150; middleware seller hooks also exist. |
| `dist/server/index.mjs` | `1ec1621f67daa359c56de7ab7c8c5bd6e928be6182bacfc28e919f9f8550ce7e` | Lines 169–200 actually invoke local after-settle callbacks with payload, requirements and result; callback failures are contained. A callback invocation itself is not an authoritative asynchronous notice. |
| `dist/hooks-BKkPP7ic.d.ts` | `78c86fffaf189d6dbdce4948fad1cb5f11d775e7999c665596568134fb2211b7` | `SettleResultContext` extends payload/requirements with `HookSettleResponse`; result includes success, transaction, network and optional payer, without a confirmation timestamp. |
| `dist/client/index.d.ts` | `7338b2e43a1336e2fd93dcfaa5a7e5a86397656a0b1ae2d851d0f98653e12459` | Transfer statuses include received/batched/confirmed/completed/failed. The extensible transfer response does not explicitly require nonce; SDK typings alone cannot establish a complete exact-attribution proof. |

`lib/x402-server.ts` directly calls facilitator verify/settle and does not register
the SDK hook. Its existing response handling remains unchanged. Hook support was
verified in the installed bindings/implementation, not inferred from a proposal.

The owner-supplied
[legacy signature-reference URL](https://developers.circle.com/api-reference/gateway/all/get-notification-signature)
returned HTTP 404 during this read. Current official
[signature guidance](https://developers.circle.com/api-reference/verify-webhook-signatures)
confirms `X-Circle-Signature`, `X-Circle-Key-Id`, `ECDSA_SHA_256`, raw-body verification,
and Gateway public-key lookup at `/v2/notifications/publicKey/{keyId}`. The module
performs no lookup: an owner supplies only a synchronous already verified cache
reader. Key provenance/cache acquisition and rotation remain caller gates.

The current [Gateway event reference](https://developers.circle.com/gateway/references/webhook-events)
defines `gateway.deposit.finalized`, `gateway.mint.finalized` and
`gateway.mint.forwarded`. Deposit fields describe an onchain deposit; mint
`transferId` is an attestation-group ID and the payload can contain multiple
attestations. Neither establishes a one-request x402 authorization join. The
[v2 envelope/delivery reference](https://developers.circle.com/api-reference/webhooks)
documents subscription/notification IDs, version 2, timestamp and notification
object, repeated deliveries and unordered arrival. Unknown types are refused.
Known Gateway types receive only an authenticated **non-x402-event** classification;
their financial payload is neither parsed into proof nor exposed for attribution.

The actual [subscription API schema](https://developers.circle.com/api-reference/gateway/all/create-permissionless-subscription)
requires `environment` (`TEST`/`LIVE`), HTTPS endpoint, addresses and string CCTP
domains, with optional name/enabled/notification types. It differs from the generic
setup guide's example environment/domain representation. No subscription is
created here, no wildcard type is accepted as an event and no guessed x402 event,
HMAC secret or caller URL/key is introduced. A usable async x402 notice-to-request
mapping remains a concrete provider-contract gap.

## Implemented passive contract

`lib/gateway/settlement-events.ts` has two independent entry points:

- `observeCircleNotification` verifies the original bounded bytes using a single
  bounded UUID key selector and a trusted cached EC public key with the exact
  algorithm. It rejects duplicate signature headers, malformed base64, oversized
  input, unowned subscriptions, invalid envelopes and unknown event types. The
  result authenticates bytes only; its SHA-256 and envelope identity can describe
  a retained delivery but are not transfer proof. It never accepts a body-supplied
  key, protocol, network, payee or URL.
- `observeSettlementRequests` scans every explicitly supplied admitted request,
  including requests without a retained local SDK receipt hint. Hints carry only
  the existing admitted request ID and the locally retained SDK result transaction
  ID. They cannot supply payment tuples, authorize a lookup or establish settlement.
  The synchronous `readRetainedProof` port must read owned cached/history data;
  there is no fetch/search/default adapter, schedule or mutation fallback.

Bounds are 64 KiB raw body, 32 header entries/8 KiB total, 100 admitted requests,
100 receipt hints, 100 retained bindings and 100 proof rows per read. Oversized
windows refuse; they are never truncated and called complete. Admission and
proof snapshots copy only the needed scalar fields. Admission snapshots passed
to the reader, proposed bindings and returned observations are frozen.

The owned caller selects an admitted request and its originally recorded payer,
payee, nonce, supported canonical network and exact integer micro-USDC amount.
The observer reuses `checkPendingTransfer`, additionally requires `confirmed` or
`completed`, and refuses any duplicate nonce in the proof window, even when only
one duplicate has a matching tuple. Existing received/batched acceptance semantics
are not changed: this observer describes those as processing. Exact failed proof
is an observation only and releases nothing. Missing proof stays awaiting or
unavailable. Foreign token/network/address/amount, hint/proof disagreement, duplicate
admission IDs/nonces and retained tuple/transfer rebinding remain unresolved.

Retained bindings bind one transfer ID to one immutable request ID/economic tuple
digest and retain its nonce so a different request/transfer cannot reuse it.
Identical hints/bindings are deduplicated. Conflicting retained history
refuses the window. Cross-read transfer identity conflicts are detected before any
proposed confirmed binding is returned, including duplicate nonces split across
proof windows; confirmed/completed lifecycle progression
does not itself conflict. Request output is sorted so input/delivery ordering is
not authority. This is an observation of the supplied window, not proof that a
caller supplied complete all-time history. Future storage must atomically retain
unique immutable bindings and supply every relevant conflicting original/binding;
discarding history or concurrent truncated windows cannot meet #293 acceptance.

`confirmedWithoutHint` means an authoritative confirmed original had no local
retained receipt hint in this supplied window. It can identify recovery work after
a missed hint; it does **not** prove a dropped provider delivery. Unmatched hints
are counted and never trigger an unowned read, payment or new request. Prior
bindings are never mutated: an unavailable, processing or contradictory later read
cannot overwrite retained confirmed history through this module.

Latency is confirmation minus submission only when **both** separately retained
authoritative times are present, valid and ordered, and the recorded confirmation
time is explicitly bound to the same authoritative transfer ID. Missing/invalid/reversed times
give `null`; no `Date.now`, notification timestamp, transfer `createdAt`/`updatedAt`,
admission time or polling interval is substituted. Zero is returned only if both
explicit recorded times are equal. Millisecond date parsing cannot establish
sub-millisecond provider latency; real time provenance remains unproven.

## Fixture and acceptance handoff

`lib/gateway/settlement-events.test.ts` contains synthetic isolated EC key/signature
fixtures plus behavioral controls for raw-byte tampering/forgery, key/header/body
refusal, unowned subscriptions/unknown event types, webhook/receipt-only refusal,
hintless recovery, duplicate/out-of-order data, exact tuple mismatches, duplicate
nonce/admission evidence, immutable history conflicts, cross-read transfer owners,
read errors, bounds and truthful latency. All keys/proofs are fixture-generated or
synthetic; none represents a real Circle settlement.

The source author **did not run** these fixtures, an application, compiler, build,
SDK module, DB, vendor API, Git writer or native retry. Read-only source/diff/hash
inspection is not test acceptance. ROOT must arrange the separate source peer,
then execute focused crypto/failure fixtures and applicable TypeScript checks,
correct any failures in this candidate, and carry the coherent NEXT PR through
required CI. No successful check, review, PR, merge or delivery is claimed here.

Original #293 still requires actual SDK/caller retention and admission-binding
proof; atomic durable unique storage and restart/concurrency evidence; an established
x402 provider schema/subscription and raw-body ingress integration if used; ops
key acquisition/rotation and bounded retained-window completeness; dropped/unmatched
delivery recovery through the installed ordinary caller; and independently recorded
real settlement latency. Those proofs require separately scoped implementation and
verification. This source is useful without pretending those gates are complete.

## Surface boundary

Web/API, desktop, CLI, remote/stdio MCP, extensions, bots and private workers all
retain their existing runtime payment/reconciliation/notification flows. The shared
transport now offers the optional private seam below; no surface installs a retention
adapter. A future installation must use
owner-scoped admitted history and exact bindings rather than exposing private
history in a public ingress. No version, deployment, activation, schedule,
financial authority, custody, cap, nonce, registry or public traction state changes.

## R75 P2 correction: conflicting hints cannot hide retained witnesses

The observer now collects every admitted original's bounded synchronous retained
proof snapshot before applying hint/admission refusals or proposing outcomes.
Conflicting hints still refuse their own request; their retained transfer/nonce
witnesses participate in the unchanged complete-window collision guards. Unowned
hint IDs never trigger reads. Immutable tuples, the existing transfer verifier,
signature/body/key/header contracts and all economic authority remain unchanged.

New synthetic controls cover confirmed/failed same-transfer contradictions with
either original carrying conflicting hints, reversed requests/hints, duplicate
hints/bindings and split/duplicate nonce witnesses. They require NULL binding and
latency for affected originals while an independent safe original still confirms.
All fixtures/types remain **UNRUN** pending changed-source peer review and ROOT's
normal focused checks/PR/required CI. Original #293 caller, durable unique retention,
ingress/vendor and real latency gates remain **OPEN**; delivered64/main/production
are unchanged. Exact four-file before/after pins, protected-source readback and
`r78-full-inverse.patch` are retained with `source-correction.txt` in
`D:/repos/server/Github/Hackathon/keryx/output/resume-root-release63-20261012/refill-successors-20261013-78/worker-correctSettlement293CrossReadWitnesses/`.

## R126: optional passive server transport observation

`payWithServerSigner` now accepts `settlementObserver` with an optional owned retained
`admittedRequest` and an `observe` callback. It copies and freezes only bounded scalar
fields, checks the original payer/payee/nonce/network/amount against the actual signed
submission journal tuple, and exposes that original only after every installed journal
callback succeeds. The caller remains responsible for the original's actual durable
admission and retained timestamps. No journal, missing original, malformed fields or
tuple mismatch produces `admittedRequest: null` and `receiptHint: null`; no identity or
timestamp is invented. The seam creates no admission, submission time or proof.

After the existing transport completes, the callback gets a frozen typed signal with
that original, a bounded transaction-ID receipt hint when attributable, delivery flag
and HTTP status (or null). Receipt success remains only a hint for the passive observer.
`observeSettlementRequests` still requires retained independent exact proof before
proposing a binding; its observation never changes `ServerX402Attempt` or payment state.
No raw receipt, signed header, signature, URL, response body or exception is exposed.
Synchronous throws and asynchronous rejections are contained without logging private
errors. Observer promises are never awaited, timed out into a payment retry, or used as
journal acknowledgement. The owner must supply a bounded callback; JavaScript cannot
preempt a synchronously non-returning callback. Durable retention is not guaranteed by
this best-effort port, and callback completion is not part of payment completion.

Synthetic actual `payWithServerSigner` fixtures compare unchanged result and exact HTTP
calls/header bytes, freeze/copy behavior, both journal failures, absent/mismatched original,
getter failures, synchronous/async/never-resolving observers, response loss, paid 5xx,
invalid JSON, omitted/oversized receipt IDs, and integration with the accepted observer
using missing versus exact independently supplied synthetic proof. Missing times stay
null. No production caller registration, SDK hook, DB/schema, ingress, vendor/key lookup,
notification, schedule, retry, cap/nonce/status mutation or financial authority is added.

The unchanged helper and its tests retain SHA-256 pins
`e13ebbc004ba3053ee8eb8926349797c659ed8a3aa4fe85c7e9c307c45855909` and
`9467f4ce77acf2fe42eab23844556d59d1370256b783d8bc9aaf1f47adb4824d`.
The actual `first-accepted-domain293-controls-20261014/actual-result.json` records 44
passing, zero failing/skipped controls, and `actual-types-result.json` records focused
TypeScript success for those unchanged pins. Those prior helper checks remain valid only
for their recorded scope. R126 itself ran no Git, test/compiler/module/build/DB/browser/
provider/target operation. Subsequent R128 review and actual mounted transport checks
are recorded below; required payment/aggregate PR CI remains the parent's gate.

Original #293 remains **OPEN**: durable unique retention with restart/concurrency and
complete retained windows, installed ordinary caller recovery evidence, actual vendor
mapping/ingress/key operations if used, and independently retained real latency remain
separate gates. This is source/caller progress only; coordinator merge/batch ownership,
original61, delivered64 and production are unchanged. Before/after source, hashes, raw
handoff and exact inverse are retained only in the authorized R126 worker output folder.
## R129: preserved accepted caller source for ordinary parent finalization

R128 FIRST peer receipt records **scoped ACCEPT**, no P1/P2 findings, and matching live
and snapshot pins for the mounted passive transport. The reviewer ran no tests or
compiler and explicitly withheld runtime/CI acceptance and issue closure. Receipt:
`output/resume-root-release63-20261012/refill-successors-20261013-128/worker-review293MountedPassiveTransport/receipt.json`.

The separate actual execution records in
`output/resume-distribution63-audit-20261012/first-mounted293-transport-controls-20261014/`
show **26 passed, 0 failed, 0 skipped** in `actual-result.json`, and focused TypeScript
**exit 0** with empty stdout/stderr in `actual-types-result.json`. Both capture normal
exit/close, no timeout/overflow/errors, and the exact mounted caller/test/helper pins.
The unchanged helper retains its prior **44 passed, 0 failed, 0 skipped** and focused
types exit 0 in `first-accepted-domain293-controls-20261014/`. These are actual scoped
fixture/compiler executions by the earlier check owner, reused here without rerunning;
they establish neither actual outbound settlement nor whole current-main acceptance.

All five owned raw files were copied and hash-verified before the first Git attempt.
R129 changed this document only; all four accepted code/test files remain byte-identical.
Normal Git inspection could not start: PowerShell reported `git` as an unrecognized
command (`CommandNotFoundException`). No alternate runner, Git retry, checkpoint,
composition, fetch, reset, stash, force, push, PR or merge-to-main was attempted.
The requested incoming commit is `5213bdf632653dbaa0203c1a9294c0782bd44276`; local object
availability and whole incoming composition remain unverified for parent finalization.
Filesystem HEAD/ref readback remains `ae298ff41c239b292a043b3442df33f1701a4b99` on
`fix/settlement-events293-next-20261014`; no Git tree or full dirty-status result is claimed.

Parent's next action is ordinary checkpoint of only these five owned files, then normal
composition with that exact incoming main if its local object exists. Preserve the whole
incoming source and only the exact owned helper/caller/docs additions if conflicts arise;
record minimal actual conflict proof and refresh relevant changed-source checks. Parent
retains focused publication, required aggregate/payment CI and remaining actual checks;
the sole coordinator owns merge/deployment. No current66, default ChatGPT policy,
provider/model, version, release, production or shared-owner state changed here.

Original #293 remains **OPEN**. Atomic durable unique retention, restart/concurrency,
complete retained windows, installed ordinary caller dropped/unmatched-delivery recovery,
actual vendor mapping/raw-body ingress/key acquisition/rotation if used, and independently
retained real settlement latency remain open. No actual outbound/payment/storage/target
call, producer, new test execution, compiler or build ran in R129. Complete raw before/
after files, exact byte restoration records, preserved input hashes and final available
pins are retained in
`output/resume-root-release63-20261012/refill-successors-20261013-129/worker-finalize293AcceptedCallerCurrentMain/`.
