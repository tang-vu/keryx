# Ordinary answer language selection — 2026-10-09

The frozen Spanish NASA request retained in issue231 received Portuguese answer
scaffolding in the issue276 production retest. The heuristic combined `explique`
with `sobre` or `para`, although these words occur in both Spanish and Portuguese.
It also missed the caller's `En español,` directive. An unsupported explicit
request could retain Portuguese inferred from other text.

This repair narrows automatic Portuguese inference to distinctive cues and gives
positive output directives precedence over inferred language. Existing explicit
English, Vietnamese and Portuguese selection remains supported. Bounded Spanish,
French and German directive forms identify unsupported requests; they select the
English scaffold fallback without forcing English statement generation. The last
positive directive wins; a negated directive does not replace it. This finite
parser does not establish general language detection or instruction understanding.

Only the original caller question supplies ordinary answer presentation. A
Portuguese instruction in accumulated context cannot override a Spanish original.
Generated statements still pass the separate evidence review. Their original
text, source excerpts, markers, ledger rows, receipts and payment authority are
unchanged by presentation. No translation occurs after statement review. Private
and retained finalization without ordinary presentation retains its existing path.

## Supported surfaces and remaining scope

| Surface | Effect and remaining gate |
| --- | --- |
| Web, saved reports, research API | New ordinary answers use the shared selector; existing stored answers are not rewritten. Deployed exact-source acceptance remains required. |
| Hosted/remote MCP, A2A, OpenAI adapter | Existing shared answer and export consumers inherit selection; field names, enum values and receipt structures stay unchanged. |
| Buyer CLI, stdio MCP | Hosted answer consumers inherit the server result; no package contract change. Published versions and deployed source must be verified before claiming synchronized delivery. |
| Telegram, Discord, Slack | Embedded ordinary answer inherits selection. Bot help, wrapper labels and language-preference commands remain separate open localization work. |
| Browser extension | Existing research result consumer inherits server output; no new catalog or extension distribution change. |
| Desktop, Operator and private research | Existing role boundaries and private-original presentation remain in place; no system-locale override is added. |
| Citation emails and notifications | This selector is not used. Recipient preferences and localized email catalogs remain open work. |

Issue276 remains open. This fixes wrong Portuguese inference, not Spanish/French/
German localization or agreement between every answer and every surrounding
notice. New catalogs, human translation review, bot and recipient preferences,
early failure notices and all-surface evaluation remain acceptance gates. The
NASA illumination/content gap and three-sentence usefulness also remain in
issue231. No fresh provider, search, financial or database trial is performed.

## Validation and release

Hermetic regressions include the exact public frozen question, shared Spanish/
Portuguese vocabulary, unsupported positive directives, negation, order,
supported-language precedence and incidental language mentions. An admitted
synthetic quote passes the unchanged span/ledger/statement gates before rendering;
its quote and ledger remain identical. The pipeline fixture verifies trusted
original-question selection, report/API/MCP/A2A exports and checked receipts with
a fake gateway, without actual settlement. Existing private-original and payment
regressions run alongside it.

Require focused tests, both TypeScript graphs, scoped lint, actual aggregate and
applicable platform CI, independent review and coordinated exact-main delivery.
The existing release45 owner retains its active source/native acceptance window;
this independent repair must not advance main or deploy through that window
without its closure or admission. Source checks do not prove deployed behavior,
published packages, installed clients or completed issue276 acceptance.
