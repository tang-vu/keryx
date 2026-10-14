# Completed-result language projection (#276), October 15

This bounded source increment carries an already valid trusted producer language
packet through completed A2A delivery, the stdio buyer and its original GET-only
recovery. It does not qualify additional generation paths. Original #276 stays open.

The existing `answer-language-provenance` module now shares its closed-schema reader
between stored and completed packets. The finalizer body is unchanged. A completed
packet contains exactly the existing format, scope, language, method and final
UTF-8 answer SHA-256, plus `queryId`. Server projection runs after existing synthetic
demotion, binds `run.id`, and omits the packet if final answer bytes no longer match.
No trace, private detail, approval marker, request preference or guessed language
is projected. Duplicate stored packets, unknown/future/malformed packets, foreign
query IDs and changed final answer bytes remain absent/UNKNOWN.

`mcp/local-payment.mts` remains unchanged: its initial completed query/body/hash,
custody and settlement checks and original GET-only recovery identity checks retain
authority. Buyer sanitization follows that completed verification, using the initial
verified response query ID or recovery's original retained payment query ID. Both
paths use the same reader and preserve the existing read-checkpoint projection.
Optional language evidence adds no paid body field, funding, call, retry or journal
mutation. A digest is a byte binding, not independent producer authentication,
human translation approval or financial settlement evidence.

The actual shared stdio handler rechecks the completed query/answer packet before
choosing labels. A valid observed language takes precedence over question intent;
an explicit label override retains the existing honest mismatch notice. Missing
provenance keeps existing question/override label behavior and UNKNOWN answer
language; a request preference never becomes output evidence. Invalid optional
packets are also omitted from structured handler output. Original answer, quotation,
evidence, amounts, receipts, machine fields/enums/codes and English financial
authority prose retain their roles and bytes. The stdio entrypoint changes only
the language option description; all history268/session/cancellation registrations,
imports, methods and handlers are preserved.

Synthetic no-network contracts are added for en/vi/pt/es across strict projection,
completed A2A response, actual shared handler, buyer and mocked original recovery.
They cover mutation, foreign query, duplicate/future/malformed packets, honest
unknown/mismatch, exact quotations, receipt/economic equality, unchanged paid body
and absence of extra funding/payment/transport effects. These are authored tests,
**UNRUN** under this source-only delegation; no acceptance or delivery is claimed.

Web/API/remote MCP and existing bots/email/CLI/Desktop preferences retain their
previous contracts. Extensions retain their hosted/browser handoff. This work
only binds completed A2A/stdio label evidence; incomplete package generation,
unqualified private/special answers, full coordinated language agreement,
financial terminology approval and packed/native delivery remain explicit gates.
No fabricated packet or historical backfill closes those gaps.

Parent next action: independently review the exact candidate and retained raw
before/after/inverse/minimal patch/pins in
`output/completed-result-language276-20261015`; run focused contracts and types,
refresh actual canonical evaluation if its inputs changed, then pass applicable
required PR CI. The sole merge/release owner manages the focused PR and merge,
and accumulates deployment in its existing batch. This worker runs no tests,
compiler, modules, browser, provider, network, payment, install or Git mutation.

## Parent validation — October 15, 2026

The three app contract files pass all 37 cases. The existing buyer test file passes
all 19 cases, including the four new initial/recovery language cases and retained
custody/funding refusal controls. The focused app/MCP TypeScript closure passes.
These are hermetic synthetic transport contracts: no model generation, provider,
funding, signing or payment was performed. The independent ten-source payment
review accepted the final packet/answer/query bindings and unchanged payment body.
Current-source canonical evidence, required PR CI, package publication and batched
delivery remain separate gates; original #276 remains open.
