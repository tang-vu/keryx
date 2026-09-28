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
record. Hosted results remain required before release.
