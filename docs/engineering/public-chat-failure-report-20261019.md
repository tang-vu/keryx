# Saved planning failures for OpenAI-compatible clients

The OpenAI streaming endpoint sends a report ID before research starts. A genuine
planning refusal previously closed with an error before `collectRun` saved that
ID. Extension, Desktop and sponsored CLI/MCP clients could consequently offer a
report link that had no saved original.

`POST /api/v1/chat/completions` now retains one request-local dependency instance
and saves a failed original only for an observed `ResearchPlanningError` during
decomposition, before any creator-payment or normal-save boundary, and while the
request/reader remains active. It uses the same DB facade and default visibility
as ordinary collection. Verified API-key ownership, capped budget and sponsored
funding remain server-derived; client visibility, owner and funding fields cannot
override them. The failed original keeps measured model attempts, calls and token
usage. Zero creator spend does not mean zero model cost.

The response remains HTTP 422 or a terminal SSE error, with no successful answer,
`stop` or `[DONE]`. Additive error fields describe the closed planning diagnostic,
whether storage succeeded and, only after saving, the canonical report reference.
An existing anonymous one-shot account claim may complete after saving and stays
in the caller-private response extension, separate from the original and public
error metadata. Storage/claim failure never retries research or exposes those
storage errors. Later errors, cancellation and payment/save boundaries do not
produce invented zero-spend history. Shared `collectRun` and paid A2A error and
settlement paths are unchanged. Earlier unsaved attempts are not reconstructed.

Validation used in-memory SQLite, the actual POST/collector/orchestrator/resilient
engine, synthetic model counters and the genuine privacy writer/permalink reader.
The corrected fixture failed 10 cases against unchanged production source and
passed its existing 8 refusal/admission cases. The final seven-file scope covers
169 unique passing tests, including public/private/unlisted defaults, foreign and
anonymous readers, error-only SSE, measured failed model usage, cancellation,
private claim ordering/outage, sponsored admission, existing owner history and
the sponsored client. Three-file ESLint and `git diff --check` pass.

The first required CI exposed 13 failures in two additional legacy fixtures:
the hosted-claim fixture lacked the now-explicit dependency selector, and the
cross-surface fixture still required the old error shape without a saved report
reference. Their narrow updates retain the existing private-packet, payment,
terminal-error, caller-excerpt and no-retry assertions, add exact saved-failure
references and verify claim refusal precedes dependency selection. All 34 cases
in those files pass, with scoped lint, bringing the retained focused total to
203 unique passing tests. Runtime bytes remain unchanged by this correction;
the original CI failure is retained and fresh exact-head CI is required.

The first fixture preparation error and an initial existing A2A rate-limit failure
are retained in local output. The latter came from the local runner explicitly
setting both policy controls to empty strings: the existing guard correctly
refused malformed configuration. Re-running only that three-case file with both
controls absent passed without changing its source, assertions or runtime guards.
Required hosted types/build/domain checks remain merge gates; no live research,
provider, payment, publication or deployment was used for these checks.

| Surface | Effect of this correction |
| --- | --- |
| OpenAI-compatible API | Both ordinary JSON errors and SSE planning errors may reference their genuinely saved failed original. |
| Extension research popup | Its existing early streaming report ID can resolve after this specific persisted failure; no extension code or permission change. |
| Desktop, sponsored repository CLI and stdio MCP sponsored tool | Their existing hosted OpenAI client retains the error and report identity; no local model call or automatic retry is added. |
| Web | The existing `/api/ask` saved-failure path is unchanged; the same saved-report renderer can display this API original. |
| Paid A2A, paid stdio tool, remote MCP and bots | Their separate error/payment contracts are unchanged; this adapter-local save does not extend to them. |

This route is outside the frozen offline study and retained distribution input
graphs. It adds no package input or version allocation. The surrounding release's
shared report-copy changes still require its separately planned fresh MCP/Desktop
artifacts. Published, installed and deployed identities remain the release
coordinator's verification responsibility.
