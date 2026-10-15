# #257 signed POST owner-admission controls — 2026-10-15

Source authoring only: **28 new parameterized cases, all UNRUN** in
`lib/api/a2a-v2-route.test.ts`, under the exact describe name
`signed POST NEW owner-admission controls`. No module, test, compiler, database,
browser, build, Git writer, provider, target, payment, wallet or signing execution
occurred. The signatures and SQLite work described below are authored future
fixture behavior, not actions executed by this session. Existing ChatGPT auth,
model selection and native policy remain unchanged.

The complete original 41,272-byte file is retained as an exact byte prefix.
No import, original body, assertion, deadline, helper, global mock or existing
mock behavior was edited. The new isolated describe copies the existing genuine
signed-route fixture locally, snapshots/restores inherited mock implementations,
closes its own adapter, restores config/environment and removes only its own
future temporary fixture. It adds no runtime authentication bypass.

## Traced producer and authority boundaries

The actual POST in `app/api/agent/ask/route.ts` validates its body and computes
its existing request hash/quote before owner admission. A present account header
requires the exact signature-derived order ID, same origin, literal `associate`,
no competing Authorization header and actual signed-cookie verification through
`pendingOwnerRequestSession`. Absent account header retains ordinary admission;
it is not the same refusal path as a present false header.

The existing Next cookies selector is synthetic framework plumbing. Its token is
issued by real `issueWebSession` into the real isolated enrolled native adapter;
real HS256/issuer/audience/TTL and exact durable tuple checks consume it. The
positive URL/origin is literally `https://keryx.cc/api/agent/ask` / `https://keryx.cc`.
This is server consumer coverage, not proof of browser cookie transmission,
compiled checkout reachability or fixed-origin transport validation.

The real seller helper normalizes the existing signature envelope, verifies it,
claims the existing purchase tuple and checks the exact durable session in
`beforeSettlement`. After a synthetic vendor delivery response, the real POST
records its inbound fixture row and calls the real native `createOwnedA2aOrder`.
Its immutable owner row is read back from a second readonly fixture connection,
including exact job/query/request hash/network, cookie owner, original token's
session hash, issued/expiry times and admitted timestamp. The payer is a distinct
unfunded fixture account and cannot establish research ownership.

The copied vendor verifier recovers the genuine typed signature but is a
**synthetic Circle verifier**, not a Circle call. Vendor delivery/transaction
strings are **synthetic unfunded responses**, never financial settlement proof.
`getAgentDeps` supplies the real native DB with synthetic unused gateway/engine;
no research worker/provider runs. No method facade or atomic producer is mocked.
Atomic pair/concurrency/rollback/guard qualification remains the separately
qualified native controls; these consumer checks do not requalify R143/R150.

## Bounded authored controls

| Controls | Meaningful observations and limits |
| --- | --- |
| Quick / Deep NEW positive (2) | 202; exact immutable owner/session/token row; payer differs; signed body/header/nonce and .05/.08 price, .03 creator cap, .02/.05 fee unchanged; queued worker fields and unknown recovery retained |
| Missing cookie, false header, foreign/missing Origin, competing API key, wrong-secret cookie, revoked original with active replacement, expired signed cookie, mismatched durable wallet/issuance/expiry (11) | Exact 401/no-store before verifier/vendor delivery; no owner, original, inbound payment or research run. Durable mismatch edits affect only the future isolated test row, preserving its SQL constraints |
| Cookie without owner header, anonymous, API key, CLI-shaped, generic-shaped requests (5) | Ordinary signed POST still returns 202 with original economics and nonce, no relation and no account-owner projection. CLI/generic labels are server request shapes, not CLI/MCP/transport execution |
| Unsigned owner opt-in (1) | 401 before payment; no anonymous fallback |
| Wrong signer, explicit vendor refusal, missing vendor receipt evidence (3) | Actual seller refusal 402/402/503; no owner/original/inbound row, receipt or worker. Payment purpose claim may be retained by normal pre-settlement policy; no assertion erases it |
| Existing unowned / owned original replay (2) | Fresh same-wallet and foreign sessions receive the existing 200/replayed pending response; unchanged original, owner row and inbound ledger. Historical unowned originals remain unowned; replacement cannot change the admitted session hash |
| Same nonce with changed question / budget (2) | Existing purchase-binding / verifier refusal (500/402), no owner backfill, original and ledger unchanged, no second vendor delivery |
| Revocation before / during delivery (2) | Exact original fixture race reused: 401 before delivery; 500 plus retained synthetic receipt/inbound row after delivery; no owner/original, no retry or research execution. A fresh adapter inspects the same isolated namespace after permanent guard refusal |

Replay makes three synthetic vendor calls with the identical authorization.
That is the existing seller policy; it is not evidence of real vendor nonce
deduplication or authorization to resubmit a paid original. Account reads and
the genuine bearer GET perform no additional delivery call or financial write.
The inherited fixture disables privacy reads explicitly; its bearer GET therefore
asserts the actual ordinary 200 pending response. Active privacy roles are not
claimed by that check. Missing retained recovery facts remain `unknown`, with
no manufactured hold, failure, refund, replacement owner or customer remedy.

## Evidence retained and continuation

Parent-supplied FIRST nine-file evidence remains **198 PASS / 5 FAIL**. The
corrected five plus meaningful existing unknown control subsequently recorded
**6 PASS / 0 FAIL**, parent tool 28848, with unchanged 198 evidence retained.
Those are parent observations, not executions here. That nine-file set did not
include `a2a-v2-route.test.ts`; neither result accepts these new controls or its
older route cases. R143/R150 source/payment review and R156 corrected fixtures
remain separately qualified and are neither rewritten nor reviewed again here.

`output/signed-post-owner-admission-controls-handoff.json` contains exact raw
before/after bytes, hashes, additive-prefix proof, normalized minimal patch and
full inverse, plus all current 39 runtime/product pins before and after. Raw
bytes are the restoration authority where line endings differ from patches.
No runtime/product/protected file is changed. Existing dirty source belongs to
the parent and is excluded from this patch.

Next action belongs to ROOT: independent tiny security peer of this additive
scope, then execute **only this new describe**, types and applicable current-main
acceptance. Build only when source inputs or required CI call for it. Resolve
actual failures without weakening original tests or global mocks; request the
parent's runtime partition before changing any demonstrated runtime defect.
Pass focused PR aggregate/domain CI, then hand to the existing serialized merge
coordinator. Deployment stays in the coordinator's batch; no Git writer/PR/CI or
deploy was invoked here. This source partition is not the final project stop.

The existing compiled checkout reachability gate remains unresolved in
[job-target257-compiled-owner-consent-20261015.md](job-target257-compiled-owner-consent-20261015.md).
Original #257 paid/provider latency, remedy policy/execution, real delivery and
customer acceptance remain **OPEN**. Web/API, desktop, CLI, remote/stdio MCP,
extension and bots receive no runtime/distribution change from this test-only
increment; final-main/surface/package acceptance still belongs to the parent.

## Observed FIRST failures and source correction — 2026-10-15

This section supersedes the earlier all-UNRUN/additive-prefix/verbatim-copy claims
for the current candidate. Parent ownE
`job257-parent-first-signed-post-controls-and-types-20261015` observed **0 PASS /
28 FAIL**, plus type failure (exit 2). The earlier child prelaunch EPERM remains
separate evidence; it is not the result of this parent execution. No check was
executed by this source worker. All corrections below are **UNRUN**.

The first Quick case reached its exact original/owner pair, distinct payer,
session projection and vendor assertions before failing at original line 884.
That line checks an inbound payment, not owner-row insertion. The real POST
calls `recordPaymentOnce` before native `createOwnedA2aOrder`; the SQLite
`listPaymentsByQuery` consumer returns only `kind='citation'`. Filtering that
result for inbound necessarily yields zero. The new block now observes the
full ledger through a separate readonly connection, including no-insertion,
replay equality and post-delivery revocation assertions. Synthetic vendor
transactions remain explicitly unfunded fixture data, never real settlement.

The following 27 cases fail opening the adapter at line 786. Setup formerly
created a new folder/identity/manifest per case; cleanup deleted it after each
case. `readRuntimeStorageDeployment` pins the first manifest and canonical
identity for the module/process lifetime and refuses any changed namespace.
The new block creates its isolated schema/identity/key once, reapplies the same
manifest/path/key per case, closes each adapter, and removes its own folder only
at block teardown. Unique monotonic signed nonces and fresh genuine durable
sessions retain per-case identity; assertions remain keyed to the original ID.
No storage pin reset, guard mock, config override or runtime authority change
was introduced. The inherited original fixture lifecycle is preserved.

The three assigned fixtures narrow only the existing mainnet network literal
with `as const`; the admission fixture uses an explicit `Record<string,string>[]`
for its existing headers with identical wire values. The original route-test
prefix is whole after erasing its one necessary literal annotation. Every new
case/security assertion body is whole after reversing only its ledger-reader
substitution. No signed body/nonce, owner/payer distinction, exact native tuple,
session check, deadline or financial assertion was removed or relaxed.

The sole runtime edit is `/api/me/jobs`: owned rows feed a local cursor consumer
whose truthful contract contains only `id` and `createdAt`. It serializes those
same two fields and validates via the existing decoder, eliminating the invalid
`OwnedPendingJob` to `A2aOrder` cast without invented authority fields or a shared
type edit. Owner/sealed projections, UNKNOWN, 180/300 createdAt target timing,
recovery semantics and financial nonpromotion remain unchanged.

Raw before/after, unique case literals, full inverse and all 39 prior protected
comparisons are saved in
`output/observed-signed-post-fixture-types-handoff.json`. Only me/jobs is an
intentional protected delta. Retained **198 PASS** and later **6 PASS** evidence
remain historical parent results and do not accept changed source or new28.
ROOT alone executes affected new28/actually changed classes and focused types;
this candidate has no successful validation, merge, deployment or source-only
closure. Original #257 remains **OPEN**. The shared process pin also means this
block cannot be combined blindly with another independently enrolled namespace;
parent selection/isolation remains necessary, without runner edits here.


The corrected signed-POST controls produced 25 PASS and three fixture-only failures before their intended refusals: the deliberate raw durable-row corruption actor lacked the connection-local storage capability. The actor now registers only the same fixed synthetic identity created in this describe, inside its existing try/finally and before the three isolated UPDATEs. It still closes before the genuine route call; no production handle, guard, fence, session or financial code changes. The original assertions remain, and only these three failed controls require refresh.
