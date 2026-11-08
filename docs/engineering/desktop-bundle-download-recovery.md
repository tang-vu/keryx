# Bounded desktop tool-download recovery

PR #871 exposed two independent failures while preparing the Windows installer.
Both application builds finished. The first run received HTTP 504 downloading
Tauri's NSIS ZIP; the single failed-job retry verified that ZIP, then received
HTTP 504 downloading the required Tauri DLL. The failed runs and original logs
remain retained separately from later acceptance.

`desktop/scripts/build-tauri-bundle.mjs` invokes the locked local Tauri CLI with
the same `build -- --locked` arguments. It permits at most three attempts, waiting
five then ten seconds, only when the final failure is a transient HTTP
429/500/502/503/504 response for one of the two exact pinned NSIS download URLs.
The last download must match; unknown URLs, omitted/evicted context, permanent
HTTP errors, checksum failures and compiler/installer errors stop immediately.
The wrapper retains at most 65,536 diagnostic characters while forwarding
the original output with stream backpressure. Cancellation stops the owned build
process tree or backoff and cannot start another attempt. A failed final attempt remains a
nonzero package failure.

Tauri still performs its original download and hash validation. The pinned CLI
is 2.12.0, and the [upstream NSIS implementation](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs)
defines both tool URLs and their hashes, including revalidation of cached plugin
files. The wrapper adds no mirror, checksum override, substituted tool or cache.
Package versions, dependency locks, native/UI builds, package staging, identity
checks and the existing portable/installed standard-user acceptance stay intact.
The executable entry compares physical paths so a directory junction or symlink
cannot silently skip the CLI while returning success.

`lib/desktop/tauri-bundle-retry.test.ts` exercises actual child processes with
controlled tool output. It verifies sequential failures followed by success,
the attempt ceiling, each admitted HTTP status, failure/refusal cases, exact
arguments/cwd, cancellation and terminated children, including a real grandchild,
before fixture cleanup. A byte-identical launcher fixture also exercises its
production entry through a directory alias and verifies an actual CLI invocation.
These fixtures do not build an installer or verify vendor binaries. Real Windows
packaging and fresh-runner acceptance remain mandatory CI gates.

This is build recovery only. It does not retry a payment, deploy, install on the
owner's computer, publish a release or allocate a product version.
