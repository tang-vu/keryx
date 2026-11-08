# Desktop bundle recovery with an intact portable original

PR #871 exposed independent HTTP 504 failures downloading Tauri's official NSIS
ZIP and DLL. An initial retry candidate in PR #872 reached packaging after two
download failures, but the unchanged standard-user identity gate rejected its
portable executable: it contained the NSIS marker rather than the original UNK
marker. Both prior download failures and that failed package remain retained.

Tauri patches the executable while bundling. Retrying a combined build/bundle can
reuse a binary changed by a failed bundle. The launcher therefore separates the
[locked native build](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-cli/src/build.rs)
from [bundling an already-built app](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-cli/src/bundle.rs):

1. Run the pinned local CLI once with `build --no-bundle -- --locked`. A compile
   failure or cancellation stops immediately.
2. Retain the freshly compiled portable bytes in bounded memory. Require a regular
   file, at most 128 MiB, an MZ header, exactly one UNK marker and no NSIS marker.
3. Invoke `bundle` at most three times. After every completed attempt, restore the
   exact captured portable bytes and mode, sync, and verify their complete readback.
   The installed/bundled executable is never rewritten by the launcher.

The launcher restores the whole genuine compiled original; it does not normalize
markers, add `--no-binary-patching`, bypass signatures, or relax the portable/NSIS
comparison. Missing or redirected restoration targets fail closed. Descriptor/path
identity and regular-file checks refuse unsafe file replacements.

Only a final transient HTTP 429/500/502/503/504 error whose last download is one
of the two exact pinned NSIS URLs permits another bundle attempt. Backoffs are
five then ten seconds. Unknown URLs, missing/evicted context, permanent HTTP errors,
hash failures and compiler/installer errors remain failures. Tauri still performs
its [original download/hash validation](https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.12.0/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs).
Versions, locks, hashes, toolchains, package staging and all existing gates stay
unchanged.

Output retains stream backpressure and at most 65,536 diagnostic characters.
Cancellation stops the owned process tree or backoff, restores an available
portable original, and prevents further attempts. Physical entry-path comparison
ensures a junction invocation really executes the CLI.

The child-process regression models Tauri's in-place binary mutation, cached
build outputs and sequential download failures. It checks byte-for-byte original
restoration and the unchanged portable/installer comparator, refusal and I/O
failure paths, locked compile arguments, finite bundle attempts, cancellation
including a real grandchild, and actual entry through a directory alias. These
are controlled CLI fixtures, not a native installer build or vendor-availability
proof. Actual Windows packaging and fresh standard-user acceptance remain required.

This changes build preparation only. It neither retries a payment nor deploys,
installs on the owner's computer, publishes a release or allocates a version.
