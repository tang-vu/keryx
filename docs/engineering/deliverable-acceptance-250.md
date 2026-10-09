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
