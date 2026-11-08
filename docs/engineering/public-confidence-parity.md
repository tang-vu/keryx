# Recorded confidence across public research transports

The shared public research projection includes an optional `confidence` object
containing the recorded `level` (`High`, `Moderate` or `Low`) and `reason`. This
keeps the OpenAI-compatible terminal metadata, non-streamed completion, A2A result,
remote MCP and sponsored-client JSON consistent with the stored report.

Projection uses the existing recorded-confidence reader: the stored field wins;
otherwise the last recognized historical verdict supplies the assessment.
Synthetic-evidence demotion still runs first. Neither projection nor transport
recalculates confidence, changes evidence thresholds or upgrades a judgement.
Opaque historical trace entries are ignored without losing the admitted answer.
A later recognized verdict with an unsupported reason is omitted rather than
reviving an older assessment; absent legacy reasons retain their existing empty
explanation. Receipt construction is unchanged.
The assessment remains the agent's recorded evaluation, not independent factual
verification, intended-artifact acceptance or settlement evidence.

The shared legacy reader also skips opaque trace entries when archives,
comparisons, receipts and A2A service summaries load them. If a recognized last
verdict's explanation cannot be converted using the historical rules, its
assessment is unavailable; an older grade is never revived. Stored-field
precedence and successful historical explanation conversions remain unchanged.
These guards do not change grading, source selection or settlement authority.

Only the known scalar fields are copied. Unsupported levels, non-string reasons
and reasons exceeding the existing sponsored public-snapshot text bound of
262,144 UTF-16 code units are omitted. A missing or malformed optional assessment
does not discard the original answer or receive a fabricated Low grade. A recorded
Low grade, including the bibliography-only limitation, remains Low. The remote
MCP text retains its report link when no valid assessment is available.

The sponsored client projects the assessment before recursively copying public
metadata, so unknown/private nested properties cannot enter output or consume
the public snapshot's structural budget. Existing body/frame/output bounds,
control-character filtering, URL checks and private one-shot sidecars remain in
force. The hosted CLI and sponsored stdio MCP use this same client. Desktop's
helper retains the same public result contract; its existing report link remains
the route to the full assessment. The extension receives the additive terminal
metadata through its existing API stream without a new parser or retry path.
The paid stdio buyer's answer type also describes the optional field; its existing
verified-result and GET-only recovery handoffs retain it without changes to
funding, original-query checks or settlement handling.

This is additive public response metadata, not a receipt/schema migration.
Original answers, citations, payment amounts, receipt construction, custody,
consent, admission and request count are unchanged. No model call, source read,
payment, funding, version allocation, deployment or publication follows from
reading or displaying the assessment. Packaged MCP, desktop and compiled web/API
acceptance remain required before release; source checks alone do not establish
live delivery or independent user usefulness.
