# Retained deliverable contracts — issue287

This evaluation tool inspects two already retained public answers. It
does not run the research agent, contact a provider, search, read an original page,
access a database or authorize payments. It changes no runtime, package version,
receipt, saved answer or financial field. Issue #287's public scorecard and live
release acceptance remain open.

## Run and interpret

Use the project's supported Node runtime and existing dependencies, without an
environment file:

```sh
node --import tsx scripts/grade-retained-deliverables.mts
node --import tsx scripts/grade-retained-deliverables.mts --validate-corpus
node --import tsx scripts/grade-retained-deliverables.mts --validate-corpus --output .artifacts/deliverable-report.json
```

Normal grading exits 1: these snapshots fail their deterministic format contracts,
and version 1 has no semantic acceptance judge. `--validate-corpus` exits 0 only for
valid, hash-bound inputs and still prints their failing grades. Exit0 means corpus
inspection succeeded, not that a deliverable was accepted. Missing, malformed,
oversized, stale or duplicate inputs and output collisions exit 2; an output file is
created exclusively and never overwritten. No live flag or retry exists.

The report separates `deterministicContractPassed`, `outcome`, and
`deliverableAccepted`. A structurally passing answer stays `UNJUDGED`, with
`deliverableAccepted:false`. Language and required-fact correctness are always
`UNJUDGED`; requested-language metadata is not a language detector. The accepted
deliverable rate is `null`, not0 or a fabricated quality score.

## Rubric and boundaries

Version 1 counts unindented Markdown bullet rows, excluding fenced code, block
quotes, nested rows and horizontal rules. It is a declared subset, not a general
Markdown parser. The reviewed `bulletRegion` starts at0 and ends before the
recorded original-source-status section. Its exact substring digest and the
contract's reviewed excluded-suffix digest prevent a self-hashed range from hiding
an extra answer bullet. Without an explicit suffix contract, the region must cover
the entire answer. The source-status list remains in the complete saved answer;
it is not a requested answer bullet.

The word-limit measure uses whitespace-delimited tokens across the **entire saved
answer**, including confidence warnings, headings, citations, limitations and
original-source status. This is not linguistic segmentation; Chinese text without
spaces is not counted as individual Chinese words. The rubric does not infer a
length limit from arbitrary caller language: each reviewed contract states its
explicit expected count/limit.

Recorded binding checks require the contract's exact target, marker, source, item,
URL, content-version and quote digest, with neither missing nor extra rows. Each
escaped excerpt and its marker must remain in one answer paragraph. Duplicate or
unbound targets are refused. These checks inspect the captured public record;
they do not retrieve the source body, replay model review, prove entailment,
authenticate publishers or create evidence/reward authority. Only public free
reference rows with `qualifiesForAnswer:true` and `qualifiesForReward:false` belong
to this initial projection. Private originals, paid packets, owners, keys, payout
data and runtime capabilities have no fields in its strict schema.

The manifest and fixtures must be exact UTF-8, two-space `JSON.stringify` output
with one final LF. This intentionally narrow corpus format rejects duplicate keys,
ambiguous byte forms and hidden trailing data. A directory-scoped Git attribute
keeps only `deliverable-*.json` in LF form on Windows checkouts. Local reads are capped, regular-file
only; case names cannot escape the manifest directory. Traversal is bounded before
schema validation, including accessor, cycle, nesting and Unicode refusal.

The report includes the raw manifest and fixture SHA256 values plus grader-module,
portable-validation and dependency-lock byte hashes checked before/after grading.
This is a source/input fingerprint, not a clean-Git, published-package, installed
dependency or production attestation. The historical deployed commit in each
snapshot describes its capture, not the current grader branch.

## Initial public corpus

The questions and answers were projected from the owner-operated public retest
recorded on 2026-10-09, app 0.27.44 at
`380647b10a924e231ebe98123028877d8c5ee187`. Projection copies only public question,
exact answer and qualified reference-binding fields. Original capture hashes and
actual capture timestamps are recorded in each fixture; no private identities or
financial rows were copied. The original retest used model calls. The grader makes
zero new calls; its zero-call counters do not describe the historical retest cost
or a new live acceptance allowance.

| Case | Recorded measurement | Retained binding inspection | Semantic/language judgement |
| --- | --- | --- | --- |
| [MDN button, issue #238](https://keryx.cc/dispatch/6c41b95d-7877-4403-8b52-988d924f132d) |0 answer bullets; requested 3. 415 full-answer tokens. |5 rows over 4 target identities remain. |UNJUDGED |
| [RFC 4180, issue #230](https://keryx.cc/dispatch/52b1aa1e-fce4-4a55-94f4-d35ca65407c6) |296 full-answer tokens; maximum 180. |3 rows over 3 target identities remain. |UNJUDGED |

Both deterministic contracts fail: initial pass rate 0/2. These are two cases from
one owner-operated retest, not a representative success rate, independent customer
study or release trend. Coverage is `single-page` only. Exact metadata, comparisons,
teaching notes, newest-release cases and other open failure classes remain absent;
the report explicitly records incomplete issue coverage.

## Surface applicability and remaining gates

This outcome applies to a local maintainer CLI and its machine-readable diagnostic
report. Web, desktop, API, buyer CLI, remote/stdio MCP, extension and bot research
outputs remain unchanged; no new consumer projection or distribution is added.
No runtime version, installer build, deployment or product announcement is needed
for this CI/evaluation maintenance outcome. Focused tests, TypeScript checking and
the applicable exact-source CI aggregate remain PR gates.

Before claiming issue #287 complete, review a corpus covering every open failure
class, obtain consent for any private question, define the full completeness and
language rubric with independent review, agree on regression margins, bind new
release-candidate captures to their actual commit/allowance and publish a dated
scorecard with failures and removal history. Retained snapshots do not establish
the usefulness of a new release or replace a separately authorized live trial.
