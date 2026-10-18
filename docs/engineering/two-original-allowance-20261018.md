# Fresh allowance for the two original homepage questions

On 2026-10-18 the owner explicitly allowed one attempt at each original homepage
question, up to USD 1 in total ("Cho phép, tối đa 1 USD"). The October 4 model-only
and October 5 research authorities remain closed. This change adds a distinct
`keryx-production-research-allowance-v3` policy; it does not renew either old policy.
The app remains 0.27.80. ROOT owns final CI acceptance, activation, the combined
deployment, and the two actual runs. No live model, search or payment call was made
while implementing or testing this policy.

## Exact authority and tariff ceiling

The accepted interval is from the fresh task record, `2026-10-18T13:13:25.659Z`,
through **before** `2026-10-19T03:30:00Z` (10:30 Vietnam). This deliberately permits
the authorized interval across UTC midnight, while both historical date checks
retain their existing behavior. The strict schema freezes the two hashes below,
46 global model requests, 4 global basic-search requests, at most 2 searches per
original, and zero source/reward USDC. Changing the question by even one byte,
replacing a question, adding a third question or retrying a consumed question is
refused. Failed, uncertain, interrupted and empty request holds consume capacity.

| Original question | SHA-256 of exact UTF-8 question |
| --- | --- |
| Compare SQLite WAL and rollback journals for a small web application. What are the concurrency and operational tradeoffs? | `19e8e4e3f09ff0d5a8d8ffb64688f8c19b41a789e45f0f5203f4059199e2ae34` |
| Compare English-language educational YouTube topic ideas for children ages 6–9. Distinguish evidence from assumptions and explain the limits of claims about audience demand. | `1f9cbcac9bd37d5dae615a1c09a817ba16f75207dd786042084e24eb59876d1f` |

The October 18 review uses the official
[DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) and
[API integration instructions](https://api-docs.deepseek.com/quick_start/agent_integrations/):
`deepseek-v4-flash` remains a supported alias, currently served by
DeepSeek-V4.1-Flash-1017, at peak uncached rates of USD 0.30 per million input
tokens and USD 1.20 per million output tokens. The fixed endpoint remains
`https://api.deepseek.com/chat/completions`. The conservative reservation is
`ceil((32000 + 4096) * 0.30 + 8192 * 1.20) = 20660` microUSD per request.
The existing 32,000-byte input check, 4,096-token framing allowance and 8,192-token
output maximum remain enforced before HTTP, without truncation or provider fallback.

[Tavily credit pricing](https://docs.tavily.com/documentation/api-credits) and
the official [search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search)
specify one credit for basic search and gross pay-as-you-go USD 0.008 per credit.
The fixed transport uses `https://api.tavily.com/search`, basic depth and
`auto_parameters:false`; each search reserves 8,000 microUSD. No cache, off-peak,
free-credit or negotiated discount is assumed. The total conservative ceiling is
`46 * 20660 + 4 * 8000 = 982360` microUSD, below the authorized 1,000,000.
This is a reservation ceiling, not a claim about an invoice or successful answer.

The evidence hashes identify canonical reviewed fact records (sorted JSON keys,
compact UTF-8 plus LF), not downloaded HTML. Their complete inputs are:

```json
{"cacheHitDiscountAssumed":false,"checkedOn":"2026-10-18","endpoint":"https://api.deepseek.com/chat/completions","framingTokens":4096,"legacyAliasAccepted":true,"maximumInputBytes":32000,"maximumOutputTokens":8192,"model":"deepseek-v4-flash","offPeakDiscountAssumed":false,"peakInputUsdPerMillion":0.3,"peakOutputUsdPerMillion":1.2,"provider":"deepseek","reservePerCallMicroUsd":20660,"servedModel":"DeepSeek-V4.1-Flash-1017","sources":["https://api-docs.deepseek.com/quick_start/pricing/","https://api-docs.deepseek.com/quick_start/agent_integrations/"]}
```

Model fact SHA-256: `66422ffcfa61f846b188904c93edf7a3bdcb4d68231c9084e20645eee19edacc`.

```json
{"checkedOn":"2026-10-18","creditsPerRequest":1,"endpoint":"https://api.tavily.com/search","freeCreditsOrDiscountAssumed":false,"grossPaygUsdPerCredit":0.008,"provider":"tavily","reservePerCallMicroUsd":8000,"searchDepth":"basic","sources":["https://docs.tavily.com/documentation/api-credits","https://docs.tavily.com/documentation/api-reference/endpoint/search"]}
```

Search fact SHA-256: `3b47f63bdf04897f26adfbe50fc384afef966d3b810d19e814682465c4f5a72e`.

## Materialization contract

`TWO_ORIGINAL_RESEARCH_REVIEW` and `TwoOriginalResearchAllowancePolicy` export the
supported v3 constants and type. ROOT must supply a **new, protected** journal
directory and policy file, retaining all old policies and journals. The existing
paired `KERYX_MODEL_ALLOWANCE_FILE` / `KERYX_MODEL_ALLOWANCE_SHA256` configuration
selects the bounded engine. Both keys absent preserve the ordinary provider chain;
one key missing, invalid policy, changed digest, expiry or exhausted authority
refuses without falling back. ROOT selected the existing reviewed-role argument
pair described in the [deployment guide](../deployment-guide.md#read-only-database-maintenance-mode):
both roles must carry the same protected policy path and digest; the separately
retained ENV file remains a COMMIT-only change. This document is not an activation
receipt and does not authorize restoring or running held workers.

The complete strict policy has this shape; the journal path is an operator-supplied
absolute private directory, not a usable example path:

```json
{
  "format": "keryx-production-research-allowance-v3",
  "policyId": "keryx-homepage-two-originals-2026-10-18-v3",
  "priceCheckedOn": "2026-10-18",
  "pricePolicyId": "deepseek-flash-reviewed-2026-10-18-v1",
  "modelEvidenceSha256": "66422ffcfa61f846b188904c93edf7a3bdcb4d68231c9084e20645eee19edacc",
  "provider": "deepseek",
  "endpoint": "https://api.deepseek.com/chat/completions",
  "model": "deepseek-v4-flash",
  "expiresAt": "2026-10-19T03:30:00Z",
  "maximumMicroUsd": 1000000,
  "maximumCalls": 46,
  "maximumInputBytes": 32000,
  "maximumOutputTokens": 8192,
  "journalDirectory": "<ROOT-supplied-new-absolute-private-directory>",
  "search": {
    "provider": "tavily",
    "endpoint": "https://api.tavily.com/search",
    "pricePolicyId": "tavily-basic-reviewed-2026-10-18-v1",
    "evidenceSha256": "3b47f63bdf04897f26adfbe50fc384afef966d3b810d19e814682465c4f5a72e",
    "searchDepth": "basic",
    "maximumCalls": 4,
    "reservePerCallMicroUsd": 8000
  },
  "research": {
    "origin": "web",
    "mode": "quick",
    "sourceBudgetMicroUsdc": 0,
    "maximumQuestions": 2,
    "maximumSearchCallsPerQuestion": 2,
    "questionSha256": [
      "19e8e4e3f09ff0d5a8d8ffb64688f8c19b41a789e45f0f5203f4059199e2ae34",
      "1f9cbcac9bd37d5dae615a1c09a817ba16f75207dd786042084e24eb59876d1f"
    ]
  }
}
```

Existing exclusive `wx` creation, file fsync, directory fsync, policy/digest rereads,
opaque process-local admission and generator cancellation remain unchanged.
`question-<hash>.json` permanently consumes the original before research begins;
`model-0001..0046.json` are shared across both questions and workers;
`search-<hash>-01..02.json` give at most four searches across the two fixed hashes.
Old journals cannot be reused with the new policy digest. No hold is refunded.
ROOT preserves the new journal through deployment and after closure; removal or
replacement would be new authority, which this implementation does not grant.

## Surfaces and verification

Admission remains public web, quick mode, exact original text, treasury funding,
zero source budget, non-private scope and no paid scholarly option. The API's
request/session/privacy guards, evidence requirements, source retrieval, quotation
checks and creator reward/payment behavior are unchanged. Browser retry/reopen
controls cannot bypass one-shot question holds. An open composer is not a new
permission. CLI, remote/stdio MCP, desktop, extension and bot origins receive no
fresh allowance; private execution and autonomous workers remain under their
existing holds. There is no distributed package change or version allocation.
The two runtime paths are audited against existing source-distribution graphs
before final handoff; hosted exact-head types/build and required domain CI remain
merge gates.

Five new regressions failed on the baseline with `policy refused`, then passed
after v3 support. They cover exact one-shot scope across midnight, altered caps,
tariffs and funding, global model/search exhaustion including empty holds, actual
fixed model/search transports with mocked HTTP and durable reservations before
failure, and persistence/expiry/cancellation refusal without dispatch. The complete
two-file focused run passed 27 tests with one existing Windows-only POSIX-fsync
integration skip, exit 0, null signal, full EOF (26.08 seconds). Existing tests also
exercise historical v1/v2 behavior, cross-process exclusive reservations, mutation
and forged/late admission refusal. Linux hosted CI retains the actual POSIX path.
The existing offline study was regenerated and checked once: all 48 trials remain
deeply and canonically byte equal, outbound attempts are zero, and the only
artifact change is the `research-allowance.ts` input hash. The generated write-up
is unchanged. Scoped lint passed for all three changed TypeScript files.

These are deterministic offline checks. They do not establish that either original
now has a supported live answer. ROOT runs each original once only after the final
accepted deployment, within the fresh finite authority; evidence gates may still
refuse an unsupported answer. No automatic replacement or retry is authorized.
