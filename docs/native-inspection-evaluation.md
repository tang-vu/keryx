# Native read-only caller evaluation

This is a bounded evaluation of the Rust CLI as a local subprocess. The existing
TypeScript Operator and Electron application remain the production readers. This
work does not enable automatic runtime selection, payment recovery, task creation
or a desktop migration. The [shared-engine gates](./rust-engine-migration.md) still
apply, including the local, nonauthorizing inspection contract.

## Caller and artifact boundary

The evaluator requires an explicitly selected native executable and a trusted
manifest describing its SHA-256, build source metadata, platform, architecture,
target and read-only protocol, plus an independently selected expected source commit.
Both paths must be absolute. The trusted build
procedure supplies source and target metadata; a generator must not attribute an
arbitrary prebuilt executable to the current checkout merely because it can hash it.
CI must generate its manifest from the executable just built from the exact checkout
and exercise an unpacked artifact copy.

The checksum detects an artifact mismatch or corruption relative to that manifest.
It does not authenticate an untrusted manifest, prove reproducible source-to-binary
equivalence or prevent another process with the same user's access from replacing
the executable between checking and launching it. Use a trusted private installation
directory and manifest provenance. This is not a code sandbox or a signed installer.

The native `protocol` command takes no flags, opens no task and returns the versioned
protocol identifier and engine name. The evaluator verifies this handshake before
issuing a task command. Existing native status, result and brief outputs retain their
current format. A protocol identifier is a compatibility contract; the artifact hash
pins the particular executable implementing it.

## Process and response contract

The transport permits only `status`, saved `result` and `brief`, with a fixed
`--state` argument. It never passes `--file` or invokes create, resume, buy or signing.
It starts the executable directly with a minimal environment and hidden window,
without a shell. One transport instance has at most one active request; another
request receives a busy refusal instead of entering an unbounded queue. This is not
a process-per-row design for Electron's task list.

Byte-bounded artifact verification happens before the process budget begins. One
monotonic deadline covers the handshake and requested operation: ten seconds by
default, configurable from one millisecond to sixty seconds. Cancellation,
timeout, excessive output or malformed responses cannot produce a successful partial
answer. Cleanup must terminate and reap the child and release the busy state before
reuse. If exit remains unconfirmed after the two-second termination grace, report that
uncertainty, close local stdio handles and make the instance permanently unusable;
do not claim that the process was reaped. The pinned native candidate currently starts
no descendants; the contract is
for that single process, not arbitrary descendant containment.

Stdout is limited to 1,000,000 bytes and stderr to 8,192 bytes; callers can lower these
limits. Stderr is discarded after counting. JSON stdout must be complete UTF-8 and satisfy
the strict transport response shape for its command. Transport validation does not
duplicate request, receipt or monetary domain rules. Brief output retains its exact
UTF-8 bytes and command-line framing; it is not trimmed or normalized. A validated
response is still only the local observation described by D-248, never an admission
condition for spending, repurchase, reconciliation or a mutable writer.

## Failure and rollback

A missing or mismatched artifact, unsupported protocol/platform, invalid output,
nonzero exit, timeout or cancellation refuses the operation. The evaluator does not
automatically call a second reader, change the files to make them pass or initiate a
purchase. Disable it and explicitly inspect the same original directory with:

```text
npm run operator -- status --state PATH
npm run operator -- result --state PATH
npm run operator -- brief --state PATH --file NEW_PATH
```

The final command exports only a new private brief through the existing publication
contract. Preserve the original task, journal and saved receipt. TypeScript may also
refuse corrupted input; fallback does not promise successful recovery of arbitrary
files and never means buying again.

## Run the explicit evaluator

Build `keryx-engine` from the selected trusted checkout with the pinned Rust
toolchain and lockfile. Immediately generate the manifest for that build, passing
its full source commit and actual target triple. Use absolute paths and a new
manifest destination; the generator refuses overwrite.

```text
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
node --import tsx scripts/create-rust-readonly-manifest.mts --binary ABS_BINARY --out ABS_MANIFEST --source-commit FULL_BUILD_SHA --target TARGET
node --import tsx scripts/evaluate-rust-readonly.mts --binary ABS_BINARY --manifest ABS_MANIFEST --source-commit EXPECTED_BUILD_SHA --command status --state ABS_TASK
```

Supported targets are `x86_64-pc-windows-msvc`, `x86_64-pc-windows-gnu` and
`x86_64-unknown-linux-gnu`, on matching x64 hosts. Select the expected commit
independently from the trusted build record. `result` and `brief` use the same
options; brief writes its exact bytes to stdout. There is no file export option
in this evaluator. `--deadline-ms` changes the shared process budget within the
documented bounds. A nonzero exit carries a diagnostic on stderr and no successful
inspection result. Keep private output within the task owner's chosen local tools.

## Acceptance and remaining gates

Before treating this evaluator as validated, record actual Windows and Linux
artifact checks and subprocess tests: correct pin/protocol, tampered or missing
binary, wrong platform, malformed/oversized output, nonzero exit, cancellation before
launch and during handshake/operation, timeout, child reaping and reuse after failure.
Unit mocks alone cannot establish OS process-lifecycle behavior. Dedicated synthetic
fault executables belong only to the test setup and must not enter the distributed
artifact or add fault switches to production code.

The artifact drill must preserve v1 source trees, compare exact status/result/brief
outputs with TypeScript-written fixtures, and demonstrate explicit offline rollback.
Record exercised platform branches and any skips. A successful CI artifact drill is
not a clean-machine installation test, a Tauri package, a desktop performance result
or approval to change production routing. A later caller cutover still needs its
own reviewed operational ownership, release and rollback decision.

After building the release binary, set `KERYX_NATIVE_TEST_TARGET` to that build's
actual target triple and run:

```text
node --import tsx scripts/test-rust-native-artifact.mts
```

CI supplies the exact checkout commit through
`KERYX_NATIVE_TEST_SOURCE_COMMIT` and selects the pinned fault-fixture toolchain
through `KERYX_TEST_RUST_TOOLCHAIN`. The fault fixture is compiled separately from
the production candidate and copied into a path containing spaces and Unicode.
The original v1 tree must remain byte-identical after the drill. A same-job copy
does not by itself prove delivery to an independent runtime environment; that
handoff remains a separate release gate.

The September 29 local Windows GNU evaluation passed nine artifact checks,
24 subprocess checks, five output-parity checks, three guarded TypeScript rollback
commands and the offline guard self-check. Eight focused Vitest checks cover
artifact/configuration behavior and deterministic unreaped or late-deadline cases.
The local GNU linker could not emit the test executable directly into an emoji
path, so the drill compiled it in a simple build path and copied it into the
Unicode/metacharacter runtime path. Both the candidate and fault process ran from
that runtime path. Local source metadata describes a development worktree;
the dedicated Linux/MSVC workflow establishes the exact clean checkout-to-build
record. The [corrected PR #12 artifact run](https://github.com/tang-vu/keryx/actions/runs/36473720660)
passed all nine artifact, 24 process, five parity and three guarded rollback checks
plus the guard self-check and eight focused Vitest tests on both platforms. That
run built the exact PR test checkout `e114e04dcdcd0d363352b82c7e5796a7f105dc48`;
this is the synthetic merge checkout, distinct from the feature branch head.
The hosted Windows fixture uses a canonical temporary root before the unchanged
TypeScript snapshot writer, and only its trusted test compiler inherits the SDK
build environment. Candidate runtime processes retain their minimal environment.

## Independent artifact handoff

D-252 extends the same-job copy check with separate producer and consumer jobs
for Windows MSVC and Linux. The producer builds from the exact checkout, passes
the existing artifact/process drill and generates its manifest immediately from
that binary. It uploads only the canonical executable and manifest under a name
bound to the platform, target and source commit. No task data or fault executable
belongs in that package.

Artifact names include the workflow run ID, target and source commit, and remain
stable across attempts of that run. After passing its tests, a rerun of the
producer may overwrite only its own same-run artifact. A consumer-only retry can
therefore still download the earlier successful producer's artifact. The consumer
depends on the producer job, so it does not run during replacement. This follows
the action's [explicit overwrite behavior](https://github.com/actions/upload-artifact/blob/main/README.md#overwriting-an-artifact);
the CI package is not an immutable public release.

The consumer starts on a separate runner, downloads that exact artifact from the
same workflow run and installs the Node dependencies needed by the evaluator and
TypeScript oracle. It has no Rust installation or build step and cannot substitute
a rebuild when the artifact is unavailable. It checks the exact two-file inventory
and regular-file types, then supplies the expected source from workflow metadata
independently of the manifest. Artifact downloads do not preserve executable mode,
so only the canonical Linux binary receives execute permission in the isolated
artifact directory. The manifest/hash/host/protocol checks still govern launching
it. GitHub's transfer digest warning alone is insufficient for this acceptance;
our verification must fail on a mismatch. These transfer semantics follow the
[GitHub artifact guide](https://docs.github.com/en/actions/tutorials/store-and-share-data)
and [official upload action](https://github.com/actions/upload-artifact/blob/main/README.md).

Using fresh synthetic v1 records from the production TypeScript writer, the
consumer must compare status/result/brief and prove explicit guarded TypeScript
reopening after native refusal, with the source tree unchanged. Record its actual
OS, architecture, Node and available runner/glibc metadata alongside the checks.
The consumer runner may have other tools preinstalled; this is evidence that the
artifact path needs no Rust build step, not proof of a tool-free or independently
clean OS. Public artifact authenticity, a signed installer, broader Linux runtime
support and production cutover remain separate gates. Hosted handoff evidence is
required before marking this slice complete.

The test driver has explicit `stage` and `consume` phases:

```text
node --import tsx scripts/test-rust-native-handoff.mts stage
node --import tsx scripts/test-rust-native-handoff.mts consume
```

Both require `KERYX_HANDOFF_SHA`, `KERYX_HANDOFF_TARGET` and an absolute
`KERYX_HANDOFF_DIR`; the SHA must also match the harness checkout. `stage`
additionally requires `KERYX_HANDOFF_BINARY` to select that checkout's canonical
release executable and a new staging directory. `consume` uses the downloaded
two-file directory and never generates a replacement manifest. For a local drill,
select a successful trusted main push run and its independently recorded head SHA,
check out that source, and download its exact platform artifact. Do not obtain the
expected SHA from the manifest. PR runs can build a synthetic merge commit that
differs from the feature branch head.

Local Windows GNU rehearsal passed four artifact refusals (missing, corrupted,
wrong-source and explicitly disabled), six transport/evaluator parity checks,
three guarded TypeScript rollback commands and the guard self-check, with the
original v1 tree unchanged. The extracted shared fixture retained the D-251 drill's
nine artifact, 24 process, five parity and three rollback checks. GNU is explicitly
declared for this local rehearsal; the hosted Windows matrix remains MSVC. The
cross-job transfer and later downloaded-MSVC run require their own recorded
results before completion.

Those transfer gates passed on [main run 36477204555](https://github.com/tang-vu/keryx/actions/runs/36477204555)
at source `8c9c1735a38a84d7b5c2437fceba416f4825602f`. Both fresh Linux and Windows
consumer jobs passed, as did that source's application and Rust CI. Each consumer
exercised four artifact refusals, six parity checks, three guarded TypeScript
rollback commands and the guard self-check. The PR rehearsal used Node 24.21.0,
Ubuntu 24 with glibc 2.39 and Windows Server 2025; these are the tested environments,
not a compatibility promise for other systems.

The exact main-run MSVC artifact (ID `10994098277`) was then downloaded and consumed
on the development PC from the matching source checkout, with the expected SHA
obtained independently from Actions metadata. Its `keryx-engine.exe` is 605,184
bytes, SHA-256 `434ef223fdc6a7619ba747c3089cdec8bfe44842c5fcfe6596dc0e4f56e75287`.
On Windows 10 Pro 10.0.19045 x64 and Node 24.12.0, it passed the same four/six/three
checks and guard self-check with the synthetic v1 tree unchanged. No Rust build or
installation ran in that drill; the downloaded executable and manifest were kept
outside Git. This closes the bounded transfer/runtime drill, while clean-OS,
distribution authenticity, Tauri packaging and production routing gates remain.
