# Inline citation fidelity — October 16, 2026

The answer renderer split citation markers before inline formatting. As a result,
`**Finding [S1]**` lost its bold formatting, and a literal code example such as
`` `[S1]` then [S1] `` turned both markers into evidence buttons and left stray
backticks. Eight regression cases reproduced these failures before the fix.

The renderer now identifies inline formatting first. Bold and italic text keep
their real evidence controls inside the formatting; code spans keep citation-like
text literal. Original-quote offsets and language spans are retained through both
passes, including the escaped punctuation covered by PR #528. Stored answer bytes,
citation metadata, source evidence and payment states are unchanged.

The compact embed omits an evidence callback and already offers a full-report
link. In this context, references now render as noninteractive text rather than
buttons that promise to open evidence but do nothing. Readers with an inspector
retain their labelled, focusable evidence buttons and original trigger callback.

## Validation and surfaces

- Nine rendering regressions cover literal citation syntax in code, multiple
  citations inside emphasis, original-quote language and a compact reader without
  an inspection callback.
- Existing quote-fidelity, answer-grounding and public-language DOM tests remain
  part of focused acceptance. Required hosted CI is the merge gate.
- Web research, saved web reports and the web embed share this renderer. The
  desktop application uses the hosted web experience for these reports.
- CLI, API, remote/stdio MCP, extension and bot payloads and contracts do not use
  this React renderer and require no adapter or distribution changes here.

This is a presentation correction. It makes no new research/provider request,
does not activate a pilot and grants no spending, settlement or publication
authority. Deployment remains with the existing release owner and batch.
