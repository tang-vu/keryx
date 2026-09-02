# Versioned A2A Research Packages

Keryx publishes the exact execution contract an external agent buys at `POST /api/agent/ask`.
These packages are available on Arc testnet. Version `1.0.0` is an immutable snapshot; changing an
execution limit, measurement rule, target, or remedy requires a new version.

## Package 1.0.0

| Package | Research mode | Attention limit | Re-evaluation rounds | Provisional target |
|---|---:|---:|---:|---:|
| `keryx-quick` | Quick | 2 | 0 | 180,000 ms from acceptance |
| `keryx-deep` | Deep | 4 | 1 | 300,000 ms from acceptance |

An attention slot bounds how many BUY/CACHE candidates can enter synthesis. It is not a promise
that Keryx will buy that many sources: budget, source authority, preview quality, cache validity,
delivery, evidence, and payment checks can all reduce the selected set. The caller controls the
creator-spend cap but cannot raise these execution limits through the public body.

Both packages declare:

```json
{
  "serviceLevel": {
    "kind": "provisional_slo",
    "startsAt": "accepted_at",
    "remedy": "none"
  },
  "quality": {
    "measurement": "evidence-ledger-v1",
    "groundingThreshold": 0.4,
    "commitment": "best_effort"
  }
}
```

This is a measurable service objective, not a contractual SLA, uptime promise, or refund right.
The package price remains fixed and non-refundable under the current testnet terms.

## Pinning and execution

Send `"packageVersion":"1.0.0"` with the question. Keryx rejects unsupported versions with `409`
before x402 settlement. After settlement, the full package snapshot is stored on the private order
and its canonical SHA-256 fingerprint is included in the request hash. The sync path and async
worker receive execution limits from that accepted snapshot, not mutable environment defaults.
Package definitions remain in the trusted registry while accepted jobs or supported replays can
still reference them; selecting a new default must not make an older queued snapshot invalid.

A replay must match the same snapshot and economic tuple. Package mutation or private worker-input
mutation fails before creator spend. Rows created before versioning remain `null`; they are
delivered under their historical semantics and never labeled package `1.0.0`. An already-paid
legacy queued row can drain through its original hash/default-policy compatibility lane, but it
cannot acquire v1 execution limits or a v1 service receipt.

## Buyer-visible measurements

Queued, processing, and review-required responses include `serviceStatus`: acceptance/start times,
elapsed time, the target deadline, and whether it has been breached.

A completed response includes `serviceReceipt` with:

- queue, execution, and end-to-end duration;
- the target and whether the successful result arrived within it;
- claim count, measured and grounded claims, grounded-claim rate, qualifying evidence count,
  rewarded citation count, and confidence;
- a link to the full portable evidence and settlement receipt.

Quality is `measured` only when the complete ordered claim-coverage ledger matches the decomposed
claims. Otherwise its rate is `null` and status is `unavailable`. A failed order reports timing and
`targetMet:false`; it never fabricates a quality score.

## SLA promotion gate

Do not rename these objectives to an SLA until each package has, at minimum:

1. four consecutive weeks of genuine external paid use;
2. at least 30 terminal external orders, excluding Keryx's own volume engine;
3. published completion, within-target, evidence-coverage, and settled unit-economic results;
4. no unresolved `review_required` queue at the decision point;
5. named support ownership plus reviewed terms and an explicit service-credit/remedy policy.

The first production sample is too small for a credible commitment. Measurement starts with v1;
the data decides whether its targets should be retained, revised in v2, or promoted later.

## Protocol notes

Keryx uses HTTP `Prefer: respond-async` as the standards-based async opt-in and x402 v2 discovery
metadata for the paid resource. `serviceStatus` and `serviceReceipt` are Keryx response fields; they
do not alter Circle settlement proof. The x402 offer/receipt extension is still evolving, so v1
does not overload it with service-quality semantics. This is an agent-to-agent paid API, not a claim
of full A2A Agent Card and task-protocol compatibility.

- [HTTP Prefer (RFC 7240)](https://www.rfc-editor.org/rfc/rfc7240)
- [A2A Protocol specification 0.3.0](https://a2a-protocol.org/v0.3.0/specification/)
- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 offer and receipt extension](https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md)
