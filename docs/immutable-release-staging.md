# Immutable release preparation and actual-runtime rehearsal

Issue [#164](https://github.com/tang-vu/keryx/issues/164), October 5, 2026. This is a
bounded preparation and inspection boundary. The current [reviewed deployment
flow](deployment-guide.md) remains authoritative, including its early writer drain.
The replacement has **not passed production acceptance** and this work does not
shorten the current production maintenance window.

## Current authority and the problem

Reviewed mainnet deployment verifies exited public web/A2A definitions before
changing `/root/keryx`. Private workers also import source and dependencies from
that directory. Typechecking and Next compilation therefore run after writers
have drained. The reviewed 0.26.11 release reported a 6.7-minute Next compilation
plus several minutes of typechecking; those are historical observations, not a
general availability guarantee. Removing the early drain while mutating this
shared source/dependency directory would break the protection it provides.

The existing [reviewed role helper](../scripts/redeploy-reviewed-roles.mjs) defaults to
fixed `/root/keryx` paths, executable arguments and ENV-file custody. A staged
candidate requires the explicit protected release binding described below. The existing DB
selector may initialize application storage, and Next loads local ENV files.
Building in another directory with the real runtime ENV is therefore not a
safe preparation workflow by default. Successful compilation cannot authorize
storage migration, signing, job replay, schedule changes or paid acceptance.

## Implemented preparation boundary

[immutable-release-staging.mjs](../scripts/immutable-release-staging.mjs) uses
only Node built-ins and read-only local Git object commands. It has no application,
storage, network-client, signer or process-manager imports. It never runs npm,
loads a runtime ENV file, checks out/fetches/resets the serving repository, starts
roles, changes a scheduler, migrates a database or deletes release directories.

`stage` requires an accepted full 40-character commit and materializes its exact
local Git blobs into a new exclusive `<commit>/source` directory. Branch names,
symlinks, unknown gitlinks, case-colliding paths and recognizable private runtime files
refuse. Working-tree modifications, ignored custody/ENV files, generated artifacts
and installed dependencies are not copied. Source files receive owner read-only
modes (with original executable bits) on Linux. Source-directory ownership remains
trusted; these permissions do not make hostile root writes impossible.
Private/runtime path exclusions also cover case variants such as `.ENV.LOCAL`
and `NODE_MODULES`, so Windows aliases cannot import those files. Only the exact
`.env.example` spelling is exempt. Device/console basenames such as `NUL.txt`,
`COM1` and `CONOUT$` refuse before opening a destination handle.

The one explicitly recognized gitlink is `arc-primitives`, the separately published
[non-runtime Showcase](arc-primitives-maintenance.md). Its exact pinned commit and
matching checked-in `.gitmodules` binding are retained in the source manifest;
only an empty directory is materialized. No submodule fetch, init, working-copy
reuse or standalone dependency installation runs. Populating that directory makes
artifact inspection refuse. Any future runtime dependency on the standalone
needs a separately reviewed exact-object materializer and builder acceptance.

Preparation refuses a release root inside the serving repository, or the converse,
including Windows case aliases; existing roots are canonicalized before comparison.
It checks available disk space before creating a candidate. The production CLI
fixes the source at `/root/keryx` and the release root at
`/root/.local/share/keryx-releases`. That root must already exist with mode `0700`,
root ownership and protected nonsymlink ancestors. There is no creation option
for production paths and no CLI option to lower the default 4 GiB reserve.
Existing or partially created candidates refuse; retain them for inspection.

The source manifest binds the full commit/tree, complete file inventory, Git blob
IDs and SHA-256 content hashes. Bounds are 10,000 source files, 32 MiB per blob
and 256 MiB total source. Local Git calls have a finite 60-second command timeout.
Git replacement objects and inherited Git configuration/environment overrides
cannot substitute another accepted object. Every Git invocation explicitly disables
lazy promisor fetches, so missing partial-clone objects refuse before a candidate
is created. Git must support `--no-lazy-fetch`; older versions fail closed even if
they would ignore `GIT_NO_LAZY_FETCH`. A read-only capability check confirmed that
production Git 2.43.0 rejects this option; the prerequisite remains unmet there,
and the current deployment does not use this helper.
This work neither upgrades production Git nor authorizes staging there. No secret
configuration is printed.

`inspect` records a candidate **after separately authorized isolated preparation**.
It rechecks every original source file, hashes the entire source/dependency/Next
cohort, records the actual Next `BUILD_ID`, and checks all Next `.nft.json` references
for present files contained in that candidate. The required server trace must be
present. Hardlinked files, special files, unexpected generated top-level paths,
external/dangling symlinks and trace paths escaping the candidate refuse. Relative
npm executable links to files inside its own dependency tree are permitted.
Mutable dependencies linked from the serving release are not permitted.

Artifact inspection is bounded to 250,000 entries, 8 GiB of file bytes and 500,000
trace references, with fixed-size read buffers and a 120-second deadline per
complete snapshot. It checks stable file metadata during reads and compares two
complete snapshots around trace validation. A retained receipt is exclusive;
`verify` requires its exact external digest and rechecks the cohort. This is byte
integrity evidence, not proof that tests passed, that compilation used the intended
public settings, or that runtime writes are compatible with immutable files.

Every source/artifact receipt explicitly carries `productionAdmitted: false`.
Artifacts are not mounted, switched, or made active by this helper. It does not
export secrets or manufacture build/check results. A release inspector must hold
exclusive candidate-preparation access; these filesystem checks do not establish
protection against a concurrent hostile administrator or kernel compromise.

Example read-only preparation commands on a separately reviewed host are:

```bash
# Requires a pre-existing protected release root and an accepted local Git object.
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/node \
  scripts/immutable-release-staging.mjs stage FULL_ACCEPTED_COMMIT

# After an independently reviewed isolated build, retain both printed digests privately.
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/node \
  scripts/immutable-release-staging.mjs inspect FULL_ACCEPTED_COMMIT SOURCE_SHA256
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/node \
  scripts/immutable-release-staging.mjs verify FULL_ACCEPTED_COMMIT SOURCE_SHA256 ARTIFACT_SHA256
```

These commands grant no authority to populate the production release root or run
a candidate builder on the deployed host. Review its storage, environment,
disk/resource and active-process implications first. Do not pass `.env.local` to
preparation, symlink a funded store into it, or infer a production artifact from a
secret-free offline build with different embedded public settings.

## Exact-source isolated builder

`npm run redeploy -- --prepare-release REPO RELEASES FULL_COMMIT DEPENDENCIES NPM_CLI`
selects [prepare-immutable-release.mjs](../scripts/prepare-immutable-release.mjs) before
the SSH/WSL transport or deployment path. All paths must be absolute; Windows
slash spelling is normalized before the staging API's canonical-root checks.
The production redeploy command without arguments retains its existing behavior.
An unknown or incomplete preparation command refuses rather than falling through
to a deployment. Preparation grants no production admission or writer-hold authority.

The builder materializes the exact full Git commit using the existing staging
boundary, then copies independently installed dependencies into its own candidate.
It matches every installed-lock entry against the source lockfile, requires direct
dependencies, refuses external links/special files and checks headroom for the
copy plus a further 4 GiB. Copies have independent file identities; the shared QA
dependency junction and its target are read-only inputs. It never runs an installer
or changes an existing dependency tree. An installation receipt is input evidence,
not proof of the contents of each package; complete artifact hashes and trace
closure still bind the actual copied bytes.

Node24.21.0/npm11.19.0 are required. Fixed, sequential commands run the actual
TypeScript/MTS checks, Vitest suite and Next production build. A fresh environment
selects arcTestnet/offline, blanks Supabase and omits runtime credentials, funded
storage manifests, injected Node options and provider configuration. HOME, cache,
temporary files live in a new isolated scratch directory outside the source
cohort. Testnet's ordinary SQLite fallback uses a fresh working directory; no
funded storage manifest or unused SQLite-path override is inherited. Next's
automatic ENV loading cannot select `.env.local` because
source staging excludes it. The exact browser settings are recorded; **this
testnet/offline artifact cannot be promoted to mainnet**.

Each command retains its real exit/signal/error, elapsed time, tool arguments and
diagnostic-output digest alongside the actual log, including failures. A failed
check cannot record an artifact or successful preparation receipt. Successful
preparation hashes the complete source/dependency/build cohort, verifies its
trace closure, then re-verifies the retained artifact receipt. `preparation.json`
binds those digests, full commit/tree, build ID, lock inputs, platform/toolchain,
public settings and measured elapsed time. Every receipt remains
`productionAdmitted:false`; existing/partial evidence refuses reuse.

For a successfully prepared cohort, run:

```bash
node scripts/rehearse-prepared-release.mjs CANDIDATE SOURCE_SHA256 ARTIFACT_SHA256
```

This starts the actual candidate's public-origin Next server on loopback3940,
checks `/api/health` with the trusted public HTTPS ingress headers and exact full
commit/testnet/offline identity, positively closes HTTP/Next/tracing through its
existing shutdown handler, re-verifies the cohort and restarts that same cohort.
It measures initial readiness, idle drain plus handover, and readiness after drain;
no request to research, suppliers, signing, settlement or production is made.
The scratch store and runtime receipt are retained. Linux delivers native SIGTERM;
Windows IPC invokes the registered application handler because a native Windows
SIGTERM forcibly terminates the process. This is actual Next idle-restart evidence,
not an old/new-version financial-worker drain, mainnet schema compatibility,
rollback acceptance or a production availability promise. A failure retains its
candidate and scratch evidence; no release cleanup command is provided.

The production CI lane also runs `rehearse-built-release.mjs` against its existing
completed build, without repeating the build or broad tests. It stages the exact
Git source, compares every actual build-source file with that inventory, copies
the independently installed dependencies/build into a separate cohort, then runs
the same actual Next idle-restart rehearsal under testnet/offline settings. It
retains source/artifact/runtime pins and real failures in an uploaded result. It
does not manufacture a preparation/check receipt or bypass aggregate CI acceptance.
Hosted Linux timing measures the runner/resource shape, not the production VPS.

## Required production builder and handover design

The production extension still needs reviewed, independently installed Linux
dependencies and a secret-free build whose exact browser settings match the mainnet
browser network/registry/origin bindings without granting the builder real runtime
custody or payment/storage authority. Prove both explicit offline-fixture preparation
and any necessary real-identity read-only capability; do not silently initialize,
migrate or fall back to another backend. Audit automatic dotenv loading, lifecycle
hooks, externalized packages, extraction workers and all tracing dependencies.

A reviewed runtime manifest must bind the candidate's full commit, artifact digest,
Next build ID, public settings, runtime ENV reference/digest, sealed storage identity,
economic schema/fences, custody/policy references and exact steady role arguments.
Keep secret values exclusively in protected external ENV/custody files. Bindings
must refer to the same existing deployment, storage, funds, nonces, grants, capacities,
journals and unresolved outcomes; a directory change cannot confer new authority.
Candidate health must report the full accepted commit and build identity, and prove
the role/storage cohort rather than only matching a short commit string.

Before handover, inventory every web, A2A, private worker, withdrawal relay/cycle,
reconciler, source-upkeep/indexer, backup/maintenance command and direct-adapter
writer. Record previously authorized active roles and held scheduler policy. Use
an independently verified ingress/admission gate, then stop new claims and
positively drain/exit all affected writers. Retain in-flight callbacks, signatures,
durable pending payments, retained epochs/capacity and ambiguous jobs. A deadline
cannot authorize force-kill, queue reset, payment retry, nonce replacement or
discarding payment uncertainty. A drain that does not complete holds maintenance
for inspection, without declaring success or activating mixed generations.

Reverify the exact source/artifact/runtime manifest after drain. A cohort switch
must be a bounded reviewed operation with a retained original reference and
fail-closed crash/acknowledgement handling. Start only previously authorized roles;
keep previously held schedulers held. Verify their actual executable arguments,
full commit/build IDs, storage identity, queue state and internal/public health
without submitting funds. Keep writable Next/runtime caches explicitly separate
from the immutable cohort; their concrete configuration and runtime acceptance
are still open. Do not introduce a compatibility symlink that lets old scripts
silently select whichever generation is current.

## Reviewed staged role adapter (production acceptance pending)

`KERYX_REDEPLOY_STAGED_RELEASE=1` is an explicit code-only branch of the existing
reviewed redeploy shell. It requires all four reviewed maintenance controls,
held schedules and no economic migration. Its protected PM2 config must contain
`apps` and a `release` object with the exact full expected commit and
source-manifest, artifact-inspection, preparation and runtime-ENV digests, plus
the protected compatibility review path/digest. Config and flag must agree;
ordinary configs cannot select this path, and staged configs cannot silently
select the ordinary source-mutating path.

Both executable closures use the fixed
`/root/.local/share/keryx-releases/<full-commit>/source` path. Web uses the
cohort-local [next-immutable-server.mjs](../scripts/next-immutable-server.mjs);
A2A imports the cohort's own tsx loader and worker. Only the nonsecret full
`KERYX_COMMIT` control is added to the existing clean ENV command. Operational
cwd remains `/root/keryx`, the external ENV file remains unchanged, and all
previous allowance/feature controls must still match across both roles.
Before admitting roles, the adapter refuses the observed extraction-worker
`process.cwd()` source paths. Closing those HTML/PDF/bibliography paths needs
its narrow source ownership and actual trace/startup acceptance; merely rebasing
PM2 or adding a source-root ENV assignment cannot waive the gap.

The protected preparation receipt must record actual successful typecheck,
tests and build, pinned Node/npm, Linux and mainnet public settings. The new
testnet/offline builder's receipts therefore **refuse** production admission.
The protected compatibility review format is
`keryx-reviewed-release-compatibility-v1`; it binds full commit/tree/build ID,
source/inspection/artifact digests, the unchanged runtime-ENV digest, accepted
source/artifact evidence digest, sealed storage identity/economic schema and
retained economic-state digests. It records exactly the previously active web
and A2A roles, held schedulers and `rollback:"hold-for-review"`. Root must derive
this review from real accepted CI/build and independent native observations;
synthetic fixtures and booleans are not operational clearance.

The shell verifies artifact/review before stopped-role validation and again at
the handover boundary. Only positively exited recognized predecessor definitions
are retained/replaced. It never fetches/resets the serving checkout, installs into
its dependencies, rewrites ENV, swaps `.next` or deletes recovery builds. Actual
post-start PM2 arguments/PID/policy and full-commit health must match. Private,
withdrawal, scheduled and maintenance roles remain under their existing explicit
authority; no additional role starts or cron/systemd changes occur. There is no
automatic rollback, retry of economic work, migration or release cleanup command.
Failure keeps the cohorts and stopped references for operator review.

## Compatibility, rollback, retention and surface gates

For code-only releases, prove that the predecessor and candidate can each operate
the unchanged authoritative store while the other is stopped. Any schema/fence
change needs explicit migration evidence and an identity-aware rollback decision;
absence of that proof keeps signing and admission paused. Never reinstall an
unfenced old writer, erase an identity marker, restore a stale snapshot to reset
consumption, or replay ambiguous economic work to make rollback look successful.
An attempted migration with uncertain acknowledgement remains a hold, even when
the process/artifact switch itself is reversible.

Retain the predecessor source/artifact, stopped role definitions, exact protected
ENV reference, private compatibility/drain/health evidence, and original backup
lineage. Verify encrypted off-box backup/digests and an independent retrieval check
before authorizing deletion of any old candidate or release. Check disk headroom
for preparation, both retained cohorts and backups. Cleanup must validate exact
absolute scoped paths and refuse active, ambiguous, unarchived or symlinked targets;
this helper deliberately provides no cleanup command.

This candidate affects deployment operations only. Web/API, remote MCP, A2A and bots
share the hosted runtime cohort; A2A/private and optional financial workers require
their own preserved role authority. CLI/stdio MCP, desktop and extension remain
independently distributed clients and do not gain a deployment, custody or signing
role. Scheduled Worker deployments and caller-driven scripts require their own
version/config inventories. No application contract or package/installer version
changes follow from the preparation helper. A later runtime/cutover release must
audit all these surfaces and report exact deployed/published identities.

## No-spend evidence and remaining acceptance

Run the built-in-only checks:

```bash
node --test scripts/immutable-release-staging.test.mjs
node --test scripts/prepare-immutable-release.test.mjs scripts/redeploy.test.mjs
node --test scripts/rehearse-prepared-release.test.mjs
node scripts/rehearse-immutable-release.mjs
```

The tests use exclusively created synthetic Git repositories and files. They cover
exact commit materialization, untouched dirty serving source, omitted private files,
refusal of refs/links/unknown gitlinks/private tracked state, retained candidate/inspection
receipts, source/dependency substitution, incorrect digests and missing/escaping
traces. Linux additionally checks internal symlink containment; an unprivileged
Windows host may be unable to create that fixture.
Windows checks case-alias nesting refusal. A missing-promisor-object regression
uses a local filesystem transport witness, with no socket or remote service, to
prove staging refuses without invoking the fetch transport.
Device-name regression inputs use raw synthetic Git objects without creating or
opening any device-named path.

Independent dependency/build copies remove group/world write permission before
inspection, without changing their input trees or executable bits. The inspector
continues to refuse writable artifacts. Runtime rehearsal completion waits for
child close and both stdout/stderr pipes, retaining the full positive drain receipt
even when buffered output arrives after process exit.

The rehearsal keeps a synthetic reader running against the predecessor while it
prepares and inspects the candidate, then positively exits that reader, rechecks
the candidate, starts a replacement and reverses the switch. It checks unchanged
synthetic pending-state bytes and held scheduler policy and prints preparation,
handover and rollback durations. Linux uses a graceful SIGTERM handler; Windows
uses a synthetic IPC drain because native Windows SIGTERM would forcibly terminate
the process. Neither is actual PM2/systemd, Keryx worker, SSE, SQLite or mainnet
acceptance. Generated fixture artifacts are labeled synthetic and never reported
as production builds or real payments.

The issue remains open until the isolated Next/toolchain and actual-runtime evidence
has been accepted on the intended Linux resource shape, plus application
start/worker/maintenance and DB compatibility checks, graceful writer-drain/crash
recovery, off-box retention/retrieval, and reviewed rollback all pass. Record a
timed no-spend Linux rehearsal on the intended host/resource shape, then define a
practical maintenance target using the observed preparation, drain and handover
distributions. Validate that target on one reviewed ordinary production release.
Do not choose a numeric availability promise from this tiny synthetic fixture or
remove the current early drain before those acceptance records exist. No paid
exercise, new schedule, custody change or forced economic recovery is authorized
by this plan.
