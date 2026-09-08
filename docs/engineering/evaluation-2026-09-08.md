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
