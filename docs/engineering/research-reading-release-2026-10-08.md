# Coordinated research reading release — October 8, 2026

The active successor is the [app0.27.38 issue-resolution aggregate](open-issues-2026-10-08.md).
It retains this complete source and PR239. The app0.27.36 evidence and failures
below remain historical; the successor requires its own exact-head acceptance.

App **0.27.36** is a source candidate for one coordinated release through PR237.
It includes the reviewed reading/client stack and merged main app0.27.35. Earlier
app0.27.28–34 numbers identify source checkpoints, not separate deployments.
Required final-head CI, production recovery and distribution evidence remain open.

## Source inclusion and release sequence

Main contains app0.27.35 at `ab2195d6`. The combined branch retains that source and
all eight feature tips below. Use a merge commit to preserve exact ancestry and
one increasing app version. This supersedes active parent-first sequencing in the
individual candidate documents; their validation, custody, spending, operational
and delivery gates remain required.

| PR | Retained tip | Included behavior |
| --- | --- | --- |
| 226 | `701395fa` | Withhold unqualified newest-feed articles before reading |
| 220 | `87a33a77` | Show observed model output ceilings across shared results |
| 222 | `a2592bc6` | Free paper lookup and library handoff |
| 228 | `f888ac5b` | Readable report headings and responsive reading navigation |
| 229 | `b4a472fc` | Validate new MCP questions before custody or funding |
| 233 | `5bdceb3b` | Confirm feedback after the authoritative response |
| 235 | `b899f74b` | Retain observed HTML preformatted/heading evidence context |
| 237 | `200a4909` | Readable stored excerpts and accessible citation inspection |

Integration retains both recency gaps and exact item/source claim associations.
A synthetic regression verifies that withheld newest-feed evidence creates no
citation, operating fee, funding request or payment. Main's fee policy, receipt,
custody and settlement implementations remain intact. This plan activates no fee
policy, renews no trial and authorizes no additional paid task.

Before merging, verify every current parent PR head is included in the exact
reviewed aggregate head, complete required CI for that head and recheck current
main. After merging, retain the final merge SHA and each included tip in the
closure record. Close any still-open parent PR with an explicit inclusion record;
do not describe it as separate publication. A changed parent head requires another
inclusion review.

After merging, main-push `build-and-test` must succeed on the final merge SHA
before the existing versioned GitHub release job can run. Completed successful
main-push `CI` and the applicable artifact workflow gates are required before npm/
Registry publication or deployment. Pre-merge head CI does not replace them.

## Verification and operational delivery

Before the mobile-header adjustment, the combined runtime passed 509 focused
tests/23 files, both TypeScript graphs,
scoped lint and the default Next16.3.8 build. Actual components with built CSS
passed four viewport widths across six quote views; traced HTML/PDF workers and
the minified Ask reader/engine quote-context fixture also passed. Independent
source and integration reviews found no blockers. Documentation-only changes may
reuse that runtime evidence when native blobs remain identical; final-head CI
remains required. A previous green head does not qualify a changed runtime.

Exact `87d7d336` CI then failed its 320x640 first-viewport action assertion.
The retained local production build reproduced it. A compact mobile introduction
addresses that layout while preserving controls and disclosures. Require a fresh
default build, unchanged responsive assertions including the wrapped-cap case,
related form/keyboard/payer checks and final-head CI for this adjustment. Earlier
unit evidence is reusable only for the unchanged runtime/test/config blobs.

Git release, deployment admission, ordinary public recovery, the separate owner's
paid original delivery and fee activation have distinct evidence. An admitted
deployment target window must close or be parked before main advances. A successor
must bind the new source and preserve historical predecessor seals. A held/failed
runtime does not establish recovery; financial original delivery is not itself a
Git merge prerequisite. Coordinate with the operational owner and preserve its
sessions, grants, journals, rollback paths and deployment authority.

After operational admission, deploy current `origin/main` through the repository
workflow and verify `/api/health` reports that commit, version and network.
Preserve existing limits and operational state. Publish the product update only
after verified delivery, with no inferred traction figures.

## Supported surfaces and distribution

| Surface | Source identity or role | Required evidence |
| --- | --- | --- |
| Web/shared API | App0.27.36; public/private reports, feedback and lookup | Final-head CI, built browser checks and deployed commit/health |
| Human/buyer CLI | Shared report/results; deliberate research/payment handoff | Applicable startup/export checks and current server identity |
| Hosted remote MCP | Protocol0.3.5 candidate | Live initialization/tool inventory and hosted source/version readback |
| Caller stdio MCP | Package0.4.9 candidate | Final-source packed/clean-install consumers, immutable npm integrity/provenance and exact/latest Registry readbacks |
| Native desktop/Operator | Desktop0.4.10 candidate; existing private operations role | Final-source packaged Windows/standard-user acceptance, installer/portable hashes and release-manifest source identity |
| Extensions/bots | Existing caller/result roles; no new payer authority | Shared-contract compatibility and applicable source/artifact identity audit |

Web rendering changes reach clients that open those pages. Native desktop keeps
its separate role and acquires no bibliography/research body. Raw quote/receipt
contracts and historical saved content remain unchanged. Source versions, dated
records and successful CI alone do not prove current npm, Registry, installer or
installed-client delivery. Installed upgrades and Chrome Web Store availability
require their own readbacks when claimed.

Keep branches, worktrees, archive/dependency junction targets and rollback evidence
until full merge provenance, required delivery and verified archival make cleanup
eligible. Follow `AGENTS.md`; leave remote branches and tags intact.

## Usefulness and traction

This release improves reading and observable client behavior. Current-feed
observation, factual correctness, complete synthesis, independent human usefulness,
retention and demand remain separate work. Synthetic fixtures/software clients are
distinct from independent users. Existing product validation, issues230/231 and
separately owned real-client recovery remain open. New live trials or outreach
require their applicable authorization; this plan adds none.

See [surface parity](../surface-parity.md), [MCP distribution](../mcp-distribution.md)
and [product validation](../product-validation.md) for wider acceptance boundaries.
