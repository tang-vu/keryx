# Ordinary answer and confidence language — 2026-10-09

Issue331 records a Spanish NASA question with Spanish statements, Portuguese
section labels and an English confidence banner. The earlier inference repair
removed wrong Portuguese selection but deliberately fell back to English for
Spanish. The ordinary pipeline also selected confidence copy with an independent
Vietnamese/English heuristic, so Portuguese labels could still have an English
notice and rationale.

The source candidate adds Spanish to the internal ordinary `AnswerPresentation`
contract. Positive supported language directives in the trusted original caller
question select English, Vietnamese, Portuguese or Spanish for labels, short-item
notes, statement-generation guidance and confidence notices. The finite parser's
existing clause/quote/negation guards remain. Spanish and Portuguese are distinct;
shared words alone do not establish Spanish. French, German and other unsupported
directives retain English scaffolding without forcing statements into English.
This is bounded directive handling, not general language identification.

The confidence formatter uses the same selected language. It preserves the
recorded evidence-verdict rationale: missing evidence, unresolved disagreement,
incomplete final assessment, explained preferences and bounded publisher/source
group counts each have finite copy. Classification, thresholds, grouping,
reward gates and financial amounts are unchanged. Ordinary delivery still reports
Low confidence even when excerpt coverage is strong; source grounding, model
review and grouping do not establish completeness or independent factual truth.

Statements receive language guidance before their separate evidence review.
Presentation retains admitted statement text, exact original source quotes,
markers and offsets. It performs no translation after review and no enrichment of
source evidence. A source excerpt can remain English inside a Spanish answer.
Requested research topics remain explicitly unverified. Missing targets and
unavailable synthesis/review use Spanish gap/limitation text rather than borrowing
an unsupported answer from model memory.

`run-agent` uses the new Spanish/confidence path only for ordinary public effects
without a target asset, paid-scholarly flow or decision-brief contract. Retained
scope keeps Spanish as the previous English scaffold fallback and retains the
previous confidence path. Calls to `finalizeGroundedAnswer` without ordinary
presentation preserve their historical output. Stored reports, originals, claims,
receipts and payment rows are not rewritten; confidence enum values and public
JSON field names are unchanged.

## Surface boundaries and acceptance

| Surface | Candidate effect and boundary |
| --- | --- |
| Web research, report/API exports, OpenAI results | New ordinary answer body and confidence reason inherit trusted question selection. Stored answers remain unchanged. |
| Hosted MCP and A2A result exports | The same stored/returned ordinary body is exported with unchanged evidence and checked receipts. Private/retained execution is outside the new Spanish opt-in. |
| CLI, stdio MCP, desktop, extension and bots | Existing server answer consumers inherit the body. Local ordinary `collectRun` inherits the helper with updated source. Wrapper/help/menu/interface strings and package/installer publication are separate gates. |
| Private originals, targeted paid originals, decision briefs | Previous presentation/confidence path remains. No historical protocol, settlement, claim or reservation is changed. |

Offline coverage includes the exact frozen NASA question, Spanish/Portuguese
confusion, supported-language precedence, negated and quoted directives,
unsupported-language fallback, gap/unavailable output, unchanged verdict levels,
and an admitted synthetic statement exported through report/API/MCP/A2A surfaces.
The private Spanish pipeline regression checks the previous complete confidence
reason and receipt/evidence preservation. All suppliers, gateways and persistence
ports in pipeline cases are synthetic; no real model/search/payment or shared DB
is used. Existing HTML/preformatted/named-heading/enumeration fixes for230,231
and238 are reused rather than duplicated.

The initial offline selector regression really failed on the merged base; its raw
exit1/end/close/error metadata is retained. Source review, applicable exact-source
acceptance and coordinated delivery remain required. A separately authorized live
Spanish run must still demonstrate useful supported statements and language
agreement. No live acceptance or issue closure is claimed. Broader interface,
trace/help/error/catalog localization and issue276 remain open.
