# DeepSeek model selection

Checked October 13, 2026. The default recommendation is **DeepSeek V4.1 Flash**,
with V4 Pro available for explicit comparisons. MiMo is withdrawn from new
public, private and fallback model construction at the owner's request.

## Current models and prices

The official API names are `deepseek-flash` and `deepseek-v4-pro`. Flash currently
serves V4.1 Flash; Pro serves V4 Pro 0813. Legacy Flash wire names route to V4.1
Flash, so normalizing the name does not establish a quality improvement.

USD per million tokens, off-peak / peak:

| Model | Input cache hit | Input cache miss | Output |
| --- | --- | --- | --- |
| V4.1 Flash | 0.003 / 0.006 | 0.15 / 0.30 | 0.60 / 1.20 |
| V4 Pro 0813 | 0.022 / 0.044 | 0.66 / 1.32 | 1.98 / 3.96 |

Peak hours are 01:00–04:00 and 06:00–10:00 UTC on weekdays excluding Chinese
public holidays. Keryx records a price interval rather than guessing a billing
window or holiday. Actual invoices remain distinct from token-based estimates.
[Official pricing](https://api-docs.deepseek.com/quick_start/pricing/).

For an illustrative single call with 20,000 uncached input tokens and 5,000
output tokens, Flash costs approximately **$0.006–$0.012**, while Pro costs
**$0.0231–$0.0462**, about 3.85 times as much under the same window. This is a
scenario, not the cost of a whole Keryx job: research can make multiple calls,
cache shares differ, and search/source/network costs are separate.

## Quality and selection

DeepSeek's release results make V4.1 Flash a credible first choice for agent
workloads, but do not establish Keryx answer quality or Vietnamese performance.
The Pro option is not labelled the strongest model: it is an older, more
expensive alternative that may help a particular task. An early September
release announcement proposed redirecting Pro to Flash; the updated change log
and pricing explicitly retain Pro service and its own billing.
[Current change log](https://api-docs.deepseek.com/updates/),
[V4.1 Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash).

Published instruct benchmarks, at maximum reasoning effort:

| Benchmark | V4.1 Flash | V4 Pro column |
| --- | ---: | ---: |
| GPQA Diamond, pass@1 | 90.9 | 92.4 |
| DeepSWE v1.1, resolved | 74.2 | 62.7 |
| AutomationBench, pass@1 | 54.8 | 43.2 |
| HLE with tools, pass@1 | 63.9 | 60.0 |

These are DeepSeek-reported results, not Keryx measurements. The comparison
column says V4 Pro without establishing identical settings/version to the
current Pro 0813 API. Maximum-effort agent benchmarks also do not predict our
bounded non-thinking JSON calls. They support trying Flash first; they do not
prove every Flash answer is better. Source: the model card above.

- Keep bounded planning and source-selection JSON calls on Flash in non-thinking
  mode. Thinking can exhaust the output allowance before returning usable JSON.
- Keep Flash as the ordinary synthesis default. Review remains independently
  bounded; choosing a model does not increase provider or source-payment limits.
- Use Pro only when explicitly selected or configured under a separately admitted
  allowance. It is excluded from automatic supplier probes and never promoted
  automatically because a result was partial.
- A live comparison must use the same original task, source bodies, output
  requirements and finite supplier allowance. Assess completeness, correct
  source support, language/format adherence, latency, invalid output and cost per
  accepted deliverable. Review labels must identify human or model judgment.

The source changes and synthetic transport tests do not establish that Flash
beats Pro on Keryx tasks. No live model calls were made for this update. A
bounded live comparison and useful-answer acceptance remain separate gates.

## Existing originals and other surfaces

The pure catalog feeds the browser picker and API model discovery. Shared engine
selection feeds public research, remote MCP, API and supported bot adapters;
stdio/desktop/extension retain their hosted-service roles. Other explicitly
configured providers remain available under their existing rules, with DeepSeek
first in the default order. A deployment-local order can deliberately override
that order; the removed MiMo name and key never revive its endpoint.

Historical MiMo labels, receipts and captures remain historical. Existing private
policy records can still be read through their original schema, but new MiMo
engine construction refuses. Do not replace a paid original with another model
or regenerate its quoted disclosure. A fresh private Flash quote uses the
canonical wire name; retained requests with another exact disclosure require
their original-policy execution/recovery review before release admission.

Business-canary and finite production engines keep their exact legacy Flash wire
identity, supplier policy and allowance. Historical price observations remain
unchanged. New ordinary canonical Flash and Pro usage captures append dated
policies; missing cache counters remain unknown, not an estimated zero cost.

The existing release owner must verify actual deployed configuration, hosted
model discovery and applicable published artifacts in the combined release.
Source changes do not prove a deployed model change or authorize extra spending.

The optional Circle grant-media script also no longer calls MiMo TTS/ASR.
It requires `KERYX_GRANT_AUDIO_DIR`, containing reviewed `<scene-id>.wav`
recordings and `<scene-id>.txt` transcripts. Its new narration report records
audio hashes and supplied-transcript comparison, explicitly without automatic
ASR verification. Historical narration and reports are not rewritten. No new
audio provider is introduced or treated as a DeepSeek text-model feature.
