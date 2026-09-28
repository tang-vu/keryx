# Task caller admission evaluation

This bounded evaluation follows the accepted [pure preparation](rust-task-preparation-evaluation.md)
and [private publication](rust-task-publication-evaluation.md) corpora. Its Linux
and Windows MSVC acceptance passed in PR #16. It tests inputs from the actual Operator CLI and
desktop workspace implementation before any production writer migration.
TypeScript remains the writer, reader and payment authority.

## Real callers as the oracle

Run the existing CLI `create` command and `WorkspaceStore.createTask` against owned
synthetic workspaces. Read the request/task bytes they actually persist and obtain
their UUID and creation time from those records. Supply the persisted fields and
identity to the existing pure Rust preparation bridge and require byte-for-byte
agreement with both files. Do not reproduce Zod, decimal parsing, UUID generation
or budget rules in a second test-side implementation.

The caller boundaries differ:

| Caller | Existing input and target behavior | What the evaluation must distinguish |
| --- | --- | --- |
| Operator CLI | Reads a bounded UTF-8 request file, validates payee syntax and decimal total cap, and resolves the selected `--state` path. | Actual CLI parsing/refusals versus native input policy after caller normalization. A relative CLI path can become an absolute native parent. |
| Desktop workspace | Parses decimal form values, binds a selected workspace identity and creates a generated task child. | Actual form/workspace refusal versus the native parent's stronger owner/permission requirements. Workspace selection alone is not an ACL audit. |
| Native candidate | Takes prepared v1 input and an absolute private parent with a narrow safe child name. | Candidate-only monetary, parent, link, permission or name refusals, without implying all TypeScript inputs are supported. |

Payee validation here checks syntax and the supplied value. It does not independently
verify a seller's identity, endpoint, registry authority or payment destination.
The synthetic corpus makes no network calls and authorizes no purchase.

## No-write candidate checkpoint

For an eligible caller-created task, choose a separate sibling name and first
assert that it is absent. Invoke the feature-only publication evaluator with
`--fail-at before-mkdir`. Require empty success output and the exact structured
injected failure at stage `before-mkdir`, with state `refused_unchanged`. The child
must remain absent and the original directory tree digest must remain unchanged.

This deliberate test failure proves that preparation and current parent/child
validation reached that checkpoint without publishing. The hook runs before the
exclusive mkdir and its collision check. It neither reserves the name nor proves
that a later operation will find it absent, retain permission or publish successfully.
Do not describe it as a successful native create or a durable transaction.

Use owned synthetic links and broad-permission parents to establish explicit
candidate refusals. Hash the original task files before and after every refusal
and read-only reopening. Subprocesses require bounded lifetimes and confirmed
termination; no injected switches enter the packaged native CLI or production callers.

## Preserve legacy admission and recovery

The existing TypeScript request schema can accept a tiny positive budget such as
`1e-15` that rounds to zero micro-USDC. The CLI request-file path can therefore
create such a legacy task; the desktop's decimal form parser rejects that literal.
Rust preparation retains its documented positive-integer-micro refusal. Count these
as distinct caller and candidate observations, not shared acceptance or a newly
enforced monetary rule.

This slice does not tighten the shared reader schema, change TypeScript creation,
alter buyer quote/buy/resume behavior or rewrite a saved request. Existing tasks
must remain inspectable through the original TypeScript path in fresh guarded
processes, without signing, network access or repurchase. Invalid or corrupted
records may still be refused; rollback is not automatic repair.

## Acceptance and remaining decisions

Require actual CLI and desktop success/refusal matrices, exact preparation bytes,
explicitly classified candidate-only differences, no-write tree evidence and
fresh legacy reopening on Linux and Windows MSVC. Run the original publication
driver again if shared synthetic fixture setup is extracted, so its ACL, concurrency,
fault and crash evidence is preserved. Keep local Windows GNU observations separate
from hosted acceptance.

Only after this evidence is reviewed can a later proposal decide production target
selection, supported Windows owner/ACL shapes, elevated-token handling and how to
present the unproven Windows directory-entry durability. New-task monetary admission
must be decided separately from legacy reading and existing buyer recovery. A
production migration still needs one named writer, an explicit rollback window and
criteria for retiring duplicate domain rules. This test-only corpus changes none
of those owners and adds no production command.

## Reproduce locally

Use repository Node dependencies and the pinned platform Rust toolchain:

```sh
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
cargo build --manifest-path rust/Cargo.toml -p keryx-core --example prepare-task-v1 --release --locked
cargo build --manifest-path rust/Cargo.toml -p keryx-core --example publish-task-v1 --features publication-evaluation --release --locked
node --import tsx scripts/test-rust-task-admission.mts
node --import tsx scripts/test-rust-task-publication.mts
```

Both drivers use only their own synthetic temporary directories. The publication
feature remains test-only, and its Windows process-owner adjustment applies only
to that disposable evaluator process. It does not prepare a user's real workspace
or establish production admission.

## Local observations

The local Windows GNU rehearsal passed three exact persisted-byte comparisons,
three injected no-write checkpoints, five separately classified candidate-only
refusals, eight actual caller refusals and two guarded legacy restarts. Successful
cases covered a real relative CLI target resolved to its absolute parent, the
half-USDC creator-budget boundary and a desktop deep-research request with Unicode.
The owned Windows junction case demonstrated CLI creation through a linked parent
followed by native parent refusal.

After extracting the shared synthetic fixture helpers, the original publication
driver retained its Windows counts: two successes, 30 refusals, one concurrency
drill, 18 reopens, two link refusals, 15 permission observations, three killed/reaped
checkpoints and three typed fault-state checks. TypeScript checking, scoped ESLint
and whitespace validation passed. These local observations are distinct from the
hosted acceptance below.

## Hosted acceptance

[PR #16](https://github.com/tang-vu/keryx/pull/16), exact head
`24832b82880524ca71b3431ab6f0193000a0c5b2`, passed independent automated review,
[application CI](https://github.com/tang-vu/keryx/actions/runs/36488896331),
[Linux and Windows MSVC Rust CI](https://github.com/tang-vu/keryx/actions/runs/36488896558)
and the security check. Both platforms passed all three byte comparisons, three
no-write checkpoints, five candidate-only refusals, eight caller refusals and two
guarded legacy restarts.

The original publication driver retained two successes, one concurrency drill,
18 reopens, two link refusals, three crash checkpoints and three typed fault checks
on each platform. Linux recorded 27 refusals and 13 permission observations;
Windows recorded 30 and 15 respectively. Linux reported `unix_synced`; Windows
still reported `windows_visible_entry_unproven`. Native core/CLI tests passed
(33/13 Linux, 32/13 Windows), as did seven focused publication tests per platform.
The native-artifact workflow did not run for this test-only change under its path
filter; it is not an additional artifact acceptance result.

This closes the stated caller-input evaluation, not production task creation,
payment evidence or the separate admission, durability and cutover decisions above.
