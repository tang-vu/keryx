# Experimental Cloudflare Workers AI provider

## GPT-OSS 120B manual choice (October 8, 2026, v0.27.40 candidate)

The owner requested one additional experimental model, `@cf/openai/gpt-oss-120b`.
Its new public ID is `cloudflare-gpt-oss-120b` (OpenAI surface:
`keryx:cloudflare-gpt-oss-120b`). The retired bare `gpt-oss-120b` ID retains its
existing DeepSeek mapping, so saved clients do not silently change processors.
Enable the existing Cloudflare provider and separately set
`KERYX_CLOUDFLARE_GPT_OSS_ENABLED=true` after direct vendor acceptance. Missing or
nonliteral flags and credentials keep the new choice out of both model APIs and
runtime selection. DeepSeek remains the default, MiMo its existing alternate,
and Llama the automatic Cloudflare tier. GPT-OSS requires an explicit choice.

The [official model page](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
documents 128,000 tokens and a gross tariff of $0.35/M input and $0.75/M output.
Keryx conservatively bounds actual UTF-8 prompt bytes plus requested output at
120,000, with the existing 8,192-token output ceiling, and requests low reasoning
effort. Llama retains its 23,000-unit ceiling. Neither model truncates evidence
to fit. The new immutable price capture is dated October 8; historical Llama and
DeepSeek captures remain unchanged. Free quota, cached billing and invoices are
not measured by a capture; this is a gross estimate, not billed cost.

The shared [JSON Mode page](https://developers.cloudflare.com/workers-ai/features/json-mode/)
does not explicitly list GPT-OSS despite `response_format` on its model schema.
Direct English/Vietnamese JSON, decision, quote-review and usage acceptance is
therefore a release gate, not inferred from catalog support. The synthetic harness
accepts `npm run eval:cloudflare -- --model cloudflare-gpt-oss-120b`, uses no source
payments or database writes, makes at most six direct calls without fallback, and
saves separate ignored GPT-OSS evidence. Invocation requires a current finite
supplier allowance; old closed smoke/trial authority cannot be reused.

The ordinary scheduled `check-llm` excludes this manual experimental choice.
An explicitly invoked `npm run check-llm -- --include-experimental` may include
it under its own applicable allowance. No new schedule or automatic retry is added.
Buyer-approved private jobs and finite Operator canaries retain their pinned
providers/models and do not admit this choice. Rich decision briefs are not
enabled for GPT-OSS. The existing picker now says **DeepSeek Flash**, because
the accepted `deepseek-v4-flash` wire alias currently serves V4.1 Flash according
to [DeepSeek](https://api-docs.deepseek.com/en/). Wire names and active local/hosted
environment files remain preserved during the original Operator source window.

Shared web, embed, public API/OpenAI, remote MCP, A2A and bots inherit the hosted
catalog/engine. The local ask CLI supports the new explicit ID when configured.
Stdio/buyer MCP, buyer CLI, desktop/Operator and extensions retain their existing
hosted-client/task/payment roles; their package bytes and contracts are unchanged.
No client installer/package publication is required for identical artifacts.
Final CI/review, direct acceptance, coordinated original-safe merge/deploy,
environment enablement and `/api/models` plus `/api/health` readbacks remain gates.

Keryx can use Cloudflare-hosted Llama 3.3 70B FP8 fast as an optional third public reasoning
provider. DeepSeek remains the default. A healthy DeepSeek response does not send a request
to Cloudflare. The shared model picker also offers `cloudflare-llama-3.3` when enabled and
configured; OpenAI-compatible callers may use `keryx:cloudflare-llama-3.3`.

## Configuration and privacy

Create an API token restricted to **Workers AI Write** on the intended account. Store it only
in a private server environment file. Interactive `cf` or Wrangler OAuth/refresh credentials
are suitable for local account operations, not production configuration. No Worker/proxy or
new SDK is required. Set:

```dotenv
KERYX_CLOUDFLARE_ENABLED=true
CLOUDFLARE_ACCOUNT_ID=<32 lowercase hexadecimal characters>
CLOUDFLARE_API_TOKEN=<restricted API token>
KERYX_LLM_PROVIDER_ORDER=anthropic,deepseek,mimo,cloudflare
```

The enable flag must be exactly `true`; missing credentials or an invalid account identifier
leave the provider unavailable. An explicit provider order is an allowlist: omitted providers
remain disabled. Keep any intentional existing order when adding the final Cloudflare tier.
The model and official API host are pinned; account identifiers cannot inject paths or URLs.
Restart the process after changing its environment. `npm run check-llm` uses the same model
construction as runtime and independently probes enabled models without hidden fallback.

Public research can send questions, source previews and gathered excerpts to the enabled
provider. Its identity remains in run/attempt/usage metadata. Cloudflare says it does not train
models on customer content without consent ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)).
The private pilot continues to accept only its existing DeepSeek/MiMo policies, with the
buyer-disclosed endpoint and local heuristic fallback. Enabling this public provider never
changes that private consent or routes private jobs to Cloudflare.

## Bounds, quota and economics

The [documented model context](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
is 24,000 tokens (rechecked October 5, 2026). Keryx refuses a request before HTTP when its
UTF-8 prompt bytes plus requested output exceed 23,000, conservatively reserving framing
headroom. Its existing per-step output ceilings stay at or below 8,192 tokens. This is a local
bound, not a supplier promise about output quality. Evidence is never silently truncated to fit.
Eligibility is checked against the actual constructed step prompt, including every research
target, candidate metadata, budget, memory and the existing preview bounds. A configured tier
is not a promise that a large `decide` payload fits. Oversized requests visibly bypass this tier
as `input-limited` / `input_limit`, recording only UTF-8 byte count, requested output tokens
and the conservative 23,000-unit ceiling. The refusal creates no supplier HTTP request or
call-ledger entry. No targets/candidates are removed and no billable batch fanout is added.
Local preflight refusal does not mark the supplier unhealthy or clear prior supplier failures.
If refusal occurs after acquiring a half-open probe, that bounded probe lease expires normally;
it is not recorded as supplier success. Upstream HTTP 400/413/422 remains a recorded failed
request, but does not poison the provider-step circuit for unrelated clients. Output/schema
validation and truncated JSON likewise degrade only that request without identical paid retries.
Requests use nonstreaming JSON mode, the existing timeout and shared durable provider/step
circuits; redirects are prohibited. Known transport outages, deadlines, quota errors, 5xx and
401/403/404 configuration failures can affect shared circuits. Unknown application exceptions
are `internal`, never inferred to be network failures. The existing last-provider retry policy
makes at most three calls for retryable supplier failures; a full timeout advances immediately.
The final tier is visibly the local heuristic. Payment enforcement remains outside the model.

Workers AI currently includes 10,000 Neurons per day on its free plan; exhaustion stops
inference until reset. Keep this deployment on that plan. Keryx does not upgrade the account,
purchase quota or treat unrelated paid R2/Images subscriptions as Workers AI billing authority.
Other account workloads share the allowance; Keryx has no measured remaining-Neuron counter.
Operators considering paid Workers AI must make a separate explicit billing/spend decision.
See [current pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

The dated capture `cloudflare-llama-3.3-observed-2026-10-02-v1` records the published gross
tariff: $0.293/M input tokens and $2.253/M output tokens. Reports label token costs as estimates.
This does not establish billed cost: free daily allowances and invoices are unknown. Missing
usage remains unknown. Missing cache split does not prevent a gross estimate for this tariff
because cached and uncached input have the same captured rate; the usage record still says
the split is unknown. Historical DeepSeek captures retain their original policy and rates.

## Smoke evidence and remaining gate

On October 2, 2026, direct calls through the official endpoint passed two small public synthetic
fixtures using Keryx's actual prompts and parsers:

| Fixture | Accepted behavior | Calls | Time | Reported input/output tokens |
| --- | --- | --- | --- | --- |
| English Cedar | BUY relevant price, CACHE delivery, SKIP unrelated; correct facts, both citations and reviewed source quotes | 3 | 11.385s | 1,799 / 362 |
| Vietnamese Cedar | Two requested targets; BUY relevant price; SKIP expensive duplicate and instruction-injecting unrelated preview; complete coverage with valid markers | 3 | 12.759s | 1,847 / 431 |

The retained six calls imply a gross tariff estimate of $0.002855367, not a bill. An earlier
three-call Vietnamese attempt completed inference but a harness field-name mistake prevented
retaining its results/usage. Its usage is unknown and excluded from the retained estimate;
nine calls actually occurred. A necessary bounded rerun fixed the harness. These are smoke
checks, not real customer traction, source purchases, broad quality parity or a measured SLA.
Re-evaluation, attribution, long corpora and representative full research runs remain broader
evaluation work before considering default promotion. DeepSeek remains primary.

The reproducible harness uses only these synthetic fixtures, direct engine construction,
at most six requests and 512 requested output tokens per request. It saves partial evidence
even when validation fails and never catches provider failure by substituting another model:

```powershell
# Private .env.cloudflare.local supplies the account-restricted credential.
npm run eval:cloudflare
```

Results go to ignored `.artifacts/cloudflare-smoke.json`. This command performs live inference;
it is not part of hermetic CI. Ordinary tests cover opt-in/credential gates, multilingual context
refusal before HTTP, redirect policy, tariff tampering, third-tier failover, primary avoidance,
quota degradation and private-provider isolation.

## Supported surfaces and release boundary

Web and public API reasoning use the shared catalog and engine chain, including `/api/models`,
SSE asks and OpenAI-compatible model IDs. Hosted remote MCP, public A2A and bots inherit the
server chain. The local research CLI uses the shared engine when its process is configured.
Repository stdio MCP and distributed MCP remain caller-funded clients of the hosted service;
they inherit its provider chain rather than running a local reasoning engine. Operator,
desktop and extension retain their existing request/payment roles; none receive server credentials or
new signing authority. Private workers retain their separate approved provider policy.

This is app/server release 0.24.9. Standalone MCP 0.3.0, Operator 0.3.1 and extension 0.1.1
distribution versions remain unchanged because their client code and contracts are unchanged.
An app deploy does not prove newly published npm packages or installers. Verify the production
commit through `/api/health` and the server package separately before claiming this is live.
