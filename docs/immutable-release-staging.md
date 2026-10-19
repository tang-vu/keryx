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
Append the single explicit `--mainnet-public-build` option when preparing an
intended mainnet browser artifact. Omitting it retains the testnet default;
unknown profile options refuse. Preparation must finish and its exact artifact
be reviewed before the operator starts the writer hold.

For that mainnet option, supply the existing public `NEXT_PUBLIC_CIRCLE_APP_ID`
(UUID) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`*.apps.googleusercontent.com`) in the
isolated builder environment. Missing or malformed identifiers refuse before
running checks. Next compiles them into the Google wallet browser connector;
dropping them would produce an artifact with that supported connector disabled.
Use only those public values, without mounting or loading the runtime ENV file.

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
source staging excludes it. With `--mainnet-public-build`, only the build command
selects the existing `arc` server/public network constants; npm version,
typechecking and tests remain explicitly arcTestnet/offline. Only the build also
receives the validated Circle/Google public identifiers; tests do not inherit them.
The mainnet public build still has forced offline mode and no runtime storage,
provider or signing credentials. The exact browser settings and a digest of the
two public identifier values are recorded; **a default testnet
artifact cannot be promoted to mainnet**. Neither profile is production admission.

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

An invalid readiness receipt must also retain ownership of the spawned rehearsal
role until the existing graceful shutdown and pipe-close checks finish. It cannot
throw away the handle before the outer rehearsal's drain handler can receive it.
The refusal retains exit/capture evidence; failed drain or incomplete output stays
a failure. This control launches no additional role and grants no production admission.
If close wins the event ordering before an invalid readiness assertion resumes,
the refusal still retains actual exit/capture/EOF with graceful drain unaccepted.
It sends no further drain to that closed child and preserves existing rich
before-readiness failure diagnostics.

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
from the immutable cohort. The explicit serialized-build launcher now selects
`immutable-next-cache.cjs`, a narrow wrapper around pinned Next's existing cache:
immutable build seeds remain readable, cache writes stay in bounded process memory,
and optimized images are recomputed without disk persistence. Ordinary startup
retains its configuration. Intended-host full-application cache/trace acceptance
remains open. Do not introduce a compatibility symlink that lets old scripts
silently select whichever generation is current.

## Reviewed staged role adapter (production acceptance pending)

`KERYX_REDEPLOY_STAGED_RELEASE=1` is an explicit prebuilt branch of the existing
reviewed redeploy shell. It requires all four reviewed maintenance controls and
held schedules. A migration additionally requires the existing paired protected
economic configuration and digest. Its protected PM2 config must contain
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
The HTML, PDF and bibliography callers now use `extractionWorker`, which finds
assets at the package root of its loaded module, including a compiled server
chunk. It never selects code from storage cwd or an ENV override. Missing,
linked or hardlinked assets refuse at that package root instead of searching
a predecessor. Their existing child environment, parser admission and document
bounds remain intact. The adapter still refuses any reintroduced cwd caller;
intended-host trace/startup acceptance of the complete candidate remains required.

The protected preparation receipt must record actual successful typecheck,
tests and build, pinned Node/npm, Linux and mainnet public settings. Default
testnet builder receipts therefore **refuse** production admission. Selecting
mainnet public compilation supplies only that preparation input, not the
independent compatibility review or target acceptance.
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
automatic rollback, retry of economic work, migration selection or release cleanup command.
Failure keeps the cohorts and stopped references for operator review.

For an explicitly reviewed staged economic transition, the already prepared
cohort is verified before the migration and again before role startup. The
existing six-field economic configuration still selects only a fixed known
migration basename. Its tsx loader and migration code come from that same exact
immutable cohort; operational cwd, protected manifest/identity/backup/receipt
arguments and stopped-writer requirements remain unchanged. Serving source,
dependencies and ENV are not synchronized or rebuilt in this stopped phase.
The existing failure hold is armed before possible DDL, including a lost ACK:
any migration or later refusal keeps public roles stopped and retains all builds,
without replay or predecessor restart. Target normal/TWO-original, backup,
identity/schema/EXCLUSIVE, ENV/custody and Operator checks still belong to the
owner's stopped-writer acceptance. This source path does not perform them early
or declare the candidate production-ready. Actual intended-host staged rollout,
rollback/off-box evidence and matched availability measurements remain open for
original #164; the successful ordinary app67 release does not replace them.

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
The raw log retains at most 4 MiB of exact Buffer bytes. Both pipes continue to
be consumed and hashed after that cap. Receipts record observed, retained,
overflow and dropped bytes, hashes, EOF and capture errors. After graceful drain
and actual close, overflow, incomplete capture or capture errors refuse successful
rehearsal evidence; retained logs and any captured closed receipt remain available.
Preparation runs Vitest in its normal `NODE_ENV=test` runtime and compilation in
`production`, recording the setting with each command. Both retain the same fresh
credential-free testnet/offline storage environment.
Turbopack's `.next/node_modules` aliases are materialized from the candidate's
independent dependency copy. Alias targets must map inside that copy or the known
dependency input root; outside paths refuse before mutation. Bounded byte/entry
and disk-headroom checks precede materialization. The build/input dependency trees
remain untouched, and the complete artifact/trace inspector retains its link
containment rules. Intended-host extraction and runtime-cache admission are
separate from dependency-alias materialization.
The dependency copy uses a checked per-entry filter and independently copies every
regular target. Verified file links are then recreated as relative links into that
copy, including installation links that originally used absolute paths. Flattening
an npm executable into `.bin` breaks its package-relative imports; an actual Linux
preparation exposed this before TypeScript could start. Functional CLI regressions
cover sibling-module resolution and independence from later input changes. Link
target bytes still count toward headroom and targets are rechecked at copy.
Directory/external links still refuse; no link points back to installation inputs.
Turbopack NFT references can name the materialized dependency alias directory.
Only the exact hashed alias shape is accepted, with its entire file/directory/byte
inventory equal to the candidate's independent package copy. Ordinary directory
references, missing packages, extra or substituted alias bytes refuse. The accepted
alias list is part of the inspection receipt. The deployed authoritative inspector
must include this reviewed format before any future staged admission; a candidate
cannot supply its own inspector as authority.
Inspection now uses `keryx-immutable-artifact-inspection-v2`, separates file and
directory reference counts and bounds its encoded receipt to the verifier's
16 KiB limit. Retained v1 receipts stay under their original verifier/evidence;
they cannot be relabeled as current v2 acceptance.

The immutable web launcher and actual rehearsal load Next's serialized completed
build configuration from `.next/required-server-files.json`, which is included in
artifact inspection. Next's documented custom-server `conf` input keeps startup
independent of TypeScript config import resolution from the operational storage
cwd. Missing, linked, oversized or incompatible build configuration refuses;
ordinary public-server startup keeps its existing config-loading behavior. Pinned
Next 16.3.8's custom-server router initialization does not forward `conf`; during
that initialization the launcher supplies the same serialized-config process input
as Next's generated launcher, then restores its prior value. It derives this
input only from the inspected artifact and changes no financial/runtime ENV file.
The rehearsal eval entry has its own argv identity, so importing the public-server
module cannot also trigger that module's ordinary CLI startup. A fresh-process
fixture checks TS config with a CJS import, built security headers and positive
drain from separate storage.

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

## Original #164 admission map — 2026-10-12

[PR396](https://github.com/tang-vu/keryx/pull/396) merged as
`c6215548afd112399b9523dd2cd5ca30415c2eb0` with 22 applicable successful checks;
its publication-only skip is not acceptance. Its preparation/staging/rehearsal
helpers remain in current source. Accepted production 0.27.59 at
`513c6fa6b1f78b5f1db6b215973581ef3b51eb69` used the reviewed ordinary deployment,
with accepted normal/public observations and cleared maintenance. That delivery
does not admit the staged path or prove all immutable-release criteria. Subsequent
main source is distinct from that production identity.

| Original criterion | Retained evidence | Remaining admission gate |
| --- | --- | --- |
| Exact source/artifact checked before writer hold | PR396 isolated builder, immutable byte/trace inspection and accepted CI; module-bound extraction and memory-only staged cache source | Intended-host secret-free builder with actual mainnet public settings and complete extraction/cache/trace acceptance |
| Positive drain and retained ambiguous state | Existing early-drain ordinary release; hosted rehearsal's idle web close | Every affected native writer and in-flight/ambiguous economic-state proof for the immutable transition; no forced termination or replay |
| Storage/schema/rollback compatibility | Explicit protected compatibility binding and hold-for-review behavior | Actual sealed storage/schema/fence evidence and predecessor/candidate compatibility; crash/uncertain-ack and compatible compiled rollback |
| Previously authorized roles, held schedules, exact health | Release59 normal/public acceptance on its ordinary source; staged role validation source | Full role/build/queue/internal/public observations for the admitted immutable cohort, preserving ENV/custody and held schedules |
| Verified off-box rollback retention and scoped headroom | Source/artifact/headroom checks and no release-deletion command | Encrypted off-box retention plus independent retrieval of the exact rollback lineage before any deletion |
| Measured rehearsal/ordinary release and practical availability target | Historical hosted idle fixture: startup1372ms, handover16714ms, post-drain readiness16288ms | Intended-host no-spend timing and a reviewed ordinary release measured with the same interval definition; grounded target and observed compliance |

The hosted idle timings belong to their original CI cohort, not production59 or
an intended-host availability target. A successful ordinary release establishes
its own delivery; passive health/normal observations cannot substitute for staged
builder, every-writer, schema, cache, compiled rollback or retrieval acceptance.
The current early-drain deployment remains authoritative and original #164 stays
OPEN until all original criteria and real delivery evidence are accepted. No
additional paid trial, new funding, schedule or custody gate is introduced here.

## Cohort extraction, cache and recovery source — 2026-10-12

The existing compiled public-origin fixture now runs the actual HTML, PDF and
bibliography callers with decoy worker files in its separate storage cwd. It also
reads an immutable route-cache seed and optimizes a local image. Complete build
file names and byte hashes must remain identical after requests and positive
close. This exercises the narrow cache wrapper against pinned Next, including
its seed and image paths, without an external cache service or filesystem shim.
Images retain their response behavior but lose persistent caching in the staged
branch; resource acceptance on the intended host is still required.

The fixture independently compiles two cohorts with different build IDs and
security-header markers, then verifies predecessor, candidate and explicit
compiled rollback using fresh owned processes. Actual close and both pipe EOFs,
without overflow or capture errors, remain required. A deliberately missing ready
ACK must retain the original process through one graceful drain; its observation
deadline cannot authorize replacement, replay or forced termination. Readiness
observation is bounded at 30 seconds, while graceful drain has no force deadline.
Failed cohorts and logs are retained for inspection.

`rehearsePreparedRelease` additionally accepts an optional `predecessor` containing
its candidate path and exact source/inspection digests. Distinct commits are
required. Both cohorts are reverified at each boundary and after actual runtime
close. The shared unfunded scratch store and observed queue are retained across
predecessor, replacement and explicit rollback. Its receipt distinguishes this
compiled exercise from production rollback compatibility: financial-worker drain,
production rollback and the availability target remain unaccepted. The ordinary
CLI keeps its existing same-cohort invocation.

Local Windows evidence measured two fixture compilations at 19,416 and 19,182 ms,
candidate readiness at 1,401 ms and rollback readiness at 1,389 ms. These are
development observations from a tiny fixture, not intended-host maintenance
measurements. An additional isolated drill self-exited a compiled idle candidate
before its ACK, retained actual exit/EOF evidence and explicitly restored the
unchanged compiled predecessor. Synthetic sealed-storage refusal checks cover
identity relabeling, absent manifests, manifest drift and offline bypass. They do
not establish compatibility of the production original or its economic fences.

The next root-owned admission must bind the complete candidate, intended Linux
toolchain/resource shape, mainnet public settings, exact original storage/schema/
fences and economic-state observations. It must inventory every affected writer,
prove their graceful exits and unchanged ambiguous state, and inspect all authorized
role/build/queue/internal/public identities. Reuse encrypted retrieval evidence
only if its exact rollback lineage and digests already match. Otherwise a separate
root-reviewed, one-object retrieval proposal must specify the existing budget,
object name, encrypted size/hash and independent local verification; this worker
does not reserve or spend a remote request. No retained release may be deleted on
PUT acknowledgement or a fixture result.

Measure preparation outside writer hold, total maintenance from admission-hold
ACK through final required public readiness, and handover from the last positive
writer exit through that same readiness. The root must choose a finite target
from matched intended-host observations and validate it on one reviewed ordinary
production release using these same intervals. A missed target retains the hold;
it cannot justify force kill, uncertain payment replay or early drain removal.
Web/API, hosted MCP, A2A and bots inherit hosted extraction behavior. Source CLI
uses its own loaded code root; packaged stdio MCP, desktop and extension retain
their established hosted handoffs and distribution authority. Root owns the final
combined-source/platform acceptance and release; this source grants none of it.
