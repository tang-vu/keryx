# Testnet economics observatory

Keryx measures unit economics on Arc testnet before proposing a mainnet fee. The observer is
read-only: it cannot authorize, settle, retry, release, or relabel a payment.

## What is measured

- `fundingOwner` is stamped by the trusted server execution path as `browser`, `treasury`, or
  `offline`. It is not accepted from a public request body.
- Each provider response contributes engine, wire model, input tokens, cached
  input tokens, and output tokens. New compatible-provider observations also capture local request
  start/response timestamps, configured provider identity and the immutable observed pricing policy
  when recognized. These timestamps are not the supplier's billing timestamps. Prompts,
  completions, provider bodies, credentials and provider request ids are not
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

New files use `keryx-private-economics-v2`. They export cost and shadow margin
**bounds for priced runs only**, unknown-cache coverage and captured policy IDs.
They do not contain per-call prompts or supplier response bodies. A missing bound
is `null`, not measured zero. `totalLlmCostUpperBoundUsd` remains `null`: the store
projection omits unsampled history, and the report cannot establish a finite
whole-period LLM bill from partial records. Saved v1 reports are never edited,
reclassified or overwritten; choose a new directory for a v2 report.
`shadowServiceFeesAllSampledUsdc` covers every sampled run, including unpriced runs;
`shadowServiceFeesPricedRunsUsdc` covers the same priced cohort as the cost/margin
bounds. These hypothetical fees are not settled revenue. The export's
`costAndMarginScope` applies to the bounds, not the separate all-sampled fee total.

## Pricing policy

Observer `testnet-economics-v2` prices only new usage carrying a recognized
per-call capture. The policy `deepseek-flash-observed-2026-09-30-v1` preserves
the [supplier page](https://api-docs.deepseek.com/quick_start/pricing/) checked on
September 30, with date precision. Its USD per million token rates are:

| Flash input/output | Off-peak lower estimate | Peak upper estimate |
| --- | --- | --- |
| Cached input | 0.003 | 0.006 |
| Uncached input | 0.15 | 0.30 |
| Output | 0.60 | 1.20 |

The supplier identifies `deepseek-flash`, `deepseek-v4-flash` and
`deepseek-v4-flash-vision-exp` as names served by DeepSeek V4.1 Flash. Each capture
preserves the requested wire name and that observed billing family. This update
does not change the model sent to the provider. Unknown providers/models and Pro
remain unpriced; conflicting supplier Pro descriptions require separate review.

Both rate endpoints are retained in each capture. The observer always uses the
off-peak–peak interval instead of guessing the applicable billing hour, holiday
calendar or supplier processing time. Supplier effective dates remain `null`;
the verification date is not presented as a tariff effective date. The local
request timestamps do not prove billing-window selection. Later supplier checks
need new policy IDs; existing policy entries and recorded captures retain their
original rates and aliases. Unknown/malformed policy captures remain unpriced.

The August 29 `testnet-economics-v1` policy and rates are retained as a historical
scenario only. Untagged old usage has no recoverable per-call policy and is now
unpriced, even if its wire name matches a current alias. Report time, query time
and old token counts cannot silently supply that missing evidence. Saved v1
artifacts retain their original meaning; generating a new v2 report does not
retroactively establish actual historical provider expense.

The shadow service price is deliberately separate from creator pass-through:

- Quick: $0.02 USDC orchestration fee
- Deep: $0.05 USDC orchestration fee
- Infrastructure allowance: $0.005 per sampled run
- Shadow gross margin interval: service fee − priced LLM cost interval − infrastructure allowance

The shadow comparison assumes 1 USDC = $1 for planning; it does not measure market depeg risk.

Creator fetch tolls and citation rewards are not margin. Browser-funded creator spend passes
through; treasury-funded creator spend is a subsidy. Shadow fees are hypothetical and are never
charged by this feature.

## Reading the snapshot

`pricedRuns` is the only denominator eligible for estimated LLM cost and shadow margin
intervals. Cost lower/upper bounds use the captured lower/upper rates; margin lower
uses the upper cost and margin upper uses the lower cost. Display rounding expands
the interval to micro-dollar precision. These are partial sums, not a finite
whole-period cost ceiling, reconciled invoice or realized profit. The infrastructure
allowance is a planning assumption rather than a measured bill. An empty
usage list can be priced at zero tokens only with explicit heuristic execution evidence and no
failed provider attempts. A missing usage list is historical and unsampled. `unpricedRuns` includes
unknown rates/capture, uncertain cache splits, failed provider attempts and missing usage coverage. Each actual model call must
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
and output counts. DeepSeek's [nested cached count and top-level hit/miss counts](https://api-docs.deepseek.com/api/create-chat-completion/)
must agree when present and remain valid safe integers within total input. One valid
split representation is sufficient; a valid miss count determines the corresponding
hit count. An absent, malformed or conflicting split is retained as `cachedInputTokens: null`
with valid input/output counts, not fabricated zero. `unknownCacheCalls` counts these
responses, and `cachedInputTokens` totals only known splits. Otherwise-valid answers
remain usable. Empty, partial or malformed total input/output usage remains absent.
Actual engine regression tests
cover this boundary, HTTP rejection and billable truncated responses followed by local fallback.

This is a testnet experiment, not accounting guidance, mainnet readiness, or permission to use real
funds. Any future fee collection needs a separate authority/security design and explicit approval.
