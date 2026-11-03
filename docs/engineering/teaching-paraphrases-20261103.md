# Preserve explicit Vietnamese teaching requests

The original-caller parser previously dropped an otherwise complete lesson when
the teacher said “Trình bày bằng tiếng Việt”, “hoạt động kéo dài 10 phút” or
“câu hỏi kiểm tra cuối giờ kèm đáp án”. A “không quá 100 từ” ceiling could also
be mistaken for a prohibition on the following examples. Eight new positive
regressions fail against the previous parser.

The parser now accepts these explicit equivalents, “Soạn”, “Viết giúp tôi”, an
activity “trong 10phút” and “giải thích ngắn gọn”. It keeps the same mandatory
original-caller language, one activity, whole bounded duration, explicit example
count, exit question with answer, word ceiling and proposal-labeling requirement.
It never interprets “100 chữ” as a word ceiling or admits a negated, fractional,
signed, duplicate or contradictory request. “Không quá N từ” is excluded only
from the negation lookbehind; a separate prohibition still refuses admission.
The unchanged original question remains the hash-bound authority.

Current main already retains the actual NASA weather/climate passages for
unglossed Vietnamese targets through generic structural body sampling. That
corrects the old October 11 source limitation without introducing a translation
dictionary, source-specific answer or new provider call. The existing synthesis
and independent review still decide whether a factual statement and each labeled
proposal can be admitted. A matching parser never supplies factual evidence.

Integration cases use the retained original NASA HTML bytes and actual inert
extraction, passage/quote selection, orchestrator, admission and portable receipt.
Each new caller variant retains the original question, three supported premises,
four labeled proposals, one source read, zero payment effects and the separate
review. Planning, generation and review suppliers are explicitly synthetic.
Existing lost-premise, false NASA-attribution, unavailable-review and absent-flag
financial/factual controls remain intact.

Shared web/API, desktop/CLI hosted handoffs, remote/stdio MCP and bot consumers
inherit this parser only through the existing gated shared orchestrator. There
are no request-schema, signing, budget, payment or custody changes. The default-off
teaching flag, live usefulness/rollout acceptance and existing owner holds remain.
No deployment, release, package publication or version allocation is performed.
