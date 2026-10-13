# DeepSeek focus and MiMo withdrawal

Owner direction October 13: remove MiMo because its observed quality was
unsatisfactory, focus Keryx on DeepSeek, and compare current DeepSeek prices and
fitness. This outcome is separate from the concurrent Research Mandates outcome
and belongs to the existing coordinator's release batch.

## Implementation

- Remove MiMo catalog entries, credential/endpoint configuration, fallback tier
  and private engine construction. Retained environment variables cannot revive it.
- Retire MiMo TTS/ASR in the optional grant-media generator. Reviewed local
  narration/transcripts replace supplier calls; their comparison is not labelled
  automatic ASR proof. No historical output is rewritten and no media is regenerated.
- Make DeepSeek first in the default provider order; preserve deliberate existing
  operator overrides and separately enabled alternatives.
- Use canonical `deepseek-flash` for ordinary defaults/catalog construction,
  label its current V4.1 identity, and keep Pro an explicit manual comparison.
- Preserve the private Flash engine's exact accepted `deepseek-v4-flash` wire
  disclosure. Upstream serves it with V4.1; public normalization cannot rebind
  private originals or their recovery/checkout authorization.
- Append October 13 Flash/Pro price observations. Keep earlier policies and
  legacy-wire finite-canary captures unchanged. No historical cost backfill.

No provider call, payment, funding, custody activation, schedule, circuit reset,
production mutation or deployment is part of source validation. Current fixed
supplier allowances and original journals remain authoritative. Private accepted
terms cannot be silently replaced by a new model disclosure.

## Surface and integration gates

Web picker/API discovery use the shared catalog. Public hosted research,
remote MCP and supported bots use the shared selector; private construction
accepts only DeepSeek. Stdio/desktop/extension retain their current hosted
roles and immutable package provenance. Model prices are internal observations,
not a change to customer fees or financial authority.

DECISIONS, README, global OpenAPI/MCP presentation and shared release-version
files have other active owners. This document records the outcome without
writing their paths. The coordinator must compose the relevant documentation,
review original private/bounded-policy compatibility, pass required exact-source
CI and release/surface gates before claiming delivery.

See [selection rationale and remaining live evaluation](../deepseek-model-selection.md).

Focused provider/model, exact-price and finite production/canary refusal checks
passed. A further 113 regression cases cover current provider ordering/failover,
durable historical labels, private checkout, interruption, original recovery and
exact private wire identity. Changed-file ESLint, UI copy guard, media-generator
syntax and whitespace checks passed. Provider HTTP was mocked; no live provider
quality, invoice or settlement claim follows. Required full PR CI/typecheck/build
and independent review remain release gates.
