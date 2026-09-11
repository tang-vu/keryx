# Testnet economics observatory

Keryx measures unit economics on Arc testnet before proposing a mainnet fee. The observer is
read-only: it cannot authorize, settle, retry, release, or relabel a payment.

## What is measured

- `fundingOwner` is stamped by the trusted server execution path as `browser`, `treasury`, or
  `offline`. It is not accepted from a public request body.
- Each provider response contributes token counters only: engine, wire model, input tokens, cached
  input tokens, and output tokens. Prompts, completions, provider bodies, and request ids are not
  stored. Locally generated random call IDs correlate each usage record with its model call;
  pending, returned and failed calls carry no request content.
- Settled inbound x402 payments are observed gross receipts on testnet. Settled creator payments
  are split by their run's funding owner. Pending payments stay outside settled totals.
- A2A v2 orders split the settled all-in package into its fixed service fee, prepaid creator cap,
  actual creator spend, and completed unused reserve. Covered creator spend is not called a
  treasury subsidy; pre-v2 A2A history remains unknown rather than being retroactively reclassified.
- Runs and payments from before this telemetry remain unknown/unsampled. They are never backfilled
  from weak assumptions.

The snapshot is internal operational telemetry. Since v0.22.59, the former public
`GET /api/economics` returns 410 without reading the database, and `/status` no longer
fetches or renders it. Actual usage-derived cost estimates and margins, as well as
invoices and realized costs/profit, stay private. Public formulas and explicitly
illustrative scenarios remain available at `/economics`. A simulation label alone
does not make internal operating data suitable for publication.

## Private operator report

Run from the deployed repository on the Linux operator host, loading its environment
explicitly. Prepare an owner-only parent directory outside the web root and public
artifact paths, then choose a new destination for each report:

```sh
install -d -m 700 /root/keryx-private-reports
node --env-file=.env.local --import tsx --no-warnings scripts/economics-private-report.mts \
  --directory /root/keryx-private-reports/REPLACE_WITH_NEW_REPORT_NAME
```

The destination must not exist. The command writes `economics.json` with mode 0600 in
a mode-0700 directory, verifies the file and syncs it before reporting success. Console
output contains no operational figures. Do not publish the file or attach it to Canteen
or GitHub. Failed/partial destinations remain in place and are never overwritten; inspect
them privately before choosing a different new destination. Windows mode bits are not
treated as ACL protection, so this command refuses Windows execution.

SQLite reads the existing `data/keryx.sqlite` in read-only mode; it cannot create a
missing database or run schema/cache migrations. A configured Supabase adapter also
skips initialization and uses its existing read methods. Missing schemas or configuration
fail the report rather than being repaired by this command. No signer or payment path
is called. Supabase reads can use the configured network connection.

Coverage is the legacy `query_runs`, `payment_events` and `a2a_orders` aggregation,
not every private-job store or an atomic cross-table accounting snapshot. The file
preserves unpriced usage and explicitly sets provider invoices, fixed operating costs
and realized profit to unknown. It is not an invoice audit, monthly profit statement
or mainnet revenue report. Public formulas remain separate at `/economics`.

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
unknown rates, failed provider attempts and missing usage coverage. Each actual model call must
match exactly one usage record by local ID and engine. A reasoning step may make several calls,
including a second synthesis evidence review; a caught review error still makes coverage unknown.
Circuit-open attempts did not call the provider. Failed attempts
remain conservatively unpriced even when some usage was recorded, since this is not a billing audit.
New compact database projections preserve `usageCoverage` and `usageCoverageVersion: 2`, not call
or attempt traces. Historical projections, including earlier complete classifications without
version 2, remain unpriced; they are not silently backfilled. This can lower the priced-run count
after deployment without removing any recorded usage or payment history.
Token totals still describe recorded responses, not all attempted or billable calls. Costs and shadow
margin are partial totals for eligible runs only, never a whole-service profit claim.

The compatible-provider transport records usage only with explicit nonnegative safe integer input
and output counts. Optional cached input defaults to zero only when absent; supplied cached counts
must be valid and no larger than total input. Empty, partial or malformed usage remains absent,
without turning an otherwise valid answer into a provider failure. Actual engine regression tests
cover this boundary, HTTP rejection and billable truncated responses followed by local fallback.

This is a testnet experiment, not accounting guidance, mainnet readiness, or permission to use real
funds. Any future fee collection needs a separate authority/security design and explicit approval.
