# First-party corpus evaluation — September 8, 2026

Scope: the two complete articles in this directory, parsed by Keryx's RSS ingestion
function, then supplied to sufficiency and synthesis using the v0.22.4 evidence-context
selector. Research targets were specified for these two questions. This did not exercise
discovery, source selection, purchase, registry onboarding or settlement.

The configured DeepSeek v4 Flash engine repeatedly hit its JSON output-token ceiling.
The existing fallback chain rotated to MiMo v2.5. Its circuit state was isolated in
memory, with no production database writes. No source payment was attempted.

| Question | Ledger coverage | Review |
| --- | --- | --- |
| How does Keryx distinguish access tolls from citation rewards, and which evidence checks gate rewards? | 0.95 for the distinction; 0 for the reward checks | The model proposed a quote longer than 240 characters for the checks. The deterministic gate rejected it. The assessment also returned `sufficient:false` despite assigning both targets coverage 1. |
| How can a Keryx buyer recover a job after losing the submission response without paying again? | 0.9 for journaling; 0.9 for recovery behavior | The second quote passed textual validation but described duplicate-debit risk and package matching, not GET-only resume behavior. Human review therefore does not accept that target as adequately supported. |

The recovered answer for the first question correctly distinguished the two payment
types. For the recovery question, the answer described journaling but omitted the
specific instruction to use resume with the same directory and its GET-only behavior.
These are partial results, not a passing end-to-end research pilot.

The corpus is now more complete than the short seed abstracts. However, richer input
alone does not guarantee compliant quotations, semantically relevant evidence or a
complete answer. Next work should address model output-budget failures and evidence
selection/quotation quality without relaxing the quote-length or payment gates.

Local checks passed: exact full-body RSS round-trip, generated-feed freshness and
TypeScript. CI now checks the feed alongside the existing repository validation.

## v0.22.5 follow-up

Explicit non-thinking requests fixed the observed DeepSeek truncation in the final
four-call assessment/synthesis check: all four were served by DeepSeek v4 Flash on
the first attempt, each taking about 2 seconds, without provider fallback. This small
sample is not a latency SLO. Token ceilings were unchanged.

The earlier recovery failure was traced to the context selector excluding a relevant
window because it overlapped the journal window. Allowing and merging overlapping
windows recovered the instructions to use resume with the same directory, send only
GET requests, and avoid signing or replaying a purchase. The final answer and its quote
explicitly contained those instructions; the quote passed original-text validation.

Coverage in that final check was 0.6/0 for the reward question and 0.3/0.6 for recovery.
The model still proposed an overlong reward-check quotation, which the ledger rejected.
The journal target's conservative model assessment kept it below the grounding threshold.
Thus the observed transport/context problems improved, but not every target passed.
No source registration, payment or end-to-end paid pilot is claimed by this evaluation.

## v0.22.6 follow-up

Synthesis now selects bounded verbatim excerpts by ID. The final live check again used
the same two questions and supplied targets, with four calls served by DeepSeek v4 Flash
without fallback. All selected quotations passed textual validation: zero dropped evidence
for either question, including the previously overlong reward-check excerpt.

Final ledger coverage was 1/0.6 for the reward question and 0.3/0.6 for recovery. The
answer and selected excerpts covered access versus citation payment, quotation/marker
requirements, journaling, and GET-only resume without signing or replay. The journaling
target still scored below 0.4 under the separate model assessment. This small, first-party
model evaluation therefore does not establish complete research quality or external demand.

Tests cover sentence selection, long text/Unicode boundaries, exact source substrings,
unknown and cross-source IDs, raw-text injection, and unchanged downstream ledger checks.
The quote menu adds bounded prompt text but no extra model call, fetch or payment.

## v0.22.7 follow-up

Coverage now assesses only the requested question, with a defined rubric and validated
source markers. Removing the buyer article's procedure text while retaining its title
and provenance made both recovery targets score zero and the sufficient flag false.
With the complete articles, coverage assessments recognized the explicit answers.

Calibration alone exposed a remaining false positive: synthesis assigned a quote about
resuming after failure to the target asking how the job is preserved before submission.
The new separate relevance pass rated that pair zero. Final ledger coverage was 0.8/0.9
for access/reward checks and 0/0.7 for journaling/recovery behavior. The result is therefore
still partial; rejecting the mismatched quote is the intended improvement, not a claim
that the full pilot now succeeds.

The two-question final check used four orchestration steps plus one bounded review
request inside each synthesis (six model requests). Review status was completed for both.
All passes used DeepSeek v4 Flash; a second pass on the same model is not independent
factual corroboration. No source registration, paid job or settlement was performed.
Unit tests verify that review cannot raise support, malformed/missing/duplicate entries
fail closed, and a reviewer outage retains the draft with zero support and a visible trace.
