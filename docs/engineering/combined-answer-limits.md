# Combined bullet and word limits

An ordinary first-turn caller can request an exact or maximum bullet count together
with a complete-answer word limit in English or Vietnamese. For example:

- `Write exactly 3 bullets, at most 180 words.`
- `Viết bằng tiếng Việt đúng 3 gạch đầu dòng, tối đa 180 từ.`

The final projection reuses the admitted statement/excerpt groups and tests both
constraints on the same complete answer. Quotes, confidence copy, source status,
recency, funding and follow-up notices count toward the limit. Words use the existing
whitespace-delimited count, including Vietnamese syllables separated by spaces;
this is not linguistic word segmentation. Every numbered or bulleted list row counts.
The projection does not truncate, invent filler or discard evidence to fit.

If either constraint cannot be satisfied, the complete canonical answer is retained
with a localized notice that the combined format was not met. A missing evidence
target stays missing. A source status row can prevent an exact bullet count even
when the research body alone fits.

The finite grammar requires an already-recognized explicit bullet direction, a
positive whole-answer limit from 1 to 2000, and English or Vietnamese presentation.
Quoted examples, code blocks, blockquotes, source envelopes, negation, conflicting
limits and citation/notice exemptions do not supply this new contract. Other
languages, single-limit requests and unqualified short-bullet requests retain
their existing behavior. Private, prepared, teaching, decision-brief and augmented
follow-up paths do not acquire this projection.

Selection occurs after all canonical attribution and payment work. It adds no
model calls and changes no source/review packets, quotes, support gates, citation
weights or settlement states. Web/API and their desktop, CLI, MCP, extension and
bot adapters receive the shared final answer; receipts and Markdown exports keep
that same answer. No distribution version or deployment is part of this change.

Regression coverage includes the original Vietnamese HTTP-cache request, adversarial
directives, exact count boundaries, rejected evidence, final notices and no-source
returns. Paired `runAgent`/`JsonChatEngine` fixtures compare model, attribution,
source, evidence and monetary results and verify receipt/export delivery. These
controlled judgments establish orchestration behavior, not live model usefulness.
