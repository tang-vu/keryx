# Ordinary research model costs

`deepseek-flash` remains the default. `deepseek-v4-pro` still selects Pro for
the complete ordinary pipeline. The explicit `deepseek-balanced` choice uses
Flash for planning, source selection, coverage, re-evaluation and attribution,
and Pro for synthesis and its separate evidence review. The web picker and
`/api/models` expose the catalog label and routing note. Ordinary API, CLI and
remote MCP callers can select `deepseek-balanced`; the OpenAI-compatible model
list uses `keryx:deepseek-balanced`. These adapters forward the catalog ID to the
same ordinary selector. Fixed desktop/stdio MCP handoffs keep their existing roles.
Each lane keeps the existing configured provider fallbacks and circuit policy;
run usage and attempt metadata identify the actual serving models.

The balanced choice does not rewrite already-admitted private, finite-canary or
bounded-production originals. Their pinned model/endpoint, recipient, fallback,
attention and payment authority remain fixed. The ordinary picker is not the
authority for those independently bound policies. Automatic supplier watchdogs
exclude the manual balanced option.

Ordinary engines reuse only their last successful provider coverage assessment
when the complete input is byte-identical within the same fixed engine instance.
The key covers the question, ordered targets and gathered source contents and
metadata. Changing a byte, a version or a target requires a fresh assessment.
Results are defensively cloned; engines never share this cache between runs.
The cache sits outside the provider circuit, so reuse creates no new provider
attempt or health success. A heuristic fallback after a failed supplier is not
cached. Direct fixed-model engines do not opt in, so retained original prompts and
fulfillment call sequences retain their existing behavior. Errors are not cached.
This avoids a duplicate model request; it does not skip evidence review or grant
new citation, purchase or payout authority.

New provider usage and local call-ledger records carry an application-assigned
stage: planning, selection, coverage, re-evaluation, synthesis, evidence review
or attribution. The existing private economics export includes per-stage token
and captured-price cost bounds, failed/pending calls and missing usage. History
without a stage is `unassigned`; missing costs stay unknown. Partial estimates
are not supplier invoices or realized margin. No prompts or answers are added
to the accounting metadata.

## Validation and operating limits

Use hermetic HTTP fixtures to verify routing, actual-model attribution, unchanged
review gates, cache invalidation and failed-call accounting. Compare serialized
requests and provider call counts; do not label these synthetic token amounts as
measured vendor savings or quality parity. Live quality/cost evaluation needs an
existing explicitly bounded supplier allowance. This change creates no funding,
schedule, budget renewal, deployment or automatic paid-model escalation.

Service fees, creator budgets, source tolls and accepted paid work are unchanged.
Per-job compute admission and new pricing remain separate changes requiring
their own reviewed policy; the staged cost data makes that decision measurable.

## Architecture rationale

Expose balanced model routing as an explicit new choice rather than silently
changing the meaning of an existing Pro selection. Keep default Flash and fixed
private/bounded originals. Reuse only exact request-local coverage results and
record model cost by application stage, including unknown/failed work.
