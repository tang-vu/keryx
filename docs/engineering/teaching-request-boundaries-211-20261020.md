# Teaching request boundaries for issue211

The original-caller parser could read `12 classification examples` as two
examples, match `one` inside `someone`, or accept a partial unit such as
`100 wordsmiths`. It could also carry `Do not buy sources.` into the next
positive request and withhold an otherwise supported teaching scope.

Request phrases now require complete Unicode word boundaries. Numeric counts
are captured whole and validated against the existing schema; signed, decimal
and fractional count suffixes are refused. Sentence-ending punctuation and
semicolons end a preceding negation. A line break alone preserves negation, as
do same-clause `cannot` and `can't`. Existing Vietnamese and English scope,
exclusive word ceilings and original-question hash binding are retained.

The focused regressions cover both languages, out-of-range and malformed counts,
partial words, independent source-purchase prohibitions and same-clause refusals.
Existing original/NASA teaching fixtures and generation/review/projection tests
remain the integration checks. Supplier judgments in those fixtures are
synthetic; they are not live model or ordinary classroom acceptance.

This fixes request interpretation only. Issue211 remains open: ordinary planning,
cross-language factual retrieval and useful output still need their existing
acceptance. The teaching opt-in remains default-off. This outcome changes no
payment, citation/reward, receipt, storage, execution or feature-rollout authority.
Shared web/API, desktop, CLI, remote/stdio MCP, extension and bot consumers retain
their existing adapters; the parser is internal and adds no public fields.
Required PR/domain CI and the existing Circle-owned batched runtime release
remain separate from focused offline verification.
