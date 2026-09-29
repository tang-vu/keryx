# Shared Rust engine: staged migration and acceptance

**Status, September 29, 2026:** the [immutable task creation release](./native-task-creation.md)
integrates Rust creation into the Operator CLI and current Electron desktop under
D-259, subject to its integrated release checks. TypeScript continues to own task
inspection, saved results, exports, buyer recovery and all payment paths. The
earlier evaluation sections below record historical gates and evidence; they do
not supersede D-259's creation boundary. [D-242](../DECISIONS.md) records the original
staged migration decision.

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

[D-246](../DECISIONS.md) supersedes D-243's scalar-only candidate restriction.
The read-only core now preserves JavaScript UTF-16 code units in keys and values,
including lone high and low surrogates, nested or unused fields, and duplicate
escaped-equivalent keys. Valid surrogate pairs and literal astral characters have
the same value; a literal backslash followed by `u` remains distinct. Duplicate
keys retain their first insertion position and last value, matching `JSON.parse`.
Canonical keys sort by UTF-16 units. Ordinary JSON output instead uses JavaScript
integer-index property order followed by insertion order.

The parser validates bounded UTF-8 input before using pinned `serde_json` RawValue
grammar validation and its documented byte-string decoding. The maintained
`rustpython-wtf8` representation carries code units through domain validation,
request comparison, canonical serialization and result JSON. There is no new
handwritten JSON grammar or application-owned unsafe decoder. Original private
files are never normalized or rewritten to make a digest pass.

Numeric overflow is distinct from JSON null. As in JavaScript, a token such as
`1e400` becomes a nonfinite number; ordinary JSON serialization emits null, while
Keryx canonical JSON refuses nonfinite values. Existing finite-number and exact
micro-USDC validation remain in force. Negative zero serializes as zero.

Parser input is capped at 2,000,000 bytes in addition to each file's existing
smaller limit. Nesting is capped at 128 child edges from the root and the parser
admits at most 200,000 values, including overwritten duplicate values. These are
explicit candidate resource limits, not new v1 format restrictions. A command
that parses a file beyond these limits refuses it with fallback guidance and no
result output or brief creation, even if TypeScript accepts that file. Status does
not fully parse saved results or receipts merely to report their presence. A finite
corpus cannot prove equivalence for every JavaScript input.

Existing TypeScript readers remain the authority for all accepted v1 inputs.
If the candidate refuses an existing task, use the same private directory with
`npm run operator -- status --state PATH`, `result --state PATH`, or
`brief --state PATH --file NEW_PATH` as appropriate. Those commands do not buy or
resume a payment; `brief --file` creates only the requested new brief. Preserve the
original files; do not edit an answer, request or receipt to satisfy the Rust parser.
A TypeScript refusal still needs inspection; fallback is not a promise to accept
corrupted data. Both result JSON paths preserve unpaired code units as escapes.
Answer SHA-256 and Markdown use Node-compatible UTF-8 encoding, which replaces
unpaired surrogates with U+FFFD. Canonical receipt JSON retains their escapes before
hashing. A brief is a human-readable export, not a lossless replacement for the
JSON result or original receipt.

This decision changes the candidate's representation, **not production authority**.
Do not route production callers to the Rust candidate or silently switch runtimes
based on a parsing failure. Read-only cutover still needs the remaining acceptance
and release gates below.

Historically, the D-243 follow-up passed local Windows GNU release validation: six
Rust unit tests, formatting, Clippy, TypeScript checking, targeted ESLint, and 42 strict
synthetic harness checks (25 parity and 17 shared refusals), plus nine separately
counted intentional Unicode incompatibilities. The latter asserted TypeScript
readability, the Rust fallback diagnostic, empty Rust stdout, no refused brief
file and unchanged source trees. They cover task/request, journal, observation,
saved answer/key and a TypeScript-written receipt payload with surrogate keys and
values. Paired escaped astral keys/values remain digest-compatible. The harness
also asserts the TypeScript Markdown encoding limitation above. [PR #3](https://github.com/tang-vu/keryx/pull/3)
passed hosted application, Linux and Windows Rust checks and automated review;
the corresponding main workflows also passed. This evidence does not close the
remaining gates below.

The D-246 Windows GNU release run passed **172 strict differential checks**
(118 parity and 54 paired refusals), plus four separately counted candidate
resource-limit refusals with explicit TypeScript reopening. The former nine
surrogate incompatibilities now require parity. Twelve pinned JSON/canonical/hash
vectors preserve raw duplicate-key and numeric token spellings in receipt files;
additional vectors distinguish numeric overflow, answer UTF-8 hashes and malformed
bytes/escapes. All 18 leading-BOM combinations (six files and three commands)
passed. Optional claim/evidence text and receipt ledger text preserve code units;
claim indexes follow the existing finite nonnegative integer schema without a new
safe-integer cap. Present non-array citations now refuse, while absent citations
and the existing first-64-before-filter behavior remain compatible.

The run also passed 12 guarded offline fallback commands, one guard self-check
and three export-boundary cases. File-symlink creation was privilege-blocked on
the local Windows host; a directly linked output-parent junction was exercised.
Nineteen core and 12 CLI native tests passed, as did formatting, Clippy, release
build, TypeScript and targeted ESLint. A separate release stress test used exactly
2,000,000 bytes at depth 128 with mixed scalar and lone-surrogate text: one local
observation was 532 ms to parse and 436 ms to canonicalize. This is one stress
shape on Windows GNU, not a universal maximum-cost bound or desktop benchmark.
The Linux/MSVC CI matrix explicitly runs that stress test as well as the native,
publisher and differential suites; its exercised/skipped branches must be retained
with the release evidence.

The [PR #7 hosted matrix](https://github.com/tang-vu/keryx/actions/runs/36456432001)
passed on head `924af8a`: Windows MSVC ran 172 strict checks (118 parity and 54
paired refusals), and Linux ran 166 (114 and 52). Both separately passed four
resource refusals, 12 guarded TypeScript fallback commands, one guard self-check,
18 BOM combinations and four export-boundary cases with zero export skips. Core
tests were 19 on Windows and 20 on Linux, plus 12 CLI tests per platform and the
explicit release stress test. Application CI and the
[recorded automated review](https://github.com/tang-vu/keryx/pull/7#issuecomment-5874990590)
also passed. Merge `81eec28` preserves TypeScript production authority; this evidence
closes the covered Unicode defect, not every read-only cutover gate.

## Remaining read-only acceptance work

The following source audit is an acceptance backlog, not a new cutover approval.
The prior Windows/Linux CI pass proves the covered corpus, not every gate above.

### Datetime compatibility and monetary boundary

[D-249](../DECISIONS.md) replaces general RFC3339 parsing with the existing v1
TypeScript datetime grammar. The candidate accepts UTC minute precision such as
`2026-09-28T00:00Z`, optional seconds and nonempty fractional seconds. Four-digit
Gregorian dates include year zero and use the century/four-century leap rule.
Uppercase `T` and `Z` are required; leap seconds, offsets, alternate separators,
non-ASCII digits and trailing data refuse. Accepted strings retain their original
spelling and precision in task `createdAt`, observation `observedAt` and result
`savedAt`; no file is rewritten or timestamp normalized.

Local Windows GNU validation passed 20 core and 12 CLI native tests, formatting,
Clippy, release build, TypeScript and scoped ESLint. The expanded CLI corpus passed
232 strict checks (136 parity and 96 paired refusals), including five accepted and
13 refused datetime vectors independently applied to each of the three fields.
Each vector first checks the installed Zod oracle. The corpus also preserves the
read boundaries: an invalid observation does not invalidate a separately saved
result, and status can still report `present_unchecked` for a result with an invalid
saved timestamp. Brief success/refusal, original spelling and unchanged source
trees are checked. Four candidate resource refusals remain counted separately;
12 guarded fallback commands, one guard self-check and three local export cases
passed. Local file-symlink setup was privilege-blocked; hosted platform checks
remain required. This resolves the demonstrated datetime discrepancy, not universal
v1 equivalence or production cutover.

The [PR #10 Linux/MSVC matrix](https://github.com/tang-vu/keryx/actions/runs/36465891970)
passed 232 strict checks on Windows (136 parity/96 refusals) and 226 on Linux
(132/94). Both separately ran the inter-file and release stress tests and four
export-boundary cases with zero skips. Application CI and
[independent automated review](https://github.com/tang-vu/keryx/pull/10#issuecomment-5876134739)
passed before merge `0a98965`.

The TypeScript request schema also admits the positive budget `1e-15`, because its
floating-point tolerance rounds that value to zero micro-USDC. A synthetic task
written with `createOperatorTask` remains readable by TypeScript, while Rust refuses
it as an invalid creator budget; `0.000001` is accepted by both. This is a confirmed
compatibility boundary, not evidence of a payment or cap bypass. [D-250](../DECISIONS.md)
preserves the candidate's nonzero integer micro-USDC rule as an intentional refusal
and adds explicit manual TypeScript inspection guidance. No stored request is
normalized, and no TypeScript schema or payment rule changes.

The dedicated synthetic driver uses production TypeScript task/journal writers and
GET recovery verification to save a complete tiny-budget fixture and a one-micro
control. Its stub accepts only the expected job and receipt GETs. It checks three
candidate-only refusals separately from three control parity checks: status, result
and brief. Refusals produce no successful stdout or brief file, and source-tree
hashes remain unchanged. After an explicit missing-binary check, six fresh guarded
TypeScript commands reopen the original tiny-budget directory across two runs. A
guard self-check attempts network and child-process actions and requires refusal;
this instrumentation is not an OS sandbox. Synthetic receipt fields are fixtures,
never payment or traction evidence.

Local Windows GNU validation passed all three candidate refusals, three one-micro
control checks, six guarded fallback commands and the guard self-check. The existing
CLI corpus retained 232 strict checks (136 parity/96 paired refusals). Twenty-one
core and 12 CLI native tests, formatting, Clippy, release build, TypeScript and scoped
ESLint passed. The Linux/MSVC workflow builds the release binary before invoking the
dedicated driver; its hosted results remain required before release.

For this candidate refusal, preserve the original directory and use the TypeScript
`status`, `result` or `brief --file NEW_PATH` commands documented above. They do not
buy or resume payment. TypeScript can still reject corrupted data; do not rewrite
files or repurchase merely because a native inspection refused them. Before admitting
a new writer, explicitly decide how legacy reading relates to new monetary admission
and verify buyer quote/create/recovery boundaries. That policy remains open; neither
a successful local inspection nor this documented refusal supplies spending authority.

### Local inspection contract

[D-248](../DECISIONS.md) limits the candidate to **local, nonauthorizing inspection**.
V1 does not have a directory-wide generation or transaction protocol. A file can
change after its completed bounded read; a later file can therefore belong to a
different moment even though both individual reads pass. Bindings reject observed
task/request/intent/result/receipt inconsistencies. They do not prove that all values
existed together at one instant, remain current, or came from a trusted writer.

Status verifies its task, request, journal and optional observation. Its result-file
check uses metadata only and reports `present_unchecked`; it does not verify the
answer or receipt. An older `observedAt` and seller-reported observation can coexist
with a newly published result file. Top-level payment and delivery stay `unknown`,
and the observation explicitly says it may be stale.

Result inspection verifies the locally saved snapshot and its named receipt. If a
new coherent result is published after the old snapshot was read and the old receipt
is retained, returning the old answer, digest and `savedAt` is allowed. This is an
older local result, not evidence of current server state or independent settlement.
Unkeyed integrity hashes cannot authenticate a consistent set rewritten by a process
with the same user's file access, or reauthenticate the historical HTTPS digest.

Neither a status stage nor a verified local result may authorize signing, spending,
repurchase, reconciliation or a mutable writer. Any future caller needing such a
precondition must use a separately accepted coordination/generation or transaction
protocol. A failed read preserves the original files; retry only as a fresh local
inspection after ordinary writes finish. Keep the existing TypeScript reader and
original journal available without rewriting records or buying again.

Acceptance tests must control the interval between completed file reads, validate
each starting fixture with the TypeScript writer/reader, distinguish mismatched
bindings from an allowed older observation/result, and attribute filesystem changes
only to the test writer. Per-file growth, replacement, no-follow and byte/resource
checks remain separate required tests. This contract does not pass the still-open
production adapter, binary delivery/rollback, or desktop cutover gates by itself.

Local Windows GNU validation passed the explicitly invoked TypeScript-generated
native case, covering five controlled mutations. The observation case starts with
no result file, then publishes a new observation, result and receipt between reads:
the in-flight status retains the old observation and sees `present_unchecked`, while
a fresh inspection sees the newer observation and answer. File byte comparisons
attribute changes only to the fixture writer. The existing suite also passed 19 core
and 12 CLI tests, formatting, Clippy, release build, TypeScript and scoped ESLint.
The differential harness retained 172 strict checks (118 parity and 54 paired
refusals), four resource refusals, 12 guarded fallback commands and one guard
self-check. Three local export-boundary cases ran; file-symlink setup was explicitly
privilege-blocked. Hosted Linux/MSVC results remain a separate release gate.

The [PR #9 Linux/MSVC matrix](https://github.com/tang-vu/keryx/actions/runs/36464419380)
subsequently passed the explicit inter-file case and separate release stress test
on both platforms. Windows ran 19 ordinary core and 12 CLI tests; Linux ran 20 and
12. Strict differential counts were 172 (118 parity/54 refusals) and 166 (114/52),
respectively, with four export-boundary cases and zero skips on each. Application
CI and the [independent automated review](https://github.com/tang-vu/keryx/pull/9#issuecomment-5875947882)
passed before merge `4bc4804`. These counts describe that release's covered corpus.

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
| Full v1 input | The corpus includes nullable reserve, optional accounting/service/quality/claim/evidence fields, citation filtering/caps/UTF-16 limits, and schema/truncation mutations across six file classes. Internally consistent unsupported request/receipt versions are tested separately from broken-hash mutations. D-246 replaces the scalar-only model with lossless code units and explicit parser resource limits. | Record reviewed cross-platform lossless, canonical-key and resource-boundary evidence before read-only cutover; never infer universal equivalence from a finite corpus. |
| File bounds | Differential fixtures use valid multibyte JSON at the exact limit and limit plus one for task/request/observation (8,192 bytes), intent (65,536), result (150,000) and receipt (2,000,000). Native tests exercise bounded reads and controlled growth. | Preserve byte-based limits when expanding schemas; these cases do not prove every possible concurrent writer schedule. |
| Paths and concurrent reads | Directory-relative no-follow opens, repeated bounded reads and opened-file identity checks replace the separate pathname check/open. Native tests control growth, same-size writes with restored mtime, entry replacement, held-directory rename, file/task/ancestor links, and Unix FIFO refusal. Windows may prevent a held-directory rename; file-symlink coverage requires creation privileges. | Multi-file transaction snapshots and a hostile same-user writer that restores state between observations remain outside this boundary. Record the exercised platform branches with each release; do not treat a permission-related test skip as exercised coverage. |
| Recovery/export | Fresh TypeScript processes reopen valid and lone-surrogate v1 directories after an explicit unavailable-candidate failure, with network/child-process calls instrumented to fail. D-245 tests write/sync/close, publication and cleanup failures, ambiguous publication, concurrent exporters and existing targets. Source tree hashes remain unchanged. Output paths retain lexical resolution and normal parent-link behavior. | Keep platform evidence with each release. This is explicit TypeScript fallback, not automatic runtime routing or an OS network sandbox. Directory-entry crash durability and hostile parent replacement remain outside the export guarantee. |
| Platforms/release | Pinned Rust lockfile, native lint/tests, differential CI on Linux and Windows MSVC; copied native executable runs on the same Windows host. | Record checks and review for each update. Clean-machine packaging and Tauri MSVC/package/IPC/startup/memory acceptance remain separate open gates. |

Broader caller compatibility and artifact delivery/rollback still precede a
read-only production switch. D-248 scopes the filesystem residuals to local
inspection; it supplies no transactional precondition for an authorizing caller. Existing
CLI and Electron callers invoke TypeScript directly; no production native-engine
router is shipped. Desktop packaging and Tauri acceptance remain separate gates.
Keep synthetic fixtures private and separate from actual payment or traction evidence.

D-251 adds an explicitly selected CLI-only
[native caller evaluation](./native-inspection-evaluation.md). Its trusted artifact
pin, protocol handshake, bounded process lifecycle and manual rollback drill address
the caller boundary without changing production routing. Cross-platform artifact
and real-process fault evidence must be recorded before calling that evaluation
validated; clean-machine installation and a production cutover decision remain
separate gates.

D-252 extends the native evaluation with separate CI artifact producer and
consumer jobs. Its [handoff contract](./native-inspection-evaluation.md#independent-artifact-handoff)
requires exact source/target selection, strict artifact verification, read parity
and manual TypeScript rollback without rebuilding Rust in the consumer. This is
an additional delivery test; production caller ownership and clean-machine
acceptance remain open.

### Brief publication boundary

[D-245](../DECISIONS.md) makes both CLI adapters stage the complete brief in an
exclusive private sibling, sync the file contents, release its handle, then publish
with [`hard_link`](https://doc.rust-lang.org/stable/std/fs/fn.hard_link.html) /
[`fsPromises.link`](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath).
Publication refuses an existing destination, including a symlink or directory.
There is no overwrite rename or direct-write fallback on filesystems without hard
links. TypeScript checks handle close errors; Rust checks `sync_all` and then drops
the handle, whose close errors are not observable through the standard library.

Write, sync or checked-close failure occurs before publication. A publication-call
error has an unconfirmed outcome; an error alone does not prove that a filesystem
made no change. Error cleanup removes only the owned staging name, never the final
path. After a successful publication call, failure to remove the staging name leaves a
complete final brief and reports an error with no success JSON. Diagnostics identify
the publication state and paths requiring inspection; they never include brief
contents. The final path is never deleted as rollback. The chosen output parent
must be trusted and private. This gives complete-file publication, not a hostile
parent-race boundary or cross-platform crash durability for directory entries.

Local Windows GNU validation of this slice passed 106 strict differential checks
(61 parity and 45 paired refusals), nine separately counted Unicode incompatibility
checks, 12 guarded TypeScript fallback commands across two process lifecycles,
one guard self-check and three export-boundary cases. The guard self-check attempts
fetch, HTTP, HTTPS, socket and child-process actions and requires their refusal.
The native candidate is explicitly unavailable before the fallback drill; no
automatic runtime fallback is introduced. The Windows file-symlink setup was
privilege-blocked locally; directly linked output-parent publication was exercised.
The CLI crate's 12 native tests and 15 focused TypeScript publisher tests passed,
along with formatting, Clippy, release build, TypeScript and targeted ESLint.
The CI matrix runs the TypeScript publisher faults as well as native tests and the
differential harness on Windows MSVC and Linux. Hosted logs must record exercised
link cases separately from permission-related skips.

## Next domain candidate: local task creation

The D-251/D-252 read-only platform and artifact drills have passed, including
the independently downloaded main MSVC artifact on the Windows development PC;
see [the recorded handoff evidence](native-inspection-evaluation.md#independent-artifact-handoff).
D-253 starts with [pure task preparation](rust-task-preparation-evaluation.md):
validation and exact v1 bytes with explicit identity/time inputs and no filesystem
writer. That stage does not establish native creation durability or switch callers.
D-254 evaluates the [separate native publication boundary](rust-task-publication-evaluation.md)
under a verified private parent, with retained incomplete results and explicit
platform durability limits. Its bounded Linux/MSVC evaluation passed in PR #15;
Windows entry durability and writer cutover remain open. D-255's
[real CLI and desktop caller admission](rust-task-admission-evaluation.md) passed
its bounded Linux/MSVC corpus in PR #16 without changing production callers or
monetary policy. D-256 separately prevents a Unix request FIFO from blocking the
existing Operator CLI before its regular-file refusal; this keeps TypeScript as
the production writer.

D-257 adds [Windows creator-token admission](rust-writer-admission-policy.md)
before native mkdir and separates unadjusted process evidence from deliberately
adjusted test fixtures. Its target, monetary and rollback proposal describes a
future caller cutover; this increment keeps all production callers on TypeScript.

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
node --import tsx scripts/test-rust-inspection-contract.mts
cargo clippy --manifest-path rust/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
npm run test:rust-engine
node --import tsx scripts/test-rust-tiny-budget.mts
# Optional local launch comparison with a bundled JavaScript CLI:
npm run test:rust-engine -- --bundled-baseline
```

The inter-file driver generates synthetic v1 directories through the TypeScript
writer, checks both coherent starting states with the TypeScript readers, and runs
one explicitly selected native test. Normal `cargo test` leaves that fixture-backed
test ignored; the driver and Linux/MSVC CI step must execute it separately. Its HTTP
stub accepts exactly the expected job and receipt GETs; it does not access a live
service. `cargo` must be on the configured path, or set `KERYX_TEST_CARGO` to its
executable. `KERYX_TEST_RUST_TOOLCHAIN` optionally selects a rustup toolchain.

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
