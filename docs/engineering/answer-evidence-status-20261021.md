# Recorded evidence and editable target follow-ups

The saved SQLite comparison inspected on October 21 displayed `portfolio 2/9 ·
evidence 100%` alongside target support estimates of 30% and 10%. The percentage
was source yield: selected successful reads that produced reward-qualifying
evidence divided by selected successful reads. It was not answer completeness,
target coverage or a factual accuracy score. The observed source-read failure
does not establish a current reader defect or its historical cause.

## Reader behavior

The answer card now labels source selection as proposals and puts an excerpt
summary before the recorded answer. It counts targets with inspectable excerpts
using the existing source-evidence lens, including its exact citation/asset/version
matching, deduplication and synthetic-marker exclusions. It does not rejudge
evidence, modify the answer or change citation rewards.

Target inspection shows excerpt counts and valid recorded support estimates.
Missing excerpts or estimates below the existing ledger presentation threshold
of 0.4 are flagged for inspection. An unavailable historical ledger is shown as
unavailable, rather than zero coverage. Excerpt presence is explicitly distinct
from answer completeness or factual correctness. Bibliographic metadata results
retain their existing role and do not receive this scientific-evidence summary.

Each target has a **Prepare follow-up** link. It opens the ordinary editable
composer with the target, bounded original question and valid parent UUID. Long
context is visibly shortened with an ellipsis. The existing 2,000-character
editable question limit remains authoritative. The link supplies no `run=1`,
budget, model or payment authority. Full navigation ensures the live ask page
also rereads the URL. Starting research requires the existing deliberate submit
and publication/spending checks. Existing server parent authorization and privacy
validation remain authoritative.

Actual Next development/Edge QA exposed an existing Strict Mode prefill failure:
the effect marked the URL consumed before a timer that cleanup could cancel. The
effect now marks it consumed when the callback executes. Explicitly disabled
prefill stays disabled. The same exact regression fails before this fix and
passes afterwards with and without Strict Mode.

## Validation and surfaces

Focused regressions exercise the real answer card and composer, original data
immutability, identity mismatches, synthetic markers, missing historical data,
invalid estimates, encoded Unicode/query-looking text, bounded drafts and no
automatic submission. Offline Edge QA uses a synthetic report and the actual
Next homepage; it makes no research/provider/payment request. A temporary local
fixture route is removed before the candidate is committed.

Web reports and web-backed desktop views share the changed card and composer.
CLI, API, stdio/remote MCP, extension and bots retain their existing recorded
evidence contracts and web-report handoffs; no envelope or reward calculation
changes. New authored UI keys use the established English fallback until preview
translations are supplied. Required hosted PR and exact-main checks remain the
acceptance gates. Runtime deployment belongs to the existing coordinated batch.
