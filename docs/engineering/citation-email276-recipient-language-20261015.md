# Stored-recipient citation email wrappers — 2026-10-15

This later original #276 outcome starts at
`62981a66d313a4adfe6925b6b96cdfe649a3a136`. It changes exactly
`lib/notify/citation-messages.ts`, the pure renderer/import in
`lib/notify/citation-email.ts`, `lib/notify/citation-email.test.ts`, and this note.
The existing catalogue supplies localized neutral rate/navigation copy for `en`,
`vi`, `pt` and `es`. Subject, financial text introduction, HTML title, heading
and financial body are fixed to canonical English in the active catalogue.
Translated financial prose is retained only as explicitly unreviewed drafts;
there is no caller flag or language choice that can activate it. The existing
strict presentation selector admits exact `pt-BR` as `pt`; missing/unknown values
use English. No source, article, question or system language selects an email locale.

Dispatch already reads the current preference for the exact source/address/token
tuple. Its entire function remains unchanged. No provider, recipient, storage,
auth, timeout, rate interval, success/failure, payment predicate or payload code
changes. Source/article text stays original; private questions remain absent.
Amounts keep the existing six-decimal rounding and trailing-zero trimming; USDC,
network, weight, IDs and plain URLs/token bytes retain their existing treatment.
Every HTML interpolation is escaped. English subject/text and static HTML remain
compatible; HTML hrefs now escape quotes/angle brackets/ampersands, including the
unsubscribe separator as `&amp;`, without URL encoding or changing its target.

Payment trace inspected as source: `run-agent.ts` collects existing citation legs,
`research-effects.ts` invokes email/webhook notification, and
`citation-webhook.ts:buildCitationPayload` retains the sum, individual states and
blank reader question. The existing email predicate is `payments.some(p =>
p.settled)`. This rendering change does not certify, strengthen or reinterpret
that predicate, mixed-leg totals, chain evidence or external-customer activity.
The pure renderer is not a settlement verifier. No notification was sent.

All prior test cases remain; the former English-only foreign-wrapper assertion
now checks unchanged financial facts, and HTML-link assertions account for safe
attribute escaping. Added controls cover neutral wrappers in every language and canonical English financial sentences,
English compatibility, strict fallback/alias behavior, unchanged multilingual
article bytes, one-pass placeholders, hostile HTML/URL values, micro-USDC precision,
current stored recipient selection differing from the question, changed preference,
read failure, pending/simulated refusal, configuration/rate gates and provider
failure. Dispatch fixtures use in-memory stores, fake configuration and a stubbed
fetch only. They are synthetic controls, not provider or settlement observations.

Actual focused validation: all four email/recipient/native-notify files passed
54 controls in 19.686 seconds, and the six-input focused TypeScript check passed
in 23.128 seconds. Both completed naturally with exit 0 and both streams at EOF.
Inputs and ten qualified dependency controls remained unchanged. Evidence is in
`output/resume-distribution63-audit-20261012/email276-first-focused-controls-and-types-root-20261015/`.
Independent source review accepted the renderer and unchanged dispatcher; its
financial-prose finding was corrected by the active English boundary and a tiny
follow-up review accepted that correction. No outbound email, build or production
action ran. Required PR CI, current-main composition and delivery remain open.

Root owns release67; this later outcome adds no release hold or automatic deploy.

Non-English neutral wrappers and inactive financial drafts are machine-authored
and unreviewed. No genuine content-bound human approval is recorded, so active
settlement/ownership sentences remain English. Original #273 glossary
terms, critical English financial/legal authority, consent and human-review status
are untouched; no approval or trust/UI activation is claimed. Original #276 stays
open for its other producer/early/special-result, recorded report/metadata,
web/desktop/CLI, API, remote/stdio MCP, extension/bot, financial terminology,
cross-surface agreement and publication/delivery criteria. This slice provides
only recipient-email source; it grants no new behavior to those surfaces. See the
existing [language276 record](language276-completion-2026-10-12.md) and
[completed-result follow-up](completed-result-language276-20261015.md).

Source review corrected the initial active translated payment-prose boundary
before execution. Controls require English financial sentences for every language,
localized neutral navigation/rate copy and unchanged stored-recipient selection.
