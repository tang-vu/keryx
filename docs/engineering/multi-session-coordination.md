# Coordinating concurrent development sessions

Owner-confirmed October 12, 2026: Keryx is developed by several concurrent Codex
sessions. Separate their work, avoid duplicate investigation and expensive checks,
and give each release one owner. Speed comes from independent work and reusable
evidence; the [validation and release gates](../development-workflow.md) still apply.

Owner-confirmed October 21, 2026: coordination prevents conflicting writes,
resource use, merges and deployments. Each outcome owner reviews, fixes and
validates its own work. Cross-session review and a separate reviewer are optional,
not an admission requirement or a reason to stop ready work and request another
agent. Required checks and existing release/financial authority remain unchanged.

## Start by claiming one outcome

Before editing, fetch/prune, inspect the worktree/branch state, open PRs and current
local handoffs, then read this workflow. Check active owners before starting an
issue that another session may already own. An empty new coordination directory
does not prove existing work is unowned: inventory active worktrees, PRs and the
current release handoff first. Keep ambiguous scopes held while doing independent
work; do not take over an existing task or production operation silently.

Each independent outcome has one task ID, one session owner, a focused branch/PR,
and its own worktree under `D:/repos/server/Github/Hackathon/.keryx-worktrees`.
Record the goal, acceptance criteria, base commit, absolute worktree path, claimed
repository paths, shared resources, dependencies and next action. Related fixes
stay with that outcome. Reading and an explicitly assigned review may overlap;
two sessions must not implement the same issue or write the same claimed paths.

Keep live records in `keryx-coordination/` under the absolute directory returned by
`git rev-parse --path-format=absolute --git-common-dir`. All worktrees of this clone
share that directory; a board inside each worktree would not coordinate them.
Use one `<task-id>.json` per outcome, `resources.json` for resource ownership and
`release.json` for the active release batch. Keep these local records out of Git.
Record identifiers and evidence paths, never secrets or private runtime content.

Serialize every claim, reassignment and record mutation with the short-lived
`allocation.lock` in that directory. Create it atomically, for example with
PowerShell's `[System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew,
[System.IO.FileAccess]::Write, [System.IO.FileShare]::None)`. Write an owner/task ID
and UTC time before closing the handle; the file remains the guard. A failed
exclusive creation means the allocation is occupied. Do not use a separate
existence check followed by an overwriting write.

While holding the guard, reread all records, check task/path/resource overlaps,
then save only the authorized updates. Normalize repository paths to forward
slashes and compare without case on Windows; a claimed directory includes all
descendants. Expand a claim before editing additional paths. Release only the
guard acquired by this operation, in `finally`; never hold it during coding,
tests, CI waits or deployment. A task claim persists after the guard is released.
Mark malformed or partially written records unresolved rather than treating them
as free. Archive resolved records so the board stays small and readable.

Use states such as `active`, `review`, `ci-pending`, `merge-ready`, `merged`,
`awaiting-release`, `closed` and `paused`. At meaningful transitions update UTC
time, exact commit/PR, check command/result/evidence, blocker and next action.
Refresh the record before and after long operations. An old timestamp, a closed
chat or a missing process is a recovery signal, not permission to steal a claim.
Verify the owner's handoff and any running processes, CI or remote operations
before explicitly recording a transfer. Ask the owner only when that authority
cannot be established; continue work outside the occupied scope meanwhile.

## Keep working files and machine resources separate

Do not switch branches, reset, stash, clean, stage, commit or edit inside another
session's worktree. Preserve dirty and operational paths. A delegate receives
narrow ownership and returns its commit/evidence to the outcome owner; it does
not independently merge, allocate versions or deploy unless assigned that role.

Use separate ports, SQLite/test databases, temporary directories, screenshots,
compiler outputs and Rust targets. Do not share mutable `.next`, test fixtures or
build outputs between sessions. Dependency junctions may be read only when their
recorded dependency graph and toolchain match; reserve the shared installation
before any install, update, rebuild or deletion. Never mutate dependencies while
another session is using that installation. Prefer an isolated installation when
the dependency graph differs.

Reserve named resources in `resources.json`: a canonical installation path, port,
database, build target or host-heavy-check slot. By default run one memory-heavy
local full suite/build/installer job per host at a time; record its owner, command,
PID when available, source and evidence path. Independent lightweight checks may
run in parallel with isolated outputs. A coordinator may admit additional heavy
jobs when measured host capacity supports them. Do not kill another session's
process or cancel its CI to free resources.

Reuse check results only when source, inputs, environment and checked scope still
match. Focused evidence for one PR does not accept a newly combined release.
The outcome owner completes the candidate review; reuse applicable evidence
without having every session repeat the same investigation. Additional review may
be requested when useful, but another session's approval is not a routine gate.
Cancel only superseded same-PR validation allowed by the existing workflow;
preserve main/manual/scheduled/publication runs.
Record measured timing if reporting a speed improvement.

## One merge queue and one release owner

The existing release coordinator keeps ownership. Otherwise register a release
owner through the allocation guard before the first release operation. A worker
finishes its own implementation, checks, review and PR, then records `merge-ready`
and its runtime/surface impact. It keeps ownership until delivery or an explicit
accepted handoff. When no coordinator is active, an outcome owner may register
that role and complete the standing workflow; do not leave ready work orphaned.

The coordinator records merge order/dependencies and issues one merge slot at a
time. The coordinator or assigned PR owner merges only that candidate after the
normal required gates pass. If main changes the candidate, reconcile it and
refresh applicable acceptance evidence. Close the merge slot before admitting
the next merge. During deployment, hold merges so accepted `origin/main` remains
the recorded target. Independent implementation, review and CI can continue.

For an agreed multi-PR batch, merge its accepted outcomes, verify the combined
source and applicable surface gates, then perform one combined release. Record
the included PRs, full target commit, app/package/installer versions, release
owner, phase, evidence and pending work in `release.json`. Only that owner
allocates shared versions, publishes packages/installers, deploys, handles rollback
or publishes the authorized product update. Serialize all production mutations,
including maintenance owned by another task. This role grants no new funding,
spending, custody, shared DDL, schedule or gated-pilot authority.

Before deploying, reread the release record and observed production identity. If
the same target and required surfaces already have verified delivery, reuse that
evidence and skip another deploy. A running, failed or uncertain deployment stays
owned until its processes and remote state are resolved; another session must
not start a second deploy as an implicit retry. Follow the reviewed
[mainnet update flow](../mainnet-update-flow.md), bind the expected full commit,
verify `/api/health` and applicable published/installed versions, then record
success or the precise remaining gate. Do not label pending work delivered.

This is a session workflow, not an automatic deployment lock or scheduler.
Separate clones/computers have different Git common directories: agree on one
shared coordination authority and release owner before shared mutations; a local
lock cannot protect the VPS from another machine. Existing sessions must reread
these instructions at their next task boundary to adopt the protocol.

## Handoff and cleanup

Before ending a session, record completed and remaining work, exact commits/PRs,
valid checks, running resources, delivery owner and a concrete next action. A
handoff is accepted explicitly in the board; it does not disappear when chat ends.
Read back the note. Release only resources whose owned operations have stopped.

After full merge provenance and closed dependencies are verified, archive and
verify ignored handoffs/private data/release evidence, then remove only the
completed owned worktree and local branch. Preserve active, dirty, unmerged,
ambiguous, rollback and shared-junction targets; leave remote refs unchanged.
Mark the task closed with its delivery/cleanup evidence or explicit retained gate.

`AGENTS.md` and `.agents/` are locally ignored. When creating a worktree, install
the applicable local instructions/skill context without overwriting an existing
owner's files, and link to this tracked workflow. Older worktrees must consult
the current tracked workflow on `origin/main` before shared actions. This document
changes development coordination only; web, desktop, CLI, API, remote/stdio MCP,
extensions and bots keep their runtime contracts and distribution versions.
