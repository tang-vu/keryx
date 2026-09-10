# Testnet economics observatory

Keryx measures unit economics on Arc testnet before proposing a mainnet fee. The observer is
read-only: it cannot authorize, settle, retry, release, or relabel a payment.

## What is measured

- `fundingOwner` is stamped by the trusted server execution path as `browser`, `treasury`, or
  `offline`. It is not accepted from a public request body.
- Each provider response contributes token counters only: engine, wire model, input tokens, cached
  input tokens, and output tokens. Prompts, completions, provider bodies, and request ids are not
  stored.
- Settled inbound x402 payments are observed gross receipts on testnet. Settled creator payments
  are split by their run's funding owner. Pending payments stay outside settled totals.
- A2A v2 orders split the settled all-in package into its fixed service fee, prepaid creator cap,
  actual creator spend, and completed unused reserve. Covered creator spend is not called a
  treasury subsidy; pre-v2 A2A history remains unknown rather than being retroactively reclassified.
- Runs and payments from before this telemetry remain unknown/unsampled. They are never backfilled
  from weak assumptions.

The public snapshot is `GET /api/economics`; `/status` renders the same data under an explicit
“simulation · not revenue” label.

## Pricing policy

Policy `testnet-economics-v1` uses DeepSeek prices captured on 2026-08-29 from the
[canonical pricing page](https://api-docs.deepseek.com/quick_start/pricing). A model is priced only
when both its provider identity and exact wire model match the table. MiMo, Anthropic, and unknown
models remain unpriced until a verified rate is added; their measured tokens still appear.

The shadow service price is deliberately separate from creator pass-through:

- Quick: $0.02 USDC orchestration fee
- Deep: $0.05 USDC orchestration fee
- Infrastructure allowance: $0.005 per sampled run
- Shadow gross margin: service fee − priced LLM cost − infrastructure allowance

The shadow comparison assumes 1 USDC = $1 for planning; it does not measure market depeg risk.

Creator fetch tolls and citation rewards are not margin. Browser-funded creator spend passes
through; treasury-funded creator spend is a subsidy. Shadow fees are hypothetical and are never
charged by this feature.

## Reading the snapshot

`pricedRuns` is the only denominator eligible for estimated LLM cost and shadow margin. An empty
usage list can be priced at zero tokens only with explicit heuristic execution evidence and no
failed provider attempts. A missing usage list is historical and unsampled. `unpricedRuns` includes
unknown rates, failed provider attempts and missing usage coverage. Served provider attempts must
match response counters per engine; circuit-open attempts did not call the provider. Failed attempts
remain conservatively unpriced even when some usage was recorded, since this is not a billing audit.
New compact database projections preserve only a `usageCoverage` classification, not attempt traces.
Historical projections without this evidence remain unpriced; they are not silently backfilled.
Token totals still describe recorded responses, not all attempted or billable calls. Costs and shadow
margin are partial totals for eligible runs only, never a whole-service profit claim.

The compatible-provider transport records usage only with explicit nonnegative safe integer input
and output counts. Optional cached input defaults to zero only when absent; supplied cached counts
must be valid and no larger than total input. Empty, partial or malformed usage remains absent,
without turning an otherwise valid answer into a provider failure. Actual engine regression tests
cover this boundary, HTTP rejection and billable truncated responses followed by local fallback.

This is a testnet experiment, not accounting guidance, mainnet readiness, or permission to use real
funds. Any future fee collection needs a separate authority/security design and explicit approval.
