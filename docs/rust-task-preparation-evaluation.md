# Immutable v1 task preparation evaluation

This is the pure-core stage of the [selected next domain](rust-engine-migration.md#next-domain-candidate-local-task-creation).
It evaluates validation and encoding before native filesystem publication. The
TypeScript `createOperatorTask` remains the production owner; the read-only native
CLI still exposes only protocol, status, result and brief. This stage cannot create
a task directory, sign, fund, buy, resume, or change a persisted format.

## Inputs and authority

The preparation core receives an untrusted request value, a payee string, a total
cap already expressed as an integer micro-USDC string, and explicit task UUID and
creation timestamp. The caller must independently verify the intended payee and
select the cap. Address syntax alone does not verify a seller or grant permission
to pay it. Identity and time are injected so tests can reproduce existing v1 data;
the core neither generates an identifier nor consults a clock.

Decimal CLI argument parsing stays with a future caller adapter. The core has no
directory, filesystem handle, environment, network client, wallet or signing
capability. Preparing values conveys no payment or execution authorization.

## Validation and byte contract

Reuse the v1 Rust request and task validation, with the TypeScript writer as the
transition oracle. Preserve strict fields, JavaScript whitespace trimming and
UTF-16 question length, request field order, payee spelling, atomic cap spelling,
UUID/date grammar and the original accepted budget number. The cap must exceed
the rounded creator budget and cannot exceed one testnet USDC. This is the current
local Operator contract, not a mainnet limit or an on-chain policy.

The shared request validator must also check the raw budget against `0.5` before
rounding. The old reader accepted `0.500000000000001` with a `500001` cap because
its rounded budget was 500000; the TypeScript writer and reader refuse that raw
number. Rejecting it corrects candidate over-admission without changing TypeScript.
The intentional `1e-15` candidate refusal remains distinct: TypeScript can read or
write that positive value, while it rounds to zero micro-USDC in the candidate.
Keep the original files and TypeScript read/export path. A future production writer
needs its own admission decision and buyer quote/create/recovery boundary tests.

Prepared `request.json` and `task.json` bytes must equal Node's
`JSON.stringify(value, null, 2) + "\n"`: two spaces, schema declaration order,
JavaScript number spelling, lossless escaped lone surrogates and a terminal LF.
There is no budget normalization or source-record rewrite. Each complete encoded
file must be at most 8,192 UTF-8 bytes; reject before returning a publishable pair
if either exceeds the limit. The returned identity and read-only byte accessors
describe the same normalized request and supplied identity; callers cannot mutate
the prepared object's private fields.

## Acceptance contract

Use the real TypeScript `createOperatorTask` to obtain accepted request/task bytes
and generated UUID/time. Supply those identity values and the original request
to the Rust core, then compare both encoded files byte for byte. Cover quick/deep
requests, strict fields, caps and payees, raw numeric boundaries, trimming,
UTF-16 length, astral and lone-surrogate text, escapes and encoded size boundaries.
Count the documented tiny-positive refusal separately from parity.

A bounded test-only Rust example bridges stdin/stdout for this corpus. It is not
a production command and accepts no output path. The packaged `keryx-engine`
protocol and command set remain unchanged. Only the test harness materializes
prepared bytes in its own synthetic directories, then checks the production
TypeScript reader in fresh guarded processes. Status must remain ready with
unknown payment and delivery. Restart and disabling the candidate must leave the
same files readable by TypeScript, with original tree hashes unchanged.

The raw budget regression must also run against the actual read-only CLI and the
TypeScript oracle, requiring refusal without success output, brief publication or
source mutation. Native tests, formatting, Clippy and the differential corpus must
run on both Linux and Windows MSVC before recording this stage as accepted.

## Reproduce the evaluation

Use the pinned Rust toolchain and repository Node dependencies described in the
[migration guide](rust-engine-migration.md#reproduce-locally):

```text
cargo test --manifest-path rust/Cargo.toml --locked
cargo clippy --manifest-path rust/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
cargo build --manifest-path rust/Cargo.toml -p keryx-core --example prepare-task-v1 --release --locked
node --import tsx scripts/test-rust-task-preparation.mts
```

The example accepts at most 16 KiB of UTF-8 JSON on stdin with exactly `request`,
`payee`, `maxTotalMicros`, `id` and `createdAt`. Its stdout contains `taskId`,
`requestJson` and `taskJson`; it has no output-path argument. The example is built
only for the corpus and is excluded from the two-file read-only artifact package.
`KERYX_RUST_PREPARE_EXAMPLE` and `KERYX_RUST_ENGINE` optionally select absolute
test executable paths. Generated synthetic files stay outside Git.

The local Windows GNU run passed 15 exact two-file byte comparisons, 22 paired
TypeScript/Rust refusals, one separately identified tiny-positive candidate
refusal, two invalid injected identity/time cases, five bridge-format refusals,
four guarded TypeScript reopenings and three historical raw-budget read-command
refusals, plus the offline guard self-check. Encoded task files at 8,191 and 8,192
bytes passed; 8,193 bytes failed. Request-file boundary cases are refusals because
the enclosing task exceeds its limit first; they are not successful maximum-size
pairs. Twenty-five core and 13 CLI tests, formatting, Clippy, release builds,
TypeScript and scoped ESLint passed. The existing 232 strict read-only comparisons
and the separate tiny-budget fallback drill also passed. Hosted Linux/MSVC results
are required separately before closing this stage.

## Remaining task-creation gates

This stage supplies no native filesystem writer. The next isolated adapter must
own a deliberately selected private target, exclusive directory/file creation,
bounded encoding, permissions, durable writes and explicit incomplete outcomes.
Retain partial creation for inspection, matching the TypeScript policy; never
delete the target automatically or rewrite files as recovery.

Its own corpus must cover concurrent creation, existing targets, parent and link
boundaries, Windows inherited permissions and Unix modes, injected write/sync/close
and crash failures, restart, and no writes on admission refusal. Stronger candidate
path refusals must be listed explicitly instead of being called universal parity.
Test-harness publication in this stage does not establish any of those properties.
Production writer ownership, a documented rollback window and retirement of the
transitional duplicate rules require separate review. Buyer journals, execution,
signing, settlement and recovery remain outside this domain.
