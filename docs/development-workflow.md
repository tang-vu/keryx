# Proportionate validation and release workflow

Owner-authorized October 8, 2026: reduce repeated PR/CI/release waits while
preserving product quality, security, reliability and maintainability. This
clarifies the standing release workflow; it grants no new payment, custody,
scheduler or production activation authority.

## One PR per coherent outcome

Keep related edits and review corrections on one focused branch and PR until
the outcome is complete. A small intermediate fix is not a separate release.
Commit checkpoints locally; push a reviewable candidate, then push again when
review findings or changed acceptance evidence require it. Keep independently
releasable work separate, and do not accumulate an unrelated large batch.

Specify observable acceptance criteria, affected surfaces and required checks
before release. Run focused local checks in proportion to risk. Reuse applicable
results for unchanged source and inputs; repeat checks after relevant changes,
failures or unresolved concerns. Local checks and hosted acceptance have distinct
purposes, but do not rerun the complete suite locally just to duplicate an
already accepted unchanged CI candidate.

## CI acceptance

| Change | Main CI acceptance |
| --- | --- |
| PR with only regular Markdown files in `docs/`, or root README, PLAN, DECISIONS or AGENTS | Scope/gate regressions and engineering-feed integrity; runtime lanes skipped |
| UI, code, tests, configuration, dependencies, workflows, scripts, schemas, runtime assets, mixed or unknown changes | All existing main CI assertions, split across independent runner lanes |
| Payment, auth, storage, contracts, shared/public interfaces and platform adapters | Full main acceptance plus applicable domain/platform workflows and independent review |
| Any push to main | Full exact-source acceptance, including prose-only changes, to preserve publication authority |

Document changes still need direct accuracy/link inspection and any applicable
domain-specific workflow. Feed inputs remain checked. Executable/symlink documents,
renamed runtime files, missing diff evidence and empty diffs select full acceptance.
PR classification checks the synthetic merged tree against its merge base,
including deletions. Main always selects full acceptance. Its background runtime
checks do not delay merging an accepted prose-only PR.

The main workflow has independent checks, three Vitest file shards, integration,
source-browser and production-build/browser lanes. Each has its own checkout and
installation, so mutable databases, compiler outputs and loopback ports do not
race across jobs. Browser and compiled-production checks retain their original
assertions and settings. Sharding changes test allocation, not test isolation or
selection. Within a lane, dependent steps remain sequential.

The stable `build-and-test` status is an aggregate gate that runs after dependency
failures/skips, unless the whole workflow is cancelled. Every applicable lane
must succeed. Failed, cancelled, missing or unexpectedly skipped
results refuse acceptance; docs-only skips are explicit. Applicable separate
domain/platform statuses must also pass before merge. Informational lint is
outside the merge gate, runs independently and remains visible. Publication
jobs are post-merge delivery work, not PR acceptance. Require the aggregate's
actual `success` conclusion; a skipped/cancelled aggregate is never merge evidence.
A cancelled workflow has no publication authority. The gate uses GitHub's
recommended `!cancelled()` status condition, so an obsolete run cannot keep its
concurrency slot while an `always()` aggregate waits for a runner.

Only superseded validation runs for the same PR and workflow are cancelled.
Main, scheduled, manual, package and installer publication runs retain their
existing authority and are not cancelled by this optimization.

UI and shared-library changes retain full coverage. A narrower UI fast lane
requires demonstrated dependency/affected-surface coverage and failure tests;
path names alone do not establish isolation. Existing domain-workflow path
filters remain intact. Broader filter narrowing is a separate measured change.

## Merge and delivery

Review the completed candidate and pass its required checks, then merge under
the owner's standing authorization. Do not wait for informational lint to merge.
If main advances, reconcile and validate the combined candidate where required;
old CI evidence cannot establish acceptance of new combined source.

Main retains full exact-source acceptance for every push. Versioned release,
MCP and desktop publication rely on that evidence and their existing provenance
checks. Docs-only PR acceptance cannot establish main package publication
authority; a successful main run includes all runtime lanes. Changing CI/docs
alone does not require a
runtime version bump, package/installer rebuild, production deployment or Arc
Canteen product announcement.

For a user-visible runtime update, perform one coordinated release after merge:
deploy current accepted `origin/main` with the reviewed `npm run redeploy` flow,
verify health commit/profile, verify applicable package/installer identity, then
publish the authorized concise product update. Preserve all operational drains,
backups, retained-original recovery and spending gates in
[the mainnet update flow](mainnet-update-flow.md). A combined release is allowed
only when its combined source and applicable gates are verified; do not leave
completed user-visible changes indefinitely undeployed.

## Evidence and supported surfaces

This increment changes development instructions and GitHub validation scheduling.
Web/API, desktop, CLI, remote/stdio MCP, extensions and bots retain their runtime
contracts and distribution versions. Their applicable platform/domain workflows
retain their tests and triggers; PR cancellation is the only change outside the
main workflow. Production and hosted release runs are preserved.

Baseline observed October 8: a recent main PR CI run took 23m20s; another run's
unit step took 8m41s while its ordinary Next build took 38s. These are individual
observations, not typical rates. Record the new required-gate critical path and
queue time from real CI. No fixed speedup or quality parity is claimed before
runner acceptance. Compare equivalent workloads and include retries and fixes.

References: [GitHub job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds),
[PR concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[cancellable failure handling](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#always),
[Vitest sharding](https://vitest.dev/guide/cli.html#shard).
