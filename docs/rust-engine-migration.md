# Shared Rust engine: staged migration and acceptance

**Status, September 28, 2026:** authorized evaluation and a bounded read-only
candidate, not a production cutover. The deployed TypeScript buyer, Operator and
Electron paths remain authoritative. This document defines what evidence is needed
before any domain changes owner. [D-242](../DECISIONS.md) records the decision.

## Scope and authority

The intended long-term shape is one Rust domain core for task and receipt rules,
separate platform I/O, and thin adapters. A native CLI can call the core now. A
future Tauri desktop should call the same crate directly instead of hosting a second
Node payment engine. A future web/MCP integration would need a versioned service
adapter with explicit authentication, authorization, lifecycle, resource limits and
operational ownership. These are architecture targets, not shipped integrations.

The first candidate is a **read-only** native CLI over existing v1 private Operator
directories: `status`, saved `result`, and Markdown `brief`. It may verify local
hashes and request bindings, and it must retain unknown payment/delivery state where
the local files cannot prove settlement. It cannot create a task, sign, buy, resume a
payment, contact a server, reconcile, or change an on-disk format. The existing
TypeScript implementation is its compatibility oracle during evaluation. A migrated
domain gets one production authority only after acceptance; keeping two independent
production rule implementations indefinitely would defeat the shared-engine goal.

The existing buyer signer, source-owned `payTo`, single-use nonce, atomic cap
reservation, journal-before-signature recovery, exact integer micro-USDC allocation,
registry payout authority and real settlement evidence stay in their current code.
Moving any of those requires a separate threat model, focused tests, cross-process
failure drills, review and rollback. A successful read-only CLI does not imply that
payment, research/LLM orchestration, web, MCP or Tauri has migrated.

## First slice acceptance

| Gate | Required evidence before a domain cutover |
| --- | --- |
| Contract parity | Differential fixtures made with the TypeScript writer cover valid v1 tasks, journals and completed results, including optional fields, old compatible records and boundary sizes. Output semantics and exit states match for accepted input. Any stricter Rust refusal must be security justified, listed by fixture and reviewed. |
| Canonical data | Cross-runtime corpus checks JavaScript-compatible canonical JSON, key order, Unicode escaping and normalization behavior, number formatting, integer micro-USDC conversion, SHA-256 and receipt/request binding. No silent float rounding or JSON reserialization changes. |
| Hostile local files | Reject truncated, tampered, oversized, unexpected-version or path-escaping input; test symlink/junction boundaries and file changes during inspection. `status` and `result` remain read-only; `brief --file` creates only the requested new file and refuses overwrite. Directory tree hashes before and after prove no unintended writes. |
| Recovery and rollback | Existing v1 directories remain readable by the TypeScript path. A failed candidate can be disabled without rewriting tasks, journals or results, losing a completed answer, or causing a second purchase. Test restart and offline opening. |
| Platforms | Native Rust tests, lint and differential harness pass on Windows and Linux. A Tauri desktop needs its own MSVC build, package, IPC permission, startup/memory and clean-machine tests before replacing Electron. |
| Operations and release | The candidate has a pinned lockfile, reproducible build commands and CI. Reviewer records observed behavior and remaining risks. Production routing requires the domain cutover criteria here and the existing product/mainnet gates. |

For each logically complete verified update, push a focused feature branch with a
descriptive conventional commit, open a PR, pass required CI and review, then merge.
Include the tests and accurate documentation needed to review it; exclude private
fixtures, credentials and generated binaries. A green synthetic read-only slice
remains an evaluation milestone, not a payment or production cutover.

The differential harness uses synthetic private fixtures only. It invokes both
command-line programs in fresh processes and compares JSON and brief output,
refusals and on-disk tree hashes. Its timing report includes CLI startup but excludes
native compilation; it cannot establish a desktop speed or memory advantage. A Rust
binary size has no directly comparable standalone TypeScript artifact. Report the
fixture count, platform, compiler and measured values before drawing a performance
conclusion. No live wallet, private production data or network service is needed.

Local Rust formatting, Clippy, six unit tests, release build, TypeScript check,
ESLint and the differential harness passed. An initial Windows CI run exposed a
fixture path alias/casing mismatch. The harness now canonicalizes its newly
created temporary fixture root with `realpath` and asserts the paths used by the
existing TypeScript result writer; no production validation was weakened. On
[`a5d86bb` in PR #2](https://github.com/tang-vu/keryx/pull/2), the application,
Ubuntu Rust, Windows MSVC Rust and GitGuardian checks all passed.

The final September 28 Windows x64 release-mode run passed 38 strict synthetic
parity/refusal assertions and ran two parser acceptance probes. Its corpus includes
the JavaScript binary64 integer boundary (`9007199254740992`), the adjacent raw
integer token (`9007199254740993`), raw `u64` maximum
(`18446744073709551615`) and decimal number boundaries. The source task tree's
hash was unchanged. Duplicate JSON keys are accepted by both parsers.
One valid-input gap remains open for full cutover: TypeScript accepts a
lone UTF-16 surrogate in JSON while the Rust parser refuses it. The stricter
refusal avoids a cross-runtime Unicode representation mismatch but needs an
explicit compatibility decision. A copied native executable ran on the same host
with a system-only `PATH`; this is neither a clean-machine validation nor a
Tauri package result.

The same run used Node v24.12.0 and Rust 1.98.1 (`x86_64-pc-windows-gnu`).
These are medians of seven fresh process launches through output, excluding
compilation. The TypeScript column includes `--import tsx`; an optional
`esbuild` 0.28.2 bundle targets Node 20 and still requires Node:

| Command | TypeScript with tsx | Bundled JavaScript | Rust CLI |
| --- | ---: | ---: | ---: |
| `status` | 437.0 ms | 160.7 ms | 46.7 ms |
| `result` | 468.3 ms | 191.8 ms | 44.2 ms |
| `brief` with new-file export | 454.4 ms | 189.9 ms | 50.6 ms |

The empty Node process baseline was 95.6 ms. The Rust release executable was
1,862,916 bytes; the bundled `.mjs` was 169,102 bytes but depends on an installed
Node runtime. These measurements describe same-host CLI launch behavior, not
domain-computation speed, Electron/Tauri startup, RAM, install footprint or a
clean-machine package.

## Reproduce locally

Node.js 20.18.2 or newer and repository `npm install` dependencies are needed for
the TypeScript compatibility harness. The Rust workspace is `rust/Cargo.toml`.

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --manifest-path rust/Cargo.toml --locked
cargo clippy --manifest-path rust/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
npm run test:rust-engine
# Optional local launch comparison with a bundled JavaScript CLI:
npm run test:rust-engine -- --bundled-baseline
```

The release binary is `rust/target/release/keryx-engine.exe` on Windows and
`rust/target/release/keryx-engine` on Linux. The harness accepts an absolute
`KERYX_RUST_ENGINE` override for another build location. CLI commands are
`keryx-engine status --state PATH`, `keryx-engine result --state PATH`, and
`keryx-engine brief --state PATH [--file PATH]`. Status and result emit JSON;
brief emits UTF-8 Markdown to stdout, or creates a new file and emits its path as
JSON when `--file` is supplied.

On this Windows development PC, Rust/Cargo 1.98.1 with the
`x86_64-pc-windows-gnu` host was installed via official `rustup` for user-local
core work. The official installer download matched its published SHA-256 and a
native smoke binary ran.
This does **not** meet the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/):
Microsoft C++ Build Tools, a Windows SDK and the MSVC Rust target are required.
[Rust's Windows MSVC guide](https://rust-lang.github.io/rustup/installation/windows-msvc.html)
explains those components; [Microsoft's Visual Studio 2022 requirements](https://learn.microsoft.com/en-us/visualstudio/releases/2022/system-requirements)
require administrator rights for initial installation. The current session is
non-admin. Do not claim a Tauri acceptance build until those prerequisites and an
actual packaged artifact are verified.

## Later gates

After the read-only slice passes, select one narrow domain at a time and specify its
trusted input, current owner, Rust API, persisted format, failure states, acceptance
corpus and rollback. Switch callers only after the new engine has met that domain's
security, reliability and parity criteria. Keep the TypeScript oracle solely for
transition tests and a time-bounded rollback path, then retire the duplicate rule
implementation when the new domain is stable. Data migrations need reversible,
versioned readers and restore drills; never use an automatic rewrite as the first
deployment step. A future desktop switch additionally compares the current Electron
artifact and a real Tauri artifact on the same tasks and machine. Signing, settlement,
spend and recovery stay separate future gates, irrespective of CLI progress.
