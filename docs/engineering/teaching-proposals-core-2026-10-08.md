# Reviewed teaching proposal core - October 8, 2026

This pure server-side helper slice implements the dependency and review contracts
for issue [211](https://github.com/tang-vu/keryx/issues/211). It does not activate a
new provider call or a teaching workflow. Shared engine/result integration and a
complete rendered lesson remain separate gates in
[prospective-delivery-gates-2026-10-08.md](prospective-delivery-gates-2026-10-08.md).

## Original caller admission

`parseTeachingProposalRequest(originalQuestion)` returns a strict typed request
only for an explicit supported scope: Vietnamese or English, one activity of
1–30 minutes, 1–4 classification examples, one exit question with an answer, and
an explanation ceiling of 1–200 words. Every scope must be present once, with
an explicit proposal cue. The initial finite grammar covers the retained
Vietnamese request and explicit English equivalents; it is deliberately not a
general lesson interpreter. Ambiguous, negated, quoted, unsupported or excess
scope remains inactive. A later unsupported language instruction cannot retain
an earlier supported language override.

The request binds the exact raw original question by SHA-256 and is reparsed
before use. Source text, model output, a prior turn or a public JSON flag must
not be supplied as `originalQuestion`. Exclusive "under 100 words"/"dưới 100
từ" becomes a maximum of 99; inclusive ceilings remain inclusive. Word count
uses whitespace-delimited words in admitted factual explanatory sentences.
Exact excerpts, citation controls, activity steps and example/question answers
remain separate. Overlong admitted explanation is reported as a gap; facts are
never truncated to manufacture compliance.

## Integration sequence

1. Admit the original caller request before ordinary generation. Absence keeps
   historical input/prompt contracts unchanged, including private continuation.
2. Within existing generation bounds, add `teachingProposals` alongside factual
   evidence using `TEACHING_PROPOSAL_GENERATION_GUIDANCE`. Proposal shape:
   `{ id, kind, text, premiseIds, conditions }`; activity adds `durationMinutes`,
   while classification examples and exit questions add `answer`. IDs `t1`–`t6`
   are unique; `eN` refers to the Nth returned factual evidence row, not a claim
   index. Keep row positions when resolving quotes, including invalid rows.
3. Call `prepareTeachingProposals(request, originalQuestion, resolvedEvidence,
   rawProposals)`. This builds a copied, SHA-256-bound packet and explicit gaps.
   The packet contains no source acquisition or payment authority. At most six
   proposals depend on at most four exact premises each, from at most 32 rows.
   Activity text is at most 600 characters, example/question text and answers
   at most 240 each, and at most two hypothetical conditions of 180 each.
   Single-line well-formed text cannot carry source citation controls.
4. Include `teachingProposalReviewInput(packet)` in the existing independent
   factual review, retaining its full source context and quote neighborhoods.
   Keep its existing call, output and spending bounds. If the proposal addition
   cannot fit, preserve the ordinary factual path and withhold proposals.
   `reviewTeachingProposals(packet, rawJudgments)` requires exact digest, IDs and
   ordered premise IDs, with independent verdicts for premise consistency,
   conditions, instructional consistency, source attribution, requested scope
   and language. All six must be `supported`. Missing, duplicate, foreign,
   malformed or extra judgments withhold the entire proposal review; explicit
   rejection withholds only the affected proposal.
5. After final assessment and evidence-ledger construction, supply the output
   of the independently reviewed `selectCitedStatements` to
   `deliverTeachingProposals(request, reviewed, finalLedger, admittedStatements,
   preparation.gaps)`. Every exact premise text, quote, claim and marker must
   still be admitted, with sufficient final coverage and one unambiguous source
   identity. Missing dependencies withhold dependent proposals. Repeated exact
   physical premises cannot count as distinct dependencies through different
   row IDs. Packet shape/dependencies are revalidated even when a digest is
   recomputed. Runtime-issued review objects cannot be reconstructed from JSON
   or mutated to promote rejected IDs.
6. Render returned proposals separately with their provided labels and
   `proposed-teaching-only` authority. Retain every admitted factual sentence
   beside its own exact excerpt and existing citation/payment state. Cite the
   factual premises; never imply that NASA/source designed, performed or tested
   the proposed lesson. A day's weather cannot establish a climate trend.
   Serialize only final delivery data, not the internal review object.

The final result reports exact requested-kind counts, explanation word count,
gaps and `complete`. Separately admitted siblings remain useful when another
proposal is withheld. An excess count withholds all proposals of that kind;
the helper never chooses an arbitrary subset to force compliance. Proposal
rows/labels must never enter factual assessment, citation admission, confidence,
reward allocation, receipts or payment signing. They contribute zero factual
coverage and zero creator-reward authority.

## Validation and remaining gates

Focused offline tests use the real evidence ledger and cited-statement selector
with explicitly synthetic classroom premises. They cover original-question
admission, immutable binding, strict packet/review shapes, duplicate and absent
dependencies, dependency withdrawal after review, count/word overflow, partial
delivery, and unchanged ledger/reward state. This verifies the contract, not
NASA correctness or successful live lesson delivery.

Root integration must thread the ordinary opt-in through planning, generation,
existing independent review and final result/export adapters across applicable
web, desktop, CLI, API and MCP research surfaces. Protected private originals
and no-opt-in runs need historical contract regressions. Rendered Vietnamese
fixtures must demonstrate all requested lesson parts and their gaps, correct
labels, exact preserved factual excerpts and bounded mobile/desktop layout.
Shared type checking, scoped lint, focused regressions and production build
remain integration checks. A separately authorized bounded real lesson trial
with inspected output is still needed before closing the issue as complete.
