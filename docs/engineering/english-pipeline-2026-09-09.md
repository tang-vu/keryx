# English pipeline diagnostic, September 9, 2026

Ten model-only runs exercised real planning, assessment, synthesis/relevance review
and the deterministic evidence ledger against the two first-party Engineering articles
or an empty corpus. Unlike the earlier boundary script, targets were not supplied by
the evaluator. This does not exercise discovery, paid delivery, cache selection or
settlement. No USDC purchase was made; the diagnostic uses model API requests.

## Reproduce

`node --import tsx scripts/eval-english-pipeline.mts --check` checks the five fixtures
and corpus without model calls. With `KERYX_LLM_MODEL` and `KERYX_SYNTHESIS_MODEL`
set to `deepseek-v4-flash`, run
`node --import tsx --env-file=.env.local scripts/eval-english-pipeline.mts --live`.
It runs two rounds of five cases, up to 40 direct requests, without reasoning fallback
or automatic retry. Completed rows survive an error. Exit zero means completion,
not semantic correctness; inspect target preservation, answer prose and quotes.

The script saves original model outputs and ledger results under ignored
`.artifacts/evals/`; subsequent runs also retain the exact selected context. The
initial run artifact was `english-pipeline-2026-09-08T17-46-11-577Z.json`
(September 9 in Vietnam). TypeScript and fixture validation passed.

## Observed results

| Case | First round coverage | Second round coverage | Manual inspection |
| --- | --- | --- | --- |
| Pilot recovery question | 0.6 / 0.9 | 0.8 / 0.95 | Two substantive targets; supported journaling and recovery answer |
| Receipt verification plus missing SQL isolation | 0 / 0 | 0.5 / 0 | Wrong explanation of receipt verification in both rounds; see below |
| Access versus citation, and finality | 0.8 / 0.9 | 0.5 / 0.8 | Distinguishes payment legs and explicitly rejects finality inference |
| External success rate and p95 latency | 0 / 0 | 0 / 0 | No invented operational metrics; no reward-eligible evidence |
| Recovery with empty corpus | 0 | 0 | No supported answer or reward-eligible evidence |

The SQL isolation question also remained unsupported in both rounds. These results
are narrow first-party checks, not a measured production success rate.

## Reproduced receipt-verification failure

Question: "How does Keryx verify a research receipt, and which SQL isolation level
does its buyer journal use?"

Planning preserved both questions. However, assessment and synthesis confused
portable-receipt verification with evidence/reward validation. They described source
markers, the support threshold and reward authorization rather than canonical digest
and request binding. The second review allowed some wrong-topic evidence through at
support 0.4/0.5; the first review rejected it. This is not simply a false negative
or a missing SQL answer. Raising its coverage would not repair the answer.

Read-only reproduction of `selectEvidencePassages` on the buyer article found:

- The full 3,071-character article contains the canonical SHA-256 explanation.
- Selected ranges were `[0,500)`, `[1200,1700)` and `[2400,3071)`.
- Those ranges omit that explanation and instead include generic recovery/status
  wording. Synthesis therefore lacked the strongest available relevant passage.
- Some proposed quotes from the other article started or ended mid-word. Exact
  substring matching alone does not guarantee a useful or relevant quotation.

Next engineering work: repair and test passage selection for this concrete case,
then rerun mixed supported/unsupported cases. Keep the source-text budget, verbatim
provenance and reward gates intact. A context repair also needs semantic retesting;
it cannot by itself prove that the reviewer stops accepting wrong-topic evidence.
No production behavior or old receipt was changed by this diagnostic.
