# Retained quality scorecard — issue #287

> October10: the default composition now retains six public cases/five requested
> languages and partial/zero-binding failures. See the
> [successor corpus record](retained-failure-corpus-2026-10-10.md). Both original
> frozen scorecards and their two-case results below remain unchanged; the
> expanded suite is not comparable as a release trend.

The maintainer scorecard composes the existing two public retained deliverables into
one dated diagnostic record, with totals by declared question kind and exact requested
language, failing checks, and a visible coverage plan. It performs no research, source
retrieval, model/search request, payment or database operation. It does not decide
semantic acceptance, release readiness, creator rewards or customer approval.

## Reproduce the composition

With Node 22.19+ or 24+ and existing dependencies, without an environment file:

```sh
node --import tsx scripts/compose-retained-quality-scorecard.mts
node --import tsx scripts/compose-retained-quality-scorecard.mts --output .artifacts/quality-scorecard.json
```

The inputs are fixed: the existing canonical `deliverable-corpus-v1.json` and its
two hash-bound public fixtures, plus the new public issue inventory and coverage
registry in `fixtures/evals/quality/`. The helper recomputes the original grader's
checks. It verifies canonical manifest, fixture and inventory digests, exact case
sets, issue identities and case mappings. Input copies are bounded to 1 MiB each;
there are at most 32 cases and 128 inventory/registry issues. No input can add a
private wallet, payment field or caller-supplied PASS/acceptance judgment.

Exit0 means the composition completed. A scorecard containing two failed contracts
and semantic/language `UNJUDGED` still exits0. It never means accepted answers.
Invalid inputs, unsupported flags and output collisions exit2. Output uses an
exclusive file, complete writes, fsync and exact readback. There is no live flag,
environment-file loader, retry, baseline rewrite or network fetch in the runner.

The recorded inspector HEAD and before/after source fingerprints are separate
from the snapshots' capture dates and deployed commits. They do not attest clean
Git, installed dependencies, compilation, production deployment or a new answer
from this release. A new inspector regrading identical archived captures is not
a release trend. The checked-in frozen composition records its actual inspector
checkpoint; later documentation/data commits do not relabel that execution.

The [original frozen composition](../../fixtures/evals/quality/scorecard-20261009.json)
was inspected at `2026-10-09T12:33:38.255Z` on source checkpoint
`21a328484236198740e76ee7e8c07c9f551254a9` using Node `v24.21.0`.
Its complete-file SHA256 is
`5407e206154c5a9679345512e096a99ae2e73057e6c9e63dd60077eef12a87e0`.

After review corrected no-policy removal validation and the Node metadata floor,
the [corrected-source composition](../../fixtures/evals/quality/scorecard-20261009-corrected.json)
was inspected at `2026-10-09T12:46:12.796Z` on checkpoint
`02fe224695ece6db92bcef6437365a1484ef5e39`, again using Node `v24.21.0`.
Its complete-file SHA256 is
`ac1650383b812baaf50b837221b039069da6cb53e88a4f2754608450a9f5110d`.
Both inspect the same two archived captures; this is a source correction, not a
new answer cohort or an improvement trend. The original run remains historical.

## Current evidence and denominators

These remain the owner-operated app0.27.44 snapshots at
`380647b10a924e231ebe98123028877d8c5ee187`, already projected and reviewed in
[retained deliverable contracts](retained-deliverable-contracts-2026-10-09.md).
No new private or user question is collected.

| Declared group | Cases | Deterministic passes | Semantic/language judgment |
| --- | ---: | ---: | --- |
| single-page | 2 | 0 | UNJUDGED |
| en | 1 | 0 | UNJUDGED |
| pt-BR | 1 | 0 | UNJUDGED |

MDN has 0 answer bullets for a request of 3; RFC has 296 full-answer whitespace
tokens for a maximum of 180. Every case remains in all relevant denominators,
including failures and unjudged cases. Empty question-kind groups have a null
pass rate. `pt`, `pt-BR` and other declared language variants remain distinct.
Requested-language metadata is not a language detector.

Useful-answer rates are **null**, including all groups. These two format failures
are not a representative customer success rate or an independent completeness
study. Literal retained bindings do not establish entailment or source-body truth.

New inspection calls are exactly 0. Historical capture allowance and cost are
explicitly **UNKNOWN/null**: the old snapshots do not carry that evidence. Their
historical model calls must not be relabelled as the runner's zero-call inspection.

## Dated coverage plan and removals

`open-issues-20261009.json` contains a bounded read-only public GitHub issue-list
snapshot, with date and digest. `coverage-v1.json` selects 12 answer-quality issues
and records a maintainer plan for regression question kinds. This is a selected
taxonomy, not a complete interpretation of every issue's acceptance criteria or
a claim that one case covers an entire issue. Only #230 and #238 presently map to
retained cases. Exact metadata, comparison, teaching-note and newest-release
cases are absent. Language-related issues remain uncovered/UNJUDGED.

The schema refuses unknown cases, duplicate mappings and a case falsely assigned
to an unrelated issue. `completeOpenIssueCoverage` remains false even when all
selected kinds have examples. Full coverage needs reviewed criteria and cases
for every open failure class, not merely five labels in a registry.

Case removals require an explicit reason, date and previous-suite digest and are
printed in the scorecard. They do not silently improve a denominator or count as
approval to remove a case. Comparing different suites is always NOT_COMPARABLE;
an undocumented removed case refuses the comparison even when no diagnostic
policy is supplied. Removal accountability precedes policy availability.

## Diagnostic comparisons and release gates

The pure comparison helper accepts two full input packets and recomputes both
scorecards. Without a supplied deterministic-contract policy, or with identical
retained captures, it returns NOT_COMPARABLE. An explicit diagnostic policy can
flag a drop beyond its integer basis-point threshold using exact bounded count
arithmetic. At the threshold itself it does not flag a drop. This compares only
format/binding contracts; it is not an attestation of owner agreement or a
semantic/usable-answer release gate. Invalid policies refuse rather than default
to a lenient margin. No agreed useful-answer regression margin is invented.

Issue #287 remains open. Required next evidence includes a complete reviewed
failure-class corpus, explicit consent for private questions, independently
qualified completeness/language judgments and human spot checks, an agreed
release regression margin, actual release-candidate captures with their exact
commit/allowance, and a public dated scorecard with trend and removal history.

## Supported surfaces and validation

This is a local maintainer evaluation tool and portable diagnostic fixture. Web,
desktop, buyer CLI, remote/stdio MCP, API, extensions and bots continue their
existing research behavior. The tool imports no application orchestration,
payment, database, A2A or private Operator module. It adds no shared runtime
contract, package/installer version, deployment or product announcement.

Focused new tests cover denominator preservation, exact language groups, private
and malformed inputs, registry/case/hash identity, honest removal history and
diagnostic comparability/thresholds. App and ops TypeScript graphs and scoped lint
cover the new helper/runner; the runner has an explicit ops include. Existing 27
grader tests are reusable only while their source and retained fixtures are
unchanged. The frozen composition is an actual offline run, not a synthetic new
release answer; synthetic comparison cases exist only in unit tests.
