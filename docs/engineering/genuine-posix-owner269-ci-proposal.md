# Proposed synthetic POSIX owner269 acceptance in the SQLite domain lane

Source proposal only, **UNAPPLIED and UNRUN**, 2026-10-15. The accompanying
after-image changes only `.github/workflows/enrolled-sqlite-runtime.yml` and adds
this bounded note. It is not actual root PASS, platform acceptance, a workflow
run, source/security approval, or issue269 acceptance. The parent owns composition,
the focused PR, required aggregate/platform/domain CI, merge and release batching.

The parent reports ordinary pure-eight/type checks already passed. Those results
are not rerun or promoted here. The prior nine-path core proposal and corrected
ninth owner fixture remain unapplied. This proposal changes none of their bytes.
Apply neither the old ninth fixture nor its correction to an absent live path:
compose the corrected new-file addition with the other eight reviewed paths first.

## Observed gap and selected lane

The unchanged `scripts/owner-run-assignment.mts` rejects Windows and any process
whose real **or** effective POSIX UID is not zero, before reading input or opening
storage. `lib/owner-run-assignments/local-owner.ts` also binds the capability to
the exact script realpath and approved operation digest. No caller flag, model,
identity mock, role, environment privilege switch or imported CLI function can
replace those checks.

The corrected `lib/db/owner-run-assignments-owner.test.ts` conditionally collects
ten expanded positives in the suite named
`fresh owner269 POSIX uid0 acceptance, exact local CLI (SOURCE UNRUN)`. Its actual
worker `beforeEach` still requires genuine real and effective UID zero. On an
ordinary Windows/non-root runner those positives skip; that result alone cannot
accept owner apply/undo, receipt recovery, races, rollback or occupancy guards.

The existing `Enrolled SQLite runtime` workflow has one domain job with Ubuntu
and Windows matrix entries, a 15-minute job deadline and `contents: read`. It has
no job/container configuration to reuse as an already-root container. The main
CI's ordinary unit shards discover tests but do not establish genuine UID-zero
acceptance. The proposal therefore adds a dedicated Linux **step to the existing
domain job**, rather than another job, global gate, container, framework or waiver.
It retains the original adapter/cache/boundary, TypeScript and lint steps.

The path filter adds the owner domain, exact owner CLI and existing Vitest config.
The fixture/core storage changes already select the lane through `lib/db/**`.
Existing triggers, concurrency, matrix, permissions, job timeout, Node pin and
installation command are preserved. Checkout additionally disables persisted Git
credentials because the subsequent synthetic root process needs no checkout token.

## Exact temporary privilege scope proposed for review

**A different source/security reviewer must review the composed source, dependency
graph and this exact temporary test scope before the parent applies the workflow.**
This is a narrow proposed exception to ordinary non-root test execution, not an
authorization to run repository CI or production operations as root. No privileged
command has been executed or arranged by authoring these files.

The Linux step proposes one noninteractive `sudo -n -- /usr/bin/env -i ... node -`
invocation. No password prompt, fallback, container pull, installation, daemon,
sudo policy edit, capability grant, identity substitution or production owner
execution is added. Unsupported Linux/UID APIs, unavailable sudo or nonzero UID
fail the step. Normal install, other test steps, compiler and lint never use sudo.

Before that invocation, the ordinary runner prepares a unique `owner269-ci.*`
directory directly beneath its ephemeral `RUNNER_TEMP`. It copies only library
source suffixes, the exact CLI, package/lockfile, existing tsconfig/Vitest config,
and that lane's already installed `node_modules`. Dependencies are copied, not
linked to a writable shared installation; there is no root install. It copies no
`.git`, environment files, deployment manifests, database, production volume,
socket mount, custody file or credential. No production endpoint is supplied.

The root wrapper receives only the reviewed temporary paths. It validates their
realpaths, changes cwd to the copied source root, and launches exactly:

```text
node node_modules/vitest/vitest.mjs run lib/db/owner-run-assignments-owner.test.ts --reporter=verbose --reporter=json --outputFile.json=<temporary evidence>/posix.json
```

The wrapper asserts actual Linux, real UID zero and effective UID zero. The
unchanged fixture separately checks the worker identity, then invokes the exact
unchanged `node --import tsx scripts/owner-run-assignment.mts` child CLI with the
fixture-generated manifest/input/digest arguments. There are no owner flags or
mock process APIs. The source/CLI pins refuse accidental substitution.

The fixed root environment contains only PATH to the installed Node and system
tools, temporary HOME/TMPDIR, CI=1, and the project's existing explicit offline
testnet selectors (`KERYX_NETWORK=arcTestnet`,
`NEXT_PUBLIC_KERYX_NETWORK=arcTestnet`, `KERYX_FORCE_OFFLINE=1`). No inherited
NODE_OPTIONS, provider/API credentials, runtime storage manifest, Supabase key,
wallet, GITHUB_TOKEN, model/auth, daemon, approval or native-policy setting is
passed. The unchanged Vitest config retains its existing external-discovery
disablement. The synthetic mainnet-shaped storage identity used by the fixture
remains explicitly synthetic; offline selectors do not relabel its stored rows
or manufacture settlement evidence.

This is filesystem/environment separation on a disposable GitHub-hosted runner,
not an OS/network sandbox. UID zero inherently has host access. Static review of
the exact composed source and dependencies is required for that reason. No
claim of network containment, credential-denial enforcement or tested runner
suitability follows from the authored step. If the parent cannot accept that
specific ephemeral host scope, genuine root acceptance remains open; do not use
ordinary skips or weaken owner authorization as a substitute.

The wrapper runs one file, bounds the whole child process to six minutes and
captures complete bounded stdout/stderr (16 MiB maximum; overflow fails). It
does not change the original 30-second case deadlines, exact CLI's 15-second
child deadline or fixed 5000ms native contention policy. The eight-minute step
deadline includes preparation. Its finally block removes only the verified
temporary tree. Timeout/cancellation may bypass cleanup; the hosted runner must
remain disposable. No persistent source or dependency mount is changed.

## Refusal and genuine positive acceptance remain distinct

The ordinary step executes on both matrix entries before the Linux step. It
asserts actual Windows or both nonzero POSIX UIDs, invokes the same exact named
fixture with an isolated home/temp and credential-free child environment, and
requires the ordinary refusal and unconditional native control to pass. The
unchanged refusal test invokes **both apply and receipt** CLI children and requires
exit 1, empty stdout, `assignment_owner_required`, complete typed/schema/journal
preservation, unchanged original DB bytes and unchanged deployment manifest bytes.

Expected reporter results below are authored assertions, **not observed results**:

| Invocation | Collected | Passed | Skipped | Meaning |
| --- | ---: | ---: | ---: | --- |
| Ordinary Windows/non-root | 12 | 2 | 10 | CLI refusal and native control only |
| Dedicated genuine Linux UID-zero | 12 | 11 | 1 | All ten owner positives plus native control; refusal inapplicable |

The positive step requires exactly one reported test file at the expected absolute
path. It verifies ten exact expanded positive case titles and that each is
`passed` with no failure messages and an executed duration. It also requires the
native control to pass and only the exact ordinary refusal case to skip. Counts,
report success, zero failures, zero todo, expected pending count, process exit,
signal and spawn errors are checked. Missing/malformed reports, unsupported or
nonzero identities, all-skipped positives, missing/extra/renamed cases or nonzero
exit fail acceptance even if Vitest otherwise reports success.

The ten positives retain these meaningful controls:

1. Two-member apply, absent/committed lookup after discarded response, stale-last
   undo rollback, full compensating undo and historical replay without restoration.
2. Changed second original rolls back the batch and owner audit.
3. Current member generation change refuses apply.
4. Current credential generation change refuses apply.
5. Account recreation lineage change refuses apply.
6. Genuine two-connection native ticket versus owner CLI race.
7. Held original writer exercises the unchanged native wait and subsequent refusal.
8. Held A2A writer exercises the unchanged native wait and subsequent refusal.
9. Both UPDATE keys, REPLACE, DELETE, A2A association and ticket occupancy guards;
   undo releases metadata occupancy only, retaining collision/privacy baseline.
10. Changed deployment manifest and missing fence refuse through the genuine CLI.

Always-run artifact retention stays inside the domain job, separately named per
matrix OS and source SHA. It retains only the synthetic stdout/stderr, JSON report,
process identity/status and copied source/lockfile/tool-version pins for seven days.
The wrapper also checks copied source bytes after execution. Upload success is
not test acceptance. Missing root results remain an open gate, regardless of an
ordinary artifact or domain/aggregate status; the parent must inspect the actual
Linux step and ten case results. No prior successful workflow run is claimed.

## Source pins, module graph and remaining parent work

The inspected corrected fixture is
`output/two-owner-fixture-findings-successor/after/lib/db/owner-run-assignments-owner.test.ts`:
22,390 bytes, SHA256
`8d4aaea5165b10325da1909d7552d5b9a229aa5e795a64217e53fb2b6453a725`.
Its sibling `UNRUN-owner-acceptance.md` was read. No separate file literally named
`correctedowner.test.ts` exists in that directory; this is the exact pinned
corrected after-image identified by its handoff and pins.

The unchanged CLI is 5,655 bytes, SHA256
`042ada7198fc53e8891d875ed7c13bd0209f5a275d61252fb1173b0446d7f6a2`.
The Linux positive step hard-pins these raw bytes. Ordinary discovery verifies
the same canonical LF content and retains actual raw SHA256/length, permitting
only CRLF checkout conversion under the existing `* text=auto` attributes; it
does not rewrite either file or change Git configuration. A later fixture
or CLI change requires a reviewed pin/count/title update; do not bypass the pin.
The remaining composed core source is recorded as input evidence, not applied.

The fixture/CLI imports were traced as source text through contracts/digests,
local-owner, SQLite connection/identity/fences, source schema profiles/installers,
owner store, run claims and typed migration snapshots. Schema imports also reach
other domains' constants/helpers and ordinary config; they are not permission to
run those domains' services. The accompanying static import-graph inventory is an
overapproximation that excludes explicit type-only statements; it is not runtime
module execution, a complete bundler proof or dynamic-call acceptance. Installed
Vitest JSON/conditional APIs and the installed Next Vitest guide were read.

No runtime production source, core proposal, corrected test, migration, SQL policy,
payment/auth/history consumer, native max-profile/wait policy or supported surface
contract is changed here. Web/API, desktop, ordinary CLI/MCP, extension and bots gain
no owner or financial authority. No version, deploy, schedule or product update is
proposed. Parent retains native migration/races, current-source type/build checks,
all applicable required CI/platform/domain and production/original criteria.

Read canonical/local AGENTS, local override, current coordination/development
workflow, pilot common rules, project history/owner269 rationale, canonical
keryx-review and verified invariants. Discovery gap: keryx-review is absent locally
and from the session catalog; the readable canonical skill was used without
installing or overwriting it. No pilot comparison was arranged. Only standard
file/text/hash packaging occurred; no proposed shell, application module, test,
compiler, DB, sudo/container, Git executable, network/provider, live workflow,
privilege, ChatGPT auth/model, configuration or approval/native policy was changed
or executed. The specified absolute Git path was not invoked.
