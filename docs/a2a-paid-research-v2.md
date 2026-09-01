# A2A Paid Research v2

This document is the operating contract for `POST /api/agent/ask`. The feature is Arc-testnet-only.
It does not enable mainnet, custody caller keys, alter creator `payTo`, or make projected economics
into settled revenue.

## Product contract

The request body is validated before the 402 challenge is built:

```json
{
  "question": "What is Arc finality?",
  "budget": 0.05,
  "researchMode": "deep",
  "responseMode": "async"
}
```

`responseMode` defaults to `wait` for existing buyers. `async` (or the standard
`Prefer: respond-async` header) is the production integration: after Circle settlement, Keryx
persists the private job and returns `202 Accepted`, `Location`, `Retry-After`, the x402
`PAYMENT-RESPONSE`, and a read-only `pollUrl`. The caller polls that URL without paying again.

`budget` is the maximum downstream creator spend, not Keryx's fee. The exact all-in x402 price is:

```text
Quick = $0.02 orchestration + creator cap
Deep  = $0.05 orchestration + creator cap
```

All arithmetic is rounded once in integer micro-USDC. The creator cap is at least one micro-USDC
and at most `KERYX_A2A_MAX_BUDGET` (default $0.50). The package is fixed-price and non-refundable.
The result itemizes `serviceFeeUsdc`, `creatorBudgetUsdc`, `settledCreatorSpendUsdc`,
`pendingCreatorSpendUsdc`, and `unusedCreatorReserveUsdc`. Pending authorizations are not mislabeled
as either settled payout or unused reserve.

## Authority and money flow

1. The caller's signer authorizes the exact dynamic package price to Keryx's treasury through x402.
2. Circle verify/settle is the only authority for recording inbound settlement.
3. After confirmation, Keryx's server-held treasury signer runs the existing agent with the exact
   prepaid creator cap. Registry/source/offer data still chooses every downstream `payTo` and price.
4. Fetch and citation failures remain isolated legs; a completed answer is preserved.
5. The response reports Circle-confirmed inbound money separately from confirmed/pending creator
   legs. No reserve or projection is promoted into creator traction.

The prepaid amount is accounting coverage, not proof that the seller and downstream treasury signer
share one liquid balance. If those are different wallets, operations must keep the funder healthy and
rebalance independently; creator spending still fails closed when treasury health is insufficient.

The server never accepts `price`, `payTo`, `fundingOwner`, order id, or settlement state from the
request body.

## Once-only state machine

```text
Circle settled authorization
          |
          v
 deterministic inbound ledger row
          |
          v
 running + no started_at (queued) -- atomic worker claim --> running + started_at (processing)
          |                                               |
          |                                               +-- successful QueryRun --> completed
          |
          +-- invalid private payload -------------------------> failed before creator spend
```

The order id is SHA-256 over the network, payer, treasury payee, and signed EIP-3009 nonce. This is
necessary because nonce uniqueness is scoped to the payer; hashing a nonce alone would collide
across callers. Circle transaction id is included in replay comparison and is the fallback identity
only if a valid facilitator response omits the nonce.

Creating the order is an atomic insert-if-absent. A replay must match the complete economic tuple:
payer, payee, authorization, transaction, amount, creator cap, service fee, research mode, and a
canonical SHA-256 hash of question + normalized model + pricing inputs. Async execution requires a
private service-role-only copy of the normalized worker input; the worker recomputes that hash and
refuses creator spend if the payload changed. Polling never returns the private input.

- `completed`: return the stored response; never rerun.
- `running` with a saved QueryRun: repair order completion and return it.
- `running` without `started_at`: return `queued`; only the worker's atomic claim may start it.
- `running` with recent `started_at`: return `processing`; never guess whether creator legs ran.
- `running` for more than 15 minutes without a saved QueryRun: return `review_required`; do not
  retry until an operator reconciles downstream evidence.
- `failed`: return the terminal safe error; never automatically spend again.

Callers can poll `GET /api/agent/ask?queryId=a2a_<sha256>` after losing a response. The endpoint is
read-only and cannot start or retry research.

## Failure policy

- No payment signature: return the body-dependent 402 challenge; no DB write or research.
- Verify/settle rejected: no order and no downstream spend.
- Settlement confirmed, ledger/order write fails: return the `PAYMENT-RESPONSE` settlement proof on
  the 5xx. A replay can safely finish missing idempotent records.
- Process loss before claim: the order remains queued and another worker may claim it exactly once.
- Process loss after claim: do not automatically rerun. A partial downstream settlement is more
  harmful than a stuck order; polling exposes `review_required` after 15 minutes and operations
  must reconcile evidence first.
- Creator accounting exceeds the prepaid cap by even one micro-USDC: fail closed and do not publish
  a misleading pricing receipt.

## Release gate

Any A2A money-path change requires:

1. Pricing boundary and integer-rounding tests.
2. Replay, concurrent claim, tuple-mismatch, terminal CAS, and response-loss tests.
3. Existing x402 verify/settle and API-key/rate-limit regression tests.
4. Full Vitest suite, TypeScript, ESLint, contract tests, and Next production build.
5. `$keryx-review` across route → x402 server → DB order → treasury gateway → creator settlement.
6. Commit/push, green CI, health-gated production deploy, exact live commit verification, then a
   product (not traction) Canteen update.
