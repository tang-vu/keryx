# Model output-limit diagnostics

Candidate app 0.27.24, hosted MCP 0.3.4, stdio MCP 0.4.7 and desktop 0.4.9.
Publication, installation and hosted deployment are separate acceptance gates.

The owner-operated SQLite observation in [issue #212](https://github.com/tang-vu/keryx/issues/212)
had eight targets and two bounded reads. A synthesis response reported 2,560
output tokens, its requested ceiling, and failed output validation with the
historical application-assigned status 503. This was not a proved provider HTTP
503. This update improves diagnosis; it does not supply the missing runbook or
close independent usefulness acceptance.

Only explicit compatible-provider `finish_reason: length` or Anthropic
`stop_reason: max_tokens` creates a typed output-limit error. Keep the completed
response's usage before rejecting its output, including parseable JSON whose stop
reason is still length. Do not assign a synthetic HTTP status. Equal token usage,
generic invalid JSON, historical 503 metadata and missing history do not establish
an output stop. Existing local planning/selection status 422 remains a refusal,
not a supplier outage.

Propagated failures retain positive safe-integer `outputTokenLimit` on their
existing output-validation attempt. Inner review failures can preserve generation
while withholding unreviewed evidence/prose; their whole synthesis attempt may
legitimately be served. Direct bounded engines have no ResilientEngine attempts.
Retain both cases through `synthesisOutputLimit` and the existing saved synthesis
trace's exact `detail.reasoningOutputLimit` key, with a closed stage and numeric
ceiling. This introduces no synthetic serving attempt or database migration.
Malformed diagnostics cannot become a notice or evidence/payment authority.

The shared public projection exposes optional normalized `outputLimits`. It strips
extra fields and distinguishes generation/review diagnostics. Collapse only identical
step/stage/ceiling kinds: equal ceilings do not prove an attempt and an inner review
came from the same call. These records are not a supplier-call count. Inspect at most
the last 2,048 trace steps and first 256 attempts;
`outputLimitTraceStepsOmitted` and existing attempt omission metadata disclose the
respective bounds. Text shows at most eight distinct limits and reports remaining
records. Absence is unknown, never proof that no limit occurred. No provider body,
prompt, draft, private result or supplier reservation is added to public metadata.

| Surface | Behavior and boundary |
| --- | --- |
| Web live answer and saved dispatch | The shared AnswerCard shows English/Vietnamese guidance from validated attempts/trace; no automatic resubmission. |
| Markdown report download | Includes the same safe notice beside the recorded answer, without exporting raw trace detail. |
| CLI | The same completed-result notice; early planning/selection refusals keep their observed ceiling through researchFailureMessage. |
| API, OpenAI compatible API and A2A public result | Shared structured metadata; standard answer content stays under existing evidence gates. Early caller errors carry the safe ceiling sentence. |
| Hosted and stdio MCP | Shared structured diagnostics and bounded text, including when serving telemetry is unavailable; hosted JSON is validated again before formatting. |
| Desktop | Hosted research handoff and updated embedded shared helper; private/native Operator projections retain their existing narrow roles. |
| Extension and bots | Hosted research/report links expose the notice. Unchanged thin-client bundles and bot summaries do not synthesize another answer or parse supplier failures. |
| Finite canary and retained-original engines | Redactors preserve the numeric ceiling without private response text. Their current capabilities, journals, source bindings and completion/replay gates remain authoritative; no live original is retried by this update. |
| Private research/result views and Rust read-only Operator domains | Existing reduced projections intentionally omit trace/attempt diagnostics. This update does not widen private/native contracts. |
| Canonical portable research receipt | Its existing evidence/payment payload omits reasoning attempts/trace. Keep that v1 boundary and retained original digests; the report and public metadata carry the diagnostic. |

All requested output caps, input/evidence/quote bounds, provider order, call counts,
retry/fallback/circuit policy, holds and payment/reward authority remain unchanged.
No new model/search/payment operation follows from a notice. Test the eight-target,
two-read ceiling; swallowed review/direct-engine paths; terminal caller errors;
malformed/historical metadata; retained receipts; packed MCP and responsive actual
components. A separately authorized live task and independent useful deliverable
remain open, along with the original deployment/maintenance gates.
