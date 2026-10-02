# Experimental Cloudflare Workers AI provider

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

The documented model context is 24,000 tokens. Keryx refuses a request before HTTP when its
UTF-8 prompt bytes plus requested output exceed 23,000, conservatively reserving framing
headroom. Its existing per-step output ceilings stay at or below 8,192 tokens. This is a local
bound, not a supplier promise about output quality. Evidence is never silently truncated to fit.
Large research contexts can therefore bypass this experimental tier through visible failure.
Local preflight refusal does not mark the supplier unhealthy or clear prior supplier failures.
If refusal occurs after acquiring a half-open probe, that bounded probe lease expires normally;
it is not recorded as supplier success. An upstream HTTP 413 remains a supplier failure.
Requests use nonstreaming JSON mode, the existing timeout and shared durable provider/step
circuits; redirects are prohibited. Truncated JSON and quota errors remain failures. The
existing last-provider retry policy makes at most three calls, then visibly degrades to the
local heuristic. Payment enforcement remains outside the model.

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
server chain. The local research CLI and repository stdio MCP use the same shared engine when
their process is configured. Operator/desktop/extension and distributed caller-funded MCP
clients retain their existing request/payment roles; they do not receive server credentials or
new signing authority. Private workers retain their separate approved provider policy.

This is app/server release 0.24.9. Standalone MCP 0.3.0, Operator 0.3.1 and extension 0.1.1
distribution versions remain unchanged because their client code and contracts are unchanged.
An app deploy does not prove newly published npm packages or installers. Verify the production
commit through `/api/health` and the server package separately before claiming this is live.
