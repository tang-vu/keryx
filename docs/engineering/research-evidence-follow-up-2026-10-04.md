# Evidence identity and context after the live comparison

Application 0.26.8 is a candidate until review, required CI and production
verification pass. This follows [the original-reader update](research-quality-2026-10-04.md)
and its separate, additionally authorized USD 1 comparison. Internal pipeline
completion, useful deliverables and independent customer acceptance remain distinct.

## What the additional live run established

One full attempt ran R01-R18 from the retained final source captures on October 4,
2026, 14:39-14:43 UTC. The source was `15db8c4`, tree-equivalent to PR 155's merge
`6562ebe`. The database and x402/payment effects were isolated; no live source
payment, new discovery request or production database was used.

Fourteen of eighteen pipelines completed. R06 exceeded the eight-target bound;
R12, R13 and R18 proposed an actionable source without valid research targets and
were refused. Their failures remain in the denominator. Ninety-one model calls
reserved USD 0.511144 at the conservative tariff, below the additional USD 1 cap.
Reservation is not the provider invoice. The requested alias was
`deepseek-v4-flash`; provider-documented alias/model changes and nondeterministic
model output limit attribution of differences to the reader changes alone.

The retained usage covers all 91 calls, including the failed cases: 121,085 input
tokens (24,448 cached) and 42,341 output tokens. The dated tariff interval is
USD 0.039973494-0.079946988, not an invoice observation. Using the same internal
editorial rubric, two fictional tasks were narrowly usable, nine were partial and
seven were rejected. These are author assessments, not independent customer
acceptance; R09 was rejected for its identity defect despite completing the pipeline.

The previous result is not replaced: the earlier initial attempt completed 15/18,
with three separately retained diagnostic reruns. Its USD 0.487281 reserve belongs
to a different, completed authorization. New diagnostic results, if any, must be
reported separately and use the current comparison's unchanged cumulative ledger.

The new run exposed three specific defects despite passing literal excerpt checks:

- R09 admitted excerpts from CAVA `2607.13716v1` under targets explicitly asking
  about Weng `2606.02668v1`. Both original HTML documents had been read. URL handling
  recognized `abs` and `pdf`, while `html` bypassed the exact-paper checks.
- R01's retained SQLite text included the qualification about large transactions
  from version 3.11.0. Bounded context selection dropped that adjacent qualification
  before synthesis and the delivered excerpt preserved the older advice.
- R03's retained SQS text included the at-least-once delivery exception. Context
  selection omitted it before synthesis while a duplicate-prevention excerpt was
  admitted. Literal quotation and a Low confidence label did not repair the omission.

These observations identify source-binding and context-selection failures. They do
not show that the producer received and ignored those omitted qualifications, or
that correcting input context guarantees a materially correct finished answer.

## Exact original-paper admission

For an explicit exact-paper target, admission uses the document URL retained with
the read and its exact version. Canonical arXiv `abs`, `pdf` and `html` URLs share the same identity
rule. IDs in query strings, fragments, lookalike hosts or discovery metadata cannot
replace an absent or conflicting observed identity. Unidentified, unversioned or
secondary documents remain unsupported for that exact original-paper target.

The public original-fetch path records its observed final URL before attaching scholarly
discovery metadata. It has no legitimate need to treat metadata alone as original
evidence; the old metadata-only test fixture now supplies the observed URL. This
boundary is intentionally stricter than interpreting any URL containing a paper ID.
Supporting mirrors or secondary commentary would need explicit provenance handling.

Paid creator and cache paths retain the catalog item's URL rather than independently
observing an arXiv transport URL. Their existing catalog/receipt trust remains;
this change verifies recorded URL/version binding, not independent origin,
authorship or truth. It removes a fallback and tightens eligibility without granting
new metadata or payment authority.

Re-admitting the retained R09 proposals against the same snapshot hashes removed
all five cross-paper proposals, including four previously qualified excerpts. Nine
retained records with eight qualified excerpts became four records with four
qualified excerpts. Legitimate own-paper evidence remains, and the now-unsupported
targets show zero coverage. This is an offline original-artifact replay, not a new
model run, successful synthesis, refund or retroactive rewrite of an archived answer.

## Bounded context preservation

Keep a selected newline-delimited source block intact when it fits the existing
600-character passage ceiling. Larger blocks remain bounded excerpts with explicit
omission metadata. The source scan remains at most 200,000 characters and the model
context at most 2,000 characters per source; no extra fetch or model request follows.
Structural context preservation is not a test for semantic caveats or entailment.

Independent review caught a scan-cut block incorrectly labeled whole and a
resource regression on many short lines. The corrected selector marks continuing
source text, nominates at most 5,000 candidates and retains at most 145 for eight
targets. Sampling/retention limits remain explicit. Dense and varied repeated-word
fixtures preserve eight distinct late targets; these are bounded retrieval checks,
not a production latency or semantic-completeness guarantee.

The retained R03 replay now exposes the delivery exception in both the selected
context and bounded quote options. For R01's original broad eight-target query,
the entire old transaction paragraph is omitted: neither its advice nor the
version qualification is selected. A focused transaction query can select the
whole paragraph. Report the broad task's omission honestly rather than forcing
one benchmark sentence into the fixed budget or claiming complete source coverage.

The relevance review still assesses selected quotations, not a complete assertion
ledger. Better context availability cannot establish that the final model chooses
the right qualification.

## Separate post-fix diagnostic

One R01/R03/R09 diagnostic ran against candidate `e89539d` at 15:25 UTC using the
same captures and cumulative allowance. It completed one of three pipelines:
R01 was partial; R03 and R09 were rejected. There were no retries. The original
18-case scorecard remains unchanged.

R01 delivered the SQLite 3.11.0 qualification and excluded the older 100 MB advice,
which remained a rejected evidence proposal. It still lacked the requested
decision brief and complete backup/restore checklist. This attempt sampled five
targets rather than the original eight, so it is not a controlled causal test.
R03 and R09 both stopped at source-decision validation before producing an answer:
an actionable source lacked valid research targets. Their offline context and
identity regressions cannot substitute for successful live workflows.

This harness deliberately injects a single bounded provider without retry or
fallback. Production's configured `ResilientEngine` can retry or move to another
tier; these failures therefore do not establish that production dispatch fails
the same way. The malformed decisions stopped before source reads or funding.
Keep the provider failures in this experiment's denominator. A separate production
resilience evaluation must expose degraded tiers and measure the resulting artifact,
not count fallback alone as usefulness or relax the target authorization gate.

The diagnostic added ten returned calls, 14,522 input tokens (2,176 cached),
4,795 output tokens and USD 0.057314 in conservative reservation. The combined
allowance now records 101 calls and USD 0.568458 reserved of USD 1. All calls have
usage records; the cumulative recorded-token tariff interval is
USD 0.044708922-0.089417844, with the invoice charge unknown. The ledger was never
reset or extended. Captures, baseline and initial reports remain unchanged.
Source payments stayed denied, with zero USDC spent. No further model calls are
part of this diagnostic.

## Release boundaries and remaining acceptance

The final answer remains subject to D-300. No arbitrary synthesized prose is enabled,
no new model score certifies entailment, and the existing quote/qualification limits
and final-projection-before-attribution ordering remain authoritative. No database,
registry, custody, cap, nonce, settlement or scheduler migration is introduced.

Shared hosted research serves web/SSE/history, APIs, A2A, remote MCP,
OpenAI-compatible output and saved reports. CLI/stdio MCP, desktop, extensions and
bots retain their existing client or handoff roles. Archived receipt and answer
bytes are not rewritten. MCP/desktop remain 0.4.3 and extension 0.1.1; verify each
actual release asset and installed-client acceptance separately from hosted health.

The reviewed deployment log must describe maintenance accurately: its web/A2A roles
are stopped during source synchronization and build, and separately held workers
need explicit restoration verification. The legacy live-build messages do not
describe that path. The wording correction changes no operational command.

Complete synthesis still needs a viable policy for unseen tasks and measured
unassisted usefulness/error rates. A proposed fixture-only renderer relying on
human semantic mapping was independently reviewed as an offline prototype, not an
accepted autonomous B04/B05 architecture. Keep that product gate open rather than
relabeling a quote worksheet or a structural check as a finished decision.

Before final CI, 79 focused identity/admission/discovery tests and 31 focused
context/quote tests passed. Application and operations TypeScript, lint (five
existing warnings), deployment orchestration checks and local documentation links
passed. The independent reviewer closed the identity, scan-boundary and candidate
retention findings. Required CI, production commit and distribution readback remain
release gates; focused source checks are not a deployed-release claim.
