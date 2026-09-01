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
          |                                               |
          |                                               +-- stale, saved real QueryRun
          |                                               |      --> audited repair --> completed
          |                                               |
          |                                               +-- stale, no QueryRun, journal v1,
          |                                                   no creator-payment boundary
          |                                                      --> audited close --> failed
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
- `failed`: return the terminal safe error plus current creator-payment economics and any sanitized
  operator resolution; never automatically spend again. If the payment boundary was crossed
  without a complete QueryRun, recorded creator amounts are labeled a lower bound and unused
  reserve is `null`, never inferred from an incomplete ledger.

Callers can poll `GET /api/agent/ask?queryId=a2a_<sha256>` after losing a response. The endpoint is
financially read-only: it cannot start/retry research or create payment attempts. It may perform
the audited terminal metadata repair when the same order already has a saved real QueryRun.

## Failure policy

- No payment signature: return the body-dependent 402 challenge; no DB write or research.
- Verify/settle rejected: no order and no downstream spend.
- Settlement confirmed, ledger/order write fails: return the `PAYMENT-RESPONSE` settlement proof on
  the 5xx. A replay can safely finish missing idempotent records.
- Process loss before claim: the order remains queued and another worker may claim it exactly once.
- Process loss after claim: do not automatically rerun. A partial downstream settlement is more
  harmful than a stuck order; polling exposes `review_required` after 15 minutes and operations
  must reconcile evidence first.
- Before every creator gateway call, journal-v1 orders durably set `payment_started_at`. Failure to
  store that checkpoint aborts the call before signing/submission. Historical rows are never
  backfilled into this negative-evidence guarantee.
- Immediately before QueryRun persistence, journal-v1 orders durably set `result_saving_at`.
  Operator close and result saving therefore form a same-order CAS race: whichever commits first
  prevents the other, including for long no-payment runs.
- A saved QueryRun is deliverable only when its real-mode settled+pending creator total equals the
  durable ledger's settled+pending+failed total. A lost payment row blocks metadata repair.
- Creator accounting exceeds the prepaid cap by even one micro-USDC: fail closed and do not publish
  a misleading pricing receipt.

## Operator resolution runbook

The operator tool addresses one exact order and is read-only unless an explicit action plus a
duplicate exact-id confirmation is supplied. Its output omits question, payer/payee, transaction,
authorization, and worker identity.

```bash
# 1. Inspect only. Start here.
npm run review:a2a -- a2a_<64-lowercase-hex>

# 2a. A saved real QueryRun exists: repair terminal metadata only.
npm run review:a2a -- a2a_<id> --repair --confirm a2a_<id>

# 2b. No QueryRun exists and journal v1 proves no creator gateway call began: close without retry.
npm run review:a2a -- a2a_<id> --close-failed --confirm a2a_<id>
```

Decision table:

| Inspection evidence | Allowed action |
|---|---|
| `savedRealQueryRun=true` and QueryRun totals exactly match the ledger | `--repair`; reconstructs the response and performs one terminal CAS |
| Both payment/result-save boundaries are false, `executionJournalVersion=1`, no QueryRun, zero creator attempts | `--close-failed` |
| `resultSaveBoundaryCrossed=true` with no saved QueryRun yet | No terminal close; persistence may still be in flight or require datastore review |
| `paymentBoundaryCrossed=true` | No terminal close; a missing payment row is still possible, so keep under review |
| `executionJournalVersion=null` | No terminal close; historical rows have no trustworthy negative proof |
| `pendingUsdc>0` | No terminal close; run the normal Circle reconciliation and inspect again |
| `simulatedUsdc>0` | No resolution; treat as a paid-mode integrity incident |
| recorded settled + pending exceeds creator cap | No resolution; treat as an economic invariant incident |
| queued, processing under 15 minutes, completed, or failed | No mutation |

Neither command calls `collectRun`, signs a payment, changes `payment_events`, refunds, or promotes a
pending payment. Do not manually reset `started_at`, change status, run the A2A client with the old
question, or create a second authorization as “recovery.” If a pending Circle attempt later becomes
definitive, financial truth changes through the existing reconciliation job, not this runbook.

After resolution, poll the public `queryId` and check `/api/health`. `a2aJobs` contains only aggregate
counts, 24-hour completion/failure rates, oldest queue/processing ages, and p50/p95 completed-job
latency. Health becomes `degraded` when any order needs review or the oldest queued order exceeds
two minutes; this is an operator signal, not a liveness failure.

## Release gate

Any A2A money-path change requires:

1. Pricing boundary and integer-rounding tests.
2. Replay, concurrent claim, tuple-mismatch, terminal CAS, and response-loss tests.
3. Operator repair/close, stale boundary, pending/simulated refusal, private-data omission, queue
   SLA, and recent latency tests.
4. Existing x402 verify/settle and API-key/rate-limit regression tests.
5. Full Vitest suite, TypeScript, ESLint, contract tests, and Next production build.
6. `$keryx-review` across route → x402 server → DB order → treasury gateway → creator settlement.
7. Commit/push, green CI, health-gated production deploy, exact live commit verification, then a
   product (not traction) Canteen update.
