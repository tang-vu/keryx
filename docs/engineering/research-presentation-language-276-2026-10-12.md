# Shared human presentation contracts (#276)

This extends the same bot/help PR with deterministic API, remote MCP and stdio MCP result
presentation. It preserves the [bot help/preference checkpoint](bot-controls-language-276-2026-10-12.md)
and the original question-language answer producer. No answer, cited evidence or source text is
translated in place or labeled as translated.

## Authority and UNKNOWN

`livePresentationLocale` consumes only an optional finite requested label-language enum, a
trusted producer's explicit recorded answer-language enum, and the authoritative original
question. Order: requested labels → recorded answer language → existing question selector →
English fallback. Shipped values are `en`, `vi`, `pt` (also `pt-BR`) and `es`; prepared UI locales
are not activated. A requested override can disagree with a recorded answer, so the resolution
retains `MISMATCH`; absent answer metadata remains `UNKNOWN`, even when the labels are English.
Neither the answer text nor excerpts/source/provider text is used to detect its actual language.

The API/MCP `language` parameter is **presentation-only** and is described that way in request
schemas. Current `QueryRun`, remote result and stdio buyer producers have no admitted general
recorded answer-language field. These adapters therefore do not read arbitrary `language` or
`answerLanguage` properties as authority and do not invent model-output agreement. An explicit
label override adds a localized notice that answer language was unrecorded and its original text
is unchanged. It is never forwarded to `collectRun`, `askKeryx`, a prompt, paid body or request hash;
no hidden directive, synthetic `originalQuestion`, new authorization or retry is introduced.

Unsupported API request values return the existing English machine error envelope and
`invalid_request` code before admission; MCP's finite schema refuses them before its callback.
The pure resolver's unsupported-input path retains an English fallback plus explicit unsupported
status. Machine field names/enums/confidence levels/engine IDs and raw diagnostic details remain
their original English/data values, even inside localized prose.

## Actual adapters and exact retained bytes

- OpenAI-compatible API: JSON and terminal SSE answer content use localized generated citation,
  weight, total/mode and dispatch labels. Existing `keryx` metadata, private packet placement,
  trace `reasoning_content`, error envelopes, terminal `stop`/`[DONE]` and lifetime are unchanged.
- Remote MCP: localized citation/evidence/source-selection/confidence labels, per-step serving
  and output-limit notices; structured results/private claim packets keep their existing bytes.
  Failure prefixes and diagnostic headings are localized; raw diagnostics are preserved, and
  the public product pause reuses the existing bot catalogue without exposing internal detail.
- Stdio MCP: the same isolated human renderer/handler consumes the buyer's existing result.
  Its paid body/hash/custody/recovery code is untouched. Existing wallet/signing/recovery tools
  and financial authority text retain their English role. Offline checks never import or start
  the stdio entrypoint/buyer; the handler is exercised with an injected result only.

The source names, answer body, exact excerpt, original confidence reason, raw provider details,
canonical English amounts, payment-mode/status values, settlement IDs, USDC/micro signing text
and receipt payload/digest are data, not translation keys. Existing financial authority notices
and stdio settlement prose remain byte-identical English, identified as English financial details
where appropriate. Display-only financial labels are agent-authored; #273's actual financial/
trust-copy approval gate remains open. No separate human approval gate is invented for ordinary
labels, evidence limitations or language controls.

Localized output-limit prose uses the existing `uniqueOutputLimits` bounded public projection;
its only upstream edit is export visibility/comment. No new parser, telemetry event or stop-state
inference is added. Missing serving history stays unavailable; partial omitted histories retain
their warning. All default English renderer behavior and financial fragments are retained.

## Report/CLI coordinator inputs — no false wiring

`recordedReportPresentation(recordedAnswerLanguage)` is a browser-safe shared label contract for
report/CLI/Desktop owners: title, bibliography/source/evidence headings, quote/confidence/payment
headings and the evidence limitation notice. It accepts **only explicit recorded language**.
An old question, UI/system locale, arbitrary result object or missing metadata cannot retrospectively
establish stored answer language. Unknown records use English labels with an explicit unknown notice.
It performs no storage read/write, privacy projection, excerpt formatting or report rendering.

The exact remaining producer admission is a trusted typed answer-language enum established by
generation/evidence-review/finalization, retained with the answer and carried through the already
authorized public/private result projection after access checks. The report owner must supply that
enum to this contract while preserving existing literal escaping and quote bytes; no DDL/backfill
or inferred migration is included here. CLI301 owns runtime capture/integration. For fresh CLI
results it can pass an explicit presentation override and the actual original question to the live
resolver; system locale may select local control labels, but is not evidence of a stored answer's
language. Bot help preference is not silently promoted to this producer authority.

Confidence/evidence-gap prose already embedded inside `run.answer`, generated trace messages,
report decision UI/export integration, email stored recipient preferences and system-locale
client integration remain their respective owners' source gates. These adapters cannot safely
translate those bytes after evidence review. Shared labels are available without editing those
owned files; no successful model-language or original full-issue agreement evaluation is claimed.

## Validation, runtime epoch and delivery

Focused offline tests exercise all four catalogues, question defaults and explicit overrides,
recorded/missing/unsupported/mismatched authority, JSON/SSE and in-memory remote MCP adapters,
isolated stdio handler, private envelope/refusal controls, exact excerpt/answer bytes, canonical
micro amount display and unchanged machine/receipt hashes. They make no live provider, payment,
model/search, bot or notification request. Tests use native config loading, `envDir:false`, owned
caches, existing QA dependencies and explicit offline Arc testnet/no Supabase. Application,
operations and the stdio entrypoint source are typechecked without importing its runtime.

The old 88-check bot receipt qualifies its exact checkpoint/unchanged bot source, not this changed
shared runtime graph. Runtime edits include API/OpenAI mapper, remote MCP server, stdio entry,
new presentation modules/catalogues and the output-limit projection export. This is a **NEXT-batch
root runtime-input/epoch admission**, independent of frozen final59. Existing study/corpus/reports
and accepted study receipts are byte-preserved; no new 48-trial run or exact-input acceptance is
claimed here. Root must qualify the next combined runtime graph before reusing study evidence.

PR426 remains one cohesive review candidate. Root owns independent source review (including the
API serialization/private/SSE boundary), applicable hosted aggregate/domain gates, main merge,
artifact/package publication and coordinated actual delivery. No versions, production settings,
recipient bindings, activation, schedules or private financial state are changed. Original #276
remains open until its producer/report/email/client and original coordinated language-agreement/
delivery criteria, including #273's financial-copy gate, are accepted.
