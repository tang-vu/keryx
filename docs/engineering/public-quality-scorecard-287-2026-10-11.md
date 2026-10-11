# Public dated quality scorecard — original issue #287

The `/quality` source milestone publishes the retained inspector's four frozen
assessments through a narrow whitelist. The final October 10 assessment contains
eight cases, five question kinds and five requested languages: **0 deterministic
passes, 8 failures**. Required-fact/semantic and language judgments are all
**UNJUDGED**, and useful-answer rates are **null**. This is historical evidence,
not a measurement of current production, customer success or release 57 acceptance.

The [original issue](https://github.com/tang-vu/keryx/issues/287) stays open.
Its full failure-class coverage, qualified semantic/language rubric with human
spot checks, agreed useful-answer regression margin, known bounded allowance and
exact release-candidate capture/delivery gates remain unmet. This page does not
perform additional research, model judging, provider/search trials or payments.

## Frozen provenance and denominators

| Assessment | Actual inspector timestamp (UTC) | Recorded inspector commit | Cases / failures |
| --- | --- | --- | --- |
| October 10 final eight | 2026-10-10T16:59:22.754Z | 84c96d21c1091f416fe3cea13a8edc849e962602 | 8 / 8 |
| October 10 earlier six | 2026-10-10T16:42:38.664Z | 52f52260f44661ecec5392bfcf67321dded06dc3 | 6 / 6 |
| October 9 corrected | 2026-10-09T12:46:12.796Z | 02fe224695ece6db92bcef6437365a1484ef5e39 | 2 / 2 |
| October 9 original | 2026-10-09T12:33:38.255Z | 21a328484236198740e76ee7e8c07c9f551254a9 | 2 / 2 |

Every assessment displays the sample, exact assessment date, inspector commit,
runtime, complete artifact hash, source/suite/corpus/capture/coverage fingerprints,
per-kind and requested-language diagnostics, retained failures, rubric statuses,
and per-case report/receipt capture timestamps, recorded answer commit and hashes.
The final group counts are single page 4 and each other kind 1; languages are
de 1, en 3, es 1, pt-BR 1, vi 2. Every case remains in its denominator.

The first six cases record app 0.27.44 at
`380647b10a924e231ebe98123028877d8c5ee187`. The two later cases are October 10
captures of saved October 7 runs on app 0.27.18 at
`c70006182a4d187b2c8b82f17ce9dc671a4b6c6c`. Artifact capture time does not
become the original answer's execution time. Hashes attest retained bytes and
recorded provenance, without independently verifying the original full receipt,
settlement, clean Git, current build or deployment.

Historical model/search allowance and cost remain UNKNOWN/null for all cases.
The existing offline inspector used zero new model/search/payment/database calls;
this does not turn historical capture costs into zero. Empty kind groups show a
null diagnostic rate. No structural PASS establishes factual correctness,
entailment or a useful answer.

Two/six/eight suites have different definitions and denominators; their sequence
is **NOT_COMPARABLE** as a release trend. The October 9 source correction reuses
the same two captures. The page preserves all four snapshot labels and the
historical October 9 issue inventory date rather than claiming today's issue
state. Its selected coverage mapping lacks retained examples for #158, #169,
#172 and #181. Full coverage remains false even though all five kinds have cases.
All frozen removal records are empty. Future removals require reviewed dated
reasons and previous-suite digests; the current projector refuses new removal
records rather than publishing arbitrary text or silently hiding a case.

## Public privacy boundary

`projectPublicQualityScorecard` consumes the existing pure inspector's result
shape. It strips unknown fields at every object boundary, selects only closed
kind/language/check/status vocabularies and reviewed issue numbers, validates
case/coverage relationships and dates, and recomputes display totals. It never
copies raw questions, answers, excerpts, diagnostic detail, source identities,
wallet/person/token fields, internal journals or original report/run IDs/URLs.
Independent stable public IDs `case-01` through `case-08` replace internal case
identifiers. Issue URLs are constructed from admitted public issue numbers.
No original raw artifact, private report or unlisted report is linked from the page.
Prior public availability is not consent to republish question/identity text.

The Node-only frozen loader imports fixed repository JSON compositions and checks
their canonical SHA256 against four reviewed digests. Tests separately verify
the complete raw file bytes, including the single LF at EOF, against those
digests. Runtime canonical checking is not a filesystem/raw-EOF attestation.
No filesystem path, URL, user-selected input, executable compose runner or
database is accepted by this route. The page and renderer remain Server
Components; only the explicit safe projection enters the rendering tree, HTML
and RSC. Full artifacts never enter client props. English catalogue copy and
existing locale-format facades add no locale activation or formatter change.

The projection rejects unsupported cases, contradictory totals, semantic or
language acceptance, invented known allowance, future capture clocks and new
removal records with generic errors. Frozen digest mismatch stops rendering.
This fail-closed source policy coexists with private/unlisted run policy work
without changing visibility, consent, storage or public report access.

## Supported-surface role audit

| Surface | Applicable quality contract / boundary |
| --- | --- |
| Web | Hosted `/quality` reference, reachable through README, with safe static metadata and English/x-default canonical links. No live quality API or run discovery. |
| Desktop | Can open the hosted reference through its ordinary browser role. No native evaluation, private workspace access or installer change. |
| CLI | Existing maintainer composition/grading remains the reproducible offline evidence source. Buyer/Operator CLI execution and output contracts are unchanged. |
| Remote MCP | No new tool, private run link or quality claim added. Hosted reference applies to archived evidence, not a tool's live outputs. |
| Stdio MCP | Same reference boundary; packaged execution, credentials and tool contracts unchanged. No package/version claim. |
| API | No assessment endpoint, live metrics reinterpretation or report visibility change. The public page does not fetch API data. |
| Extensions | Existing hosted browser handoff can reach the reference. Research submission, history and output contracts unchanged; no extension version claim. |
| Bots | No new message, report link or automated broadcast. Static public evidence does not grade bot replies. |

This user-visible hosted source needs root projection/provenance review before
PR publication, actual required aggregate and applicable domain/platform CI,
and root's coordinated release/deployment. Source readiness is distinct from
published or deployed identity. Root owns merge, main, version, distribution,
combined deployment and issue closure. No production, custody, schedules,
shared DDL, installation/cache mutation or cleanup action is part of this work.

## Proportionate validation

Focused offline tests compare the real projection with the existing pure
inspector on the unchanged eight-case corpus; bind all four raw frozen artifact
hashes; test denominators, historical dates, allowance/acceptance refusal and
case mappings; inject private sentinel fields/text/URLs into the real input
shape; and render the real page and metadata. APP TypeScript, scoped lint,
the existing UI-copy guard and an isolated Next production build apply to this
new route and server/client boundary. Build output privacy inspection includes
the prerendered `/quality` HTML and RSC plus client chunks. These local checks do
not substitute for actual required hosted CI or claim delivery.

The source candidate passed 20 focused tests, APP nonincremental TypeScript,
scoped ESLint and the source-only UI-copy guard. An isolated full Next 16.3.8
production build actually completed and prerendered `/quality`. Privacy
inspection passed on its HTML, RSC and 183 client chunk files (27 forbidden
identity/URL/private markers). Built loopback HTTP returned 200; desktop and
390-pixel mobile visual inspection found no document overflow, and historical
assessment details expanded. External browser requests were blocked; no research
was submitted. Temporary `turbopack.root` and Next-generated tsconfig edits were
restored and are excluded from the source outcome.

Local validation used Node 24.21.0, the retained npm 11.19.0 toolchain and the
read-only QA dependency junction. Its Vitest is 4.1.11, matching the repository
lock's resolved Vitest version (the manifest requests `^4.1.9`); no dependency
installation or exact equivalence of the entire dependency closure is claimed.
Unadjusted local Turbopack could not resolve the junction outside its filesystem
root; the full build used the documented common-ancestor root locally, preserving
the source config's loader rules. An initial route-filter build compiled but did
not prerender `/quality` and is not the accepted build evidence. Default Next
type validation is disabled by the existing config, so the separate successful
APP TypeScript check supplies that local evidence. Hosted required CI remains
the exact-install and aggregate/domain/platform gate.
