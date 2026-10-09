# Delivery, acceptance and refund policy

Product direction for [#250](https://github.com/tang-vu/keryx/issues/250) and
[#257](https://github.com/tang-vu/keryx/issues/257), chosen on October 9, 2026
after the owner delegated the decision. This resolves the product-policy choice;
it does not claim implemented acceptance actions, refund execution or a changed
contract for an existing order.

## Customer choices

A paid job has a visible completion target measured from its original accepted
order. Exceeding that target produces an overdue state and a route to human
review. The customer may request continued waiting, an explicitly incomplete
deliverable, or a refund. A target breach alone is not proof of terminal failure
or final settlement. Unknown payment legs remain protected while reconciled.

A delivered job permits the original customer's Accept, Request revision or
Reject verdict with a timestamp and optional reason. Silence is `no_response`,
never acceptance. A revision keeps the original order and payment identity;
it cannot authorize a second customer charge, duplicate purchase or renewed
spending authority. Work beyond the original valid scope or remaining capacity
needs a separately reviewed decision. These actions are implementation gates.

For a terminal undelivered job, or a rejected deliverable whose failure to meet
the accepted scope is confirmed in review, refund the prepaid customer charge
less only irreversible source tolls that were explicitly disclosed before
payment and have final settlement evidence. Refund the service fee and unused
source/creator reserves. Do not deduct estimates, model/search overhead,
simulations, pending transfers or an undisclosed cost. If a qualifying source
cost cannot be established, it cannot reduce the customer's refund.

Already earned and settled creator rewards remain with their creators. A
customer rejection does not claw back source-owned proceeds or change an
original citation receipt; the Operator bears any remedy cost beyond the
permitted source-toll deduction. An incomplete result must be labelled as such
and cannot silently count as accepted or completed. Its settlement/remedy terms
must be shown for the customer to accept, not inferred from viewing it.

## Original authority and settlement

The policy is prospective. Versioned acceptance/remedy terms, price breakdown,
eligible source-cost cap, completion target and customer consent must be bound
to the accepted package before payment. Existing fixed-price packages and their
`remedy:none` fingerprints remain historical authority; do not rewrite their
records or claim that this document retroactively enrolled them. A voluntary
remedy for an existing original needs an explicit reviewed owner decision.

Refund accounting uses exact integer micro-USDC on the original network and
original payer/order. Bound a refund by the actually finalized customer payment
less prior finalized refunds and qualifying disclosed source tolls. Pending or
ambiguous outbound legs require original-only reconciliation before execution;
an expiry or missing row does not prove that money stayed put. Monthly jobs need
an explicit paid-allocation and entitlement remedy; a slot is not an invented
standalone cash payment. Keep a protected refund obligation until resolved.

Manual owner review is the initial execution gate. Selecting this product rule
does not authorize a transfer, new custody, signing, funding, automatic retry or
background schedule. Any execution must satisfy the existing finite payment
authority and original-only reconciliation rules, retain its evidence, and
prevent duplicate requests/refunds atomically. No general automatic refund
authority is introduced.

## Delivery gates and surfaces

The current [overdue observation increment](engineering/paid-job-overdue-escalation-257.md)
shows status and guidance only. It neither records customer choices nor submits
or pays refund requests. The existing latency target remains provisional.

Before advertising an active remedy, implement and review accepted terms,
owner-bound/idempotent verdicts and requests, expiry/revision behavior, pending
payment reconciliation, protected refund accounting and finite execution
authority. Verify rejection with a pending leg, duplicate submissions, refund
replay, source-cost evidence, no-response expiry and original receipt parity.

Web, API, desktop/CLI consumers, remote and stdio MCP, extensions and bots must
share the same acceptance/request contract and explain their supported roles.
Public reporting may expose consented acceptance aggregates separated by outside
customers and team; customer reasons, questions, private identities and payment
references stay private. Package/native acceptance, published distribution and
production readback are separate coordinated release gates. Both issues remain
open until their remaining acceptance criteria are met.
