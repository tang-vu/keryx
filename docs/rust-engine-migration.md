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

The PR #2 September 28 Windows x64 release-mode run passed 38 strict synthetic
parity/refusal assertions and ran two parser acceptance probes. Its corpus includes
the JavaScript binary64 integer boundary (`9007199254740992`), the adjacent raw
integer token (`9007199254740993`), raw `u64` maximum
(`18446744073709551615`) and decimal number boundaries. The source task tree's
hash was unchanged. Duplicate JSON keys are accepted by both parsers.
That run exposed one valid-input gap for full cutover: TypeScript accepts a
lone UTF-16 surrogate in JSON while the Rust parser refuses it. The candidate
policy is now explicit below; full v1 compatibility remains a cutover gate.
A copied native executable ran on the same host
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
clean-machine package. These are historical PR #2 measurements; they do not measure
the later handle-based, double-read implementation described below.

## Unicode compatibility policy

[D-243](../DECISIONS.md) retains the candidate's Unicode scalar string model.
Valid surrogate pairs, literal astral characters and text containing a literal
backslash followed by `u` are supported. An unpaired high or low UTF-16 surrogate
in a parsed JSON key or value remains unsupported. That includes nested or
otherwise unused fields: parsing precedes schema validation and receipt hashing.
The candidate must refuse without rewriting the task, emitting a partial result
or creating a brief. It must never replace a code unit with U+FFFD, drop it,
normalize the text or alter a digest to gain acceptance.

Existing TypeScript readers remain the authority for all accepted v1 inputs.
If the candidate refuses an existing task, use the same private directory with
`npm run operator -- status --state PATH`, `result --state PATH`, or
`brief --state PATH --file NEW_PATH` as appropriate. Those commands do not buy or
resume a payment; `brief --file` creates only the requested new brief. Preserve the
original files; do not edit an answer, request or receipt to satisfy the Rust parser.
A TypeScript refusal still needs inspection; fallback is not a promise to accept
corrupted data. TypeScript `result` emits JSON that preserves unpaired code units
as escapes. Its Markdown brief uses Node's UTF-8 encoding, which replaces unpaired
surrogates with U+FFFD. Such a brief is a human-readable export, not a lossless
replacement for the JSON result or original receipt.

This decision resolves the candidate's behavior, **not full v1 cutover**. Supporting
all existing JavaScript strings would require a lossless code-unit representation
through parsing, sorting, canonicalization, hashing, output and brief encoding.
Alternatively, a future versioned contract must retain a reviewed legacy-read and
rollback path. Neither change is implemented here. Do not route production callers
to the Rust candidate or silently switch runtimes based on a parsing failure.

The D-243 follow-up passed local Windows GNU release validation: six Rust unit
tests, formatting, Clippy, TypeScript checking, targeted ESLint, and 42 strict
synthetic harness checks (25 parity and 17 shared refusals), plus nine separately
counted intentional Unicode incompatibilities. The latter assert TypeScript
readability, the Rust fallback diagnostic, empty Rust stdout, no refused brief
file and unchanged source trees. They cover task/request, journal, observation,
saved answer/key and a TypeScript-written receipt payload with surrogate keys and
values. Paired escaped astral keys/values remain digest-compatible. The harness
also asserts the TypeScript Markdown encoding limitation above. [PR #3](https://github.com/tang-vu/keryx/pull/3)
passed hosted application, Linux and Windows Rust checks and automated review;
the corresponding main workflows also passed. This evidence does not close the
remaining gates below.

## Remaining read-only acceptance work

The following source audit is an acceptance backlog, not a new cutover approval.
The prior Windows/Linux CI pass proves the covered corpus, not every gate above.

### File inspection boundary

[D-244](../DECISIONS.md) anchors candidate reads to held directory handles. The
filesystem root is opened once, then task components and the buyer directory are
opened without following links. Fixed child filenames are resolved from those
handles. The implementation uses pinned [`cap-std`](https://docs.rs/cap-std/4.0.3/cap_std/)
and [`cap-fs-ext`](https://docs.rs/cap-fs-ext/4.0.3/cap_fs_ext/) APIs, with opened-file
identity comparisons, instead of application-owned unsafe OS bindings.

Each JSON read remains byte-bounded and UTF-8 checked. Two reads from the same
file handle must agree; metadata and the directory entry's file identity are also
checked. Observable growth, content changes or entry replacements cause refusal.
Unix file opens are nonblocking so a FIFO substituted at open cannot wait for a
writer before the regular-file check. An inspection refusal does not rewrite the
original files, publish a partial result, or initiate a purchase or recovery.

These checks do **not** establish a transaction snapshot across all v1 files.
A held directory identifies the opened object: if its name can be replaced, the
reader stays with that object rather than following the new pathname. V1 has no
directory-wide generation or writer-coordination protocol. A malicious same-user
writer that can restore bytes/metadata between observations, hard links, and
filesystem/mount behavior outside the tested environments remain outside this
guarantee. Re-run a failed local read after ordinary writes finish; preserve the
task and buyer journal. Do not interpret these checks as independent settlement
evidence or full read-only cutover acceptance.

The D-244 local Windows GNU release harness passed 74 strict checks (43 parity,
31 paired refusals) and nine separately counted intentional Unicode
incompatibilities. In addition to brief output paths, it verifies ordinary relative
and Windows drive-relative task paths for `status` and `result`. The six file-size
fixtures use TypeScript-written valid records and count UTF-8 bytes. Controlled
native read tests cover growth, same-size edits with restored mtime, entry
replacement and held-directory rename. On this host, Windows prevented the held
directory rename; creating a file symlink lacked privilege and was explicitly
skipped. Hosted platform logs must distinguish that skip from exercised coverage.

This run used Node v24.12.0 and Rust 1.98.1 GNU; the release executable was
2,073,809 bytes. Seven fresh-process median launch-through-output times were
443.5/51.2 ms (TypeScript/Rust) for `status`, 475.6/48.7 ms for `result`, and
486.8/55.8 ms for new-file `brief`. As with the historical measurements above,
these are same-host CLI observations, not desktop or domain-computation results.

| Gate | Existing evidence | Work still required |
| --- | --- | --- |
| CLI contract | `brief --file` now emits the TypeScript contract: absolute `saved` path and `private: true`. The harness compares exact response JSON, Markdown, lexical relative/absolute paths, dot segments, Unicode/spaces, a linked parent followed by `..`, and overwrite refusal with empty stdout and unchanged output. Windows adds drive-relative and drive-rooted cases. | Keep broader adapter compatibility under evaluation. Rust stdout-only brief remains a documented extension, not a TypeScript CLI parity claim. |
| Full v1 input | The numeric, Unicode scalar, request-binding and corruption corpus passes; D-243 defines the candidate's unsupported Unicode case. | Resolve lossless legacy Unicode handling before full v1 cutover. Expand optional/older-record, unknown-version, truncation and canonical-key coverage; never infer universal equivalence from a finite corpus. |
| File bounds | Differential fixtures use valid multibyte JSON at the exact limit and limit plus one for task/request/observation (8,192 bytes), intent (65,536), result (150,000) and receipt (2,000,000). Native tests exercise bounded reads and controlled growth. | Preserve byte-based limits when expanding schemas; these cases do not prove every possible concurrent writer schedule. |
| Paths and concurrent reads | Directory-relative no-follow opens, repeated bounded reads and opened-file identity checks replace the separate pathname check/open. Native tests control growth, same-size writes with restored mtime, entry replacement, held-directory rename, file/task/ancestor links, and Unix FIFO refusal. Windows may prevent a held-directory rename; file-symlink coverage requires creation privileges. | Multi-file transaction snapshots and a hostile same-user writer that restores state between observations remain outside this boundary. Record the exercised platform branches with each release; do not treat a permission-related test skip as exercised coverage. |
| Recovery/export | Synthetic source tree hashes remain unchanged by reads; new-file brief export refuses overwrite; TypeScript continues to read v1. Output paths follow TypeScript lexical resolution and normal parent-link behavior. | Add explicit restart/disable-candidate/offline rollback drills. Define and inject export write/sync failures: both implementations can leave a partially written new brief, so atomic export is not established. Broaden output-parent link cases beyond lexical `link/..`. |
| Platforms/release | Pinned Rust lockfile, native lint/tests, differential CI on Linux and Windows MSVC; copied native executable runs on the same Windows host. | Record checks and review for each update. Clean-machine packaging and Tauri MSVC/package/IPC/startup/memory acceptance remain separate open gates. |

Next, expand the legacy-input corpus and exercise explicit rollback and export
failure drills before attempting a read-only production switch. Keep synthetic
fixtures private and separate from actual payment or traction evidence.

## Next domain candidate: local task creation

After the read-only gates pass, evaluate only the immutable v1 task envelope;
this is a selected next evaluation scope, not permission to switch callers now.
The current owner is `lib/operator/task.ts::createOperatorTask`. Inputs are an
untrusted request, a user-supplied independently verified payee and total cap, and
an explicitly selected private target directory. The core validates those inputs
and prepares task/request values; a platform adapter owns exclusive creation,
permissions, bounded encoding and durable writes. UUID and creation time must be
explicit core inputs or injected capabilities for reproducible parity tests.

Preserve the existing `task.json` and `request.json` v1 schemas and the rule that
creation never signs, funds or purchases. Existing targets, unsupported input,
unsafe paths and incomplete writes must have explicit refusal/recovery states.
Retain incomplete creation for inspection, matching the current TypeScript policy;
do not add automatic deletion or a format rewrite as recovery. The corpus must
cover cap/payee/request parity, Rust-created files opened by TypeScript, Unicode
policy, file bounds, Windows permissions and Unix modes, concurrent creation,
links, injected crash/write failures, restart and no writes on admission refusal.
Rollback disables the new writer while TypeScript continues reading the same v1
files. One writer becomes authoritative only after separate review and a documented
rollback window. Buyer journals, signing, settlement, resume and research execution
remain outside this domain.

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
brief emits UTF-8 Markdown to stdout, or creates a new file and emits
`{"saved":"ABSOLUTE_PATH","private":true}` when `--file` is supplied. The saved
path and opened target use lexical resolution, matching TypeScript; output-parent
links can be followed. Unix exports use mode `0600`; Windows inherits the parent
ACL. `private: true` does not audit the chosen parent or its permissions.

On this Windows development PC, Rust/Cargo 1.98.1 with the
`x86_64-pc-windows-gnu` host was installed via official `rustup` for user-local
core work. The official installer download matched its published SHA-256 and a
native smoke binary ran. The new filesystem dependencies also require GNU target
binutils when building on this host. User-local official MSYS2 MinGW64 binutils
2.47-3, gettext-runtime 1.0-1, libiconv 1.19-1, zlib 1.3.2-2 and zstd 1.5.7-2 were
checked against their package-page SHA-256 values and supplied through the build
process's `PATH`. This is local GNU tooling, not a Windows MSVC or Tauri prerequisite
substitute; hosted Windows acceptance uses MSVC.
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
