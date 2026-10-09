# Original-customer deliverable acceptance — issue 250

The owner delegated the remedy choice on October9,2026. The authoritative
[delivery/remedy policy](../research-delivery-remedy-policy.md) is now on main.
Its prospective rule removes the policy-choice blocker; it does not change
historical `remedy:none` packages or authorize a refund transfer. This is the
next source outcome after the separately owned overdue, review-first and public
ledger work. It requires a complete shared customer contract and validation,
not a standalone refund calculator or a simulated successful execution.

## Original identity and immutable evidence

Acceptance is a separate, versioned journal bound to the original store identity,
network, verified payer/asker, order/run identity and exact delivered content or
receipt digest. Read those values from trusted retained records. Request JSON,
telemetry, a public report ID or a bearer recovery capability cannot substitute
for customer ownership. Customer reasons remain private; the report exposes
only the permitted acceptance state and consented aggregate classification.

Distinguish public browser-funded dispatches, prepaid ordinary A2A originals,
private v2 originals and monthly allocations. They have different payment and
storage authority. An absent accepted contract or unsupported original is
unavailable, never silently mapped to a different job. Keep original delivery,
settlement, receipt and request hashes byte-identical. New metadata cannot turn
an owner/team test into an outside customer or prove a unique human.

## Customer state and requests

The original customer can Accept, Request revision or Reject a delivered
version. Every submission has a closed schema, timestamp, optional bounded
private reason and owner-scoped idempotency key. Concurrent, conflicting,
lost-ack and repeated submissions require atomic current-version readback.
Choices attach to an exact delivered version, not an answer that later changed.
Silence is `no_response`; it never becomes acceptance or consent to partial work.
Freeze and disclose the response window in prospective terms before payment.
An elapsed window cannot reopen authority or erase a later explicitly reviewed
request. Historical jobs without that window keep its absence visible.

A revision request retains the original job/payment/reservation and is visibly
pending owner review. It is not a follow-up dispatch, second customer charge,
fresh nonce, replenished spend cap or retry after an uncertain original leg.
Any implementation that executes a revision must first demonstrate a bounded
original-only admission and evidence-preserving versioned delivery. Unsupported
execution remains withheld; do not claim completed revision from request storage.

A rejection/request does not assert that a refund settled. Review the accepted
scope, finalized inbound amount, prior refunds, explicitly disclosed and finally
settled irreversible source tolls, existing creator rewards and ambiguous legs.
Protect the refund obligation before an executor can consume finite authority.
Use canonical integer micro-USDC and the original payer/network throughout.
Pending originals require original-only reconciliation; repeated requests cannot
multiply obligations or transfers. Earned creator rewards are not clawed back.

For a v1 `remedy:none` original, expose its actual historical terms and record
the customer request without promising prospective policy enrollment. A voluntary
old-original remedy requires an explicit reviewed owner decision. Monthly jobs
need their actual paid allocation/entitlement contract; no cash refund is invented
from a slot. New remedy terms remain inactive until the full required accounting
and bounded execution gates are implemented and accepted.

## Storage, surfaces and release gates

Prefer one cohesive acceptance/request domain behind the existing storage
authority, with shared types/projections and atomic writes. Ordinary SQLite and
Supabase adapters, native enrolled stores, deployed schemas and supported method
inventory must be evaluated separately. Do not bypass a sealed store with an
unbound ad-hoc file or a permissive ordinary fallback. Missing migration/domain
capability refuses before any mutation. Any source migration stays isolated and
cannot be applied to production by this source lane.

Web report/owner history, API, remote/stdio MCP and CLI must share the same
owner-bound contract. Desktop may use the web view or its authenticated adapter;
extensions and bots must either forward the same authority or explicitly refuse
unsupported actions. Public state/usage reporting exposes no private reason,
question, wallet, nonce or original payment reference. Agreement with a source
decision under #253 is distinct from deliverable acceptance and usefulness.

Qualification includes actual concurrent/lost-ack store tests, owner/session/API
key scope and CSRF tests, duplicate/conflicting submissions, changed delivered
digest, timeout/no-response, revision after timeout, foreign network/store,
pending-payment rejection, immutable original receipt parity, exact refund caps
and retained creator rewards. Test applicable ordinary/native/SQL adapters and
actual built browser/API/MCP/CLI surfaces, both TypeScript graphs, scoped lint,
copy guard and default production build. Reproduce the paying-source study if
its reachable inputs change. Preserve observed failures and distinguish source
acceptance from hosted aggregate/platform/distribution/deployed acceptance.

No provider call, customer charge, refund, custody/funding change, schedule,
production operation or version reservation is authorized by this design.
Actual funded execution, enrollment/cutover and one coordinated release retain
their applicable owner/acceptance gates. Keep full issue250 open wherever a
required surface or original-only revision/remedy gate remains unmet.

## Implemented candidate: ordinary prepaid A2A requests

The initial source supports **completed, settled ordinary prepaid A2A originals
only**. It requires the retained A2A request/package, its exact original purchase
claim and matching settled inbound payment tuple. `remedy:none` stays unchanged;
the response window is explicitly absent. Browser-only, Monthly, private-v2,
archive-only and enrolled native originals remain unavailable. No separate file
journal or ordinary fallback grants a sealed store this capability.

The ordinary SQLite/Supabase optional `deliverableAcceptance` port owns a separate
append-only journal. Its fingerprint includes the journal store UUID, network,
verified original owner, order ID and hash of the complete retained original.
`deliveredDigest` hashes the exact retained response JSON text. In SQLite this is
the stored text; PostgreSQL JSONB has already discarded original serialization,
so the binding is to its retained `response_data::text`, not invented historical
wire bytes. `answerDigest` separately binds the answer shown by the UI. The UI
enables choices only when a verified `{answer,digest}` pair matches the current
display and the server snapshot, including during asynchronous digest changes.

Every write locks/rechecks the original and active durable session/key authority,
compares the read-back digests and expected journal revision, and appends a server
timestamp. Session validity is checked after authority-lock acquisition; a wait
across expiry cannot preserve an earlier clock. Exact-key replay returns current
state without appending; a reused key with changed contents or competing revision
refuses. A later explicit choice **supersedes an earlier Accept** for current
state, while the old journal entry remains immutable. A new choice with
`publishState:false` withdraws current public consent. The owner UI refreshes the
public projection after acknowledged read/write. Clearing local retry data does
not cancel a server entry. Pending/unknown creator legs remain visible and intact.

Reasons are optional, well-formed UTF-16, at most 1,000 UTF-16 units, and private.
The public projection contains only format, consented current choice and timestamp;
unknown/unshared originals return `not_shared`, not an inferred `no_response`.
The bounded public counts include only current consented prepaid A2A originals.
Outside-customer, team, silence-denominator and acceptance-rate measurements are
`null`: a wallet, API key, order or request channel proves none of those categories.
Acceptance records a customer choice, not semantic correctness or independent
usefulness. No original, query, receipt, payment or earned reward is changed.

| Surface | Candidate contract and authority |
| --- | --- |
| Web / desktop web view | Completed A2A job details and current report; active original-owner session, captured `X-Keryx-Expected-Wallet`, configured same-origin write and current displayed-answer digest. No desktop/native sidecar. |
| Private API | `GET/POST /api/me/deliverables/{id}/acceptance`; session capture required (428 absent, 409 changed), or explicit `deliverable:read` / `deliverable:write` bearer scope. Authorization presence never falls back to cookies. |
| Public API | `GET /api/deliverables/{id}/acceptance` and `/api/deliverables/acceptance/metrics`; consented projection/counts only, no owner/reason/question/payment identifiers. |
| Remote MCP | `deliverable_acceptance_read` / `deliverable_acceptance_submit`; captured verified key row/owner and explicit scope, shared ordinary port, no research or financial authority. |
| Stdio MCP / CLI | Same closed schemas via one bounded HTTPS bearer request, no cookies, redirect, retry, signer, provider, database selector or environment-file loader. CLI reads one opened regular UTF-8 input file, max 16 KiB. |
| Extensions / bots | Existing report links can show the public projection. No new key custody or acceptance controls; integrations may use the scoped API/MCP contract explicitly. Existing research/Telegram telemetry cannot grant original ownership. |
| Enrolled native stores | Optional domain absent; no-port/refusal precedes input consumption or mutation. A reviewed native domain/schema/client capability and real native acceptance are still required. |

All API results/refusals use `private, no-store`, `Vary: Authorization, Cookie`,
`no-referrer` and noindex headers. Existing API-key verification updates
`last_used_at` telemetry; the new transformation itself writes only its journal.
Discovery/schema output contains no saved private input. MCP clients may retain
messages independently of server privacy.

## Reproduction and remaining acceptance

Focused Vitest suites cover original binding, owner/scope/CSRF/privacy, revoked
authority, key replay/CAS, changed delivery, pending legs, public withdrawal/counts,
native no-port/no-schema-write, bounded CLI files and a deferred UI digest. Run
`npx vitest run lib/deliverable-acceptance --cache=false`. The cross-process SQLite
script exercises real competing connections, duplicate replay and expiry across
the write-lock wait. The PostgreSQL17 script applies actual source migrations and
uses the actual Supabase RPC adapter, including observed authority-row lock waits,
closed SQL input and service-role/immutable/sealed refusal. Its optional portable
runtime requires an explicit owned cluster directory/loopback port; default CI
uses a fresh network-isolated PostgreSQL17 container. No fixture is vendor-funded
or a real settlement even where synthetic bookkeeping marks a row settled.

`test-deliverable-acceptance-transports.mts` checks the actual built stdio package
and CLI against synthetic HTTPS, with exact requests and no wallet/payment files.
After the default Next build, `test-deliverable-acceptance-built.mts` checks actual
cookie/key routes and owner UI with production CSS at 320/390/768/1440 widths,
real isolated durable sessions, acknowledgement loss/replay and public withdrawal.
Its durable sessions/bookkeeping are synthetic; it does not test live SIWE/provider consent.
Both TypeScript graphs, scoped lint/copy checks, strict complete tool inventories,
the default production build and paying-source-study reproduction bind the final
candidate. Historical or failed harness attempts remain separate evidence.

Revision and refund execution remain **withheld**. Requests create no new charge,
spend reservation, recovery retry, source purchase, transfer or refund obligation
execution. Original-only revision delivery, prospective response-window terms,
refund-cap/irreversible-toll accounting and accepted payment executors remain open.
So do Monthly/private/browser/native adapters, outside/team classification,
independent product acceptance, hosted aggregate/platform checks, schema rollout
and synchronized deployed/package/installer verification. This candidate does
not establish full issue250 closure or activate prospective remedy terms.
