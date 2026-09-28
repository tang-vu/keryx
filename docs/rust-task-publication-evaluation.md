# Immutable v1 task publication evaluation

This evaluates native filesystem publication after the accepted
[pure preparation stage](rust-task-preparation-evaluation.md). Local Windows GNU
validation passed; hosted Linux and Windows MSVC acceptance remains required.
Production task creation remains TypeScript;
the packaged `keryx-engine` CLI retains protocol/status/result/brief. The test-only
publication adapter cannot buy, sign, fund, create a buyer journal or resume work.

## Trust and filesystem ownership

Preparation validates the request, payee syntax, cap and injected identity/time
before publication. A caller must independently verify the intended payee and
select the private target; successful local publication authorizes no payment.
The platform adapter receives the immutable prepared pair and a held directory
capability for that explicitly selected private parent. It resolves a single
allowed child component relative to the handle, avoiding a fresh ambient path
lookup for each operation. Candidate name/path restrictions may be stronger than
TypeScript's lexical path handling and must be reported as explicit refusals.

For this candidate, select an absolute parent without parent traversal. The child
name is one to 64 ASCII letters, digits, hyphens or underscores; Windows reserved
device names are refused case-insensitively on every host. Relative and
drive-relative parents, Unicode child names, separators, alternate data stream
syntax, spaces and trailing dots are outside this narrow name contract. Unicode
in the selected parent path and in task content remains covered separately.

Validate ownership and restrictive permissions, including inheritable Windows
access-control entries, before writing private content. Do not infer privacy from
directory creation or the current username alone. Reuse the existing componentwise
no-follow traversal and reject links/reparse points. Verify the created child and
files themselves, retain their handles, and detect observed identity changes.
Never modify an existing parent's ACL or mode as a side effect of publication.

The selected Windows fixture policy uses a protected, inheritable DACL granting
only the current user access. Other ACL shapes are explicit candidate refusals,
even when a wider policy might independently establish privacy. Tests configure
only a newly owned synthetic parent using the documented
[whoami user-SID query](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/whoami)
and [icacls grant/inheritance controls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls).
The publisher itself must validate the resulting handle security.

Windows assigns new objects the creator token's default owner, which can be
Administrators on an elevated hosted runner. Granting the current user access or
setting only the selected parent's owner does not determine child/file ownership.
The synthetic fixtures explicitly set their own parent owner. Native test processes
and the feature-only evaluator also select their own token user as their process's
default owner, verify it by reading the token back, and fail if adjustment is denied.
This changes only those disposable test processes, not machine policy or an existing
user directory. The normal publisher performs no token adjustment and still refuses
unsupported owners. Production elevated-token admission remains an open gate.
See [Windows object ownership](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object),
[token access rights](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-rights-for-access-token-objects)
and [SetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-settokeninformation).

This assumes a trusted kernel, storage stack and selected parent location whose
owner is cooperating. Parent permissions do not audit every ancestor's security.
A hostile same-user process or administrator can change ACLs or files;
handle checks are not a sandbox against those principals. A successful observation
also cannot authenticate an earlier seller or prove settlement.

## Publication and incomplete outcomes

Create the selected child directory exclusively, then `request.json` and
`task.json` exclusively and in that order. Use the already bounded exact v1 bytes.
Check writes, file sync and close errors individually. On Unix the new directory
and files must have private owner permissions and the relevant directory entries
must also be synced. Reopen through held capabilities to verify the files and
their identities before reporting the completed observation.

Before creation, refusal leaves existing data unchanged; it must not claim that
the target is absent. After creation, preserve the directory and every partial
file for inspection. Distinguish a retained partial result from one whose bytes
are complete but whose publication or durability is unconfirmed. Never delete,
overwrite or complete an existing target automatically, even after a restart.
Disabling the writer and inspecting the original v1 data with TypeScript is the
rollback path. Incomplete data may correctly be unreadable; preserve it and report
that state rather than claiming recovery succeeded.

## Platform guarantees and limits

Rust's ordinary file drop does not expose close errors, so the writer needs a
small checked-close wrapper in addition to `sync_all`. On Linux, close errors must
be reported without retrying a potentially reused descriptor. File sync does not
sync its parent directory entry. These requirements follow the
[Rust File contract](https://doc.rust-lang.org/std/fs/struct.File.html),
[Linux close semantics](https://man7.org/linux/man-pages/man2/close.2.html) and
[Linux fsync semantics](https://man7.org/linux/man-pages/man2/fsync.2.html).

On Windows, inspect security through the held handle and check `CloseHandle`.
The default inheritance of a parent DACL is not proof that a newly created
directory is private. See [file security](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights),
[GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)
and [CloseHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle).

Microsoft documents [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)
for file and volume flushing; flushing a volume requires administrator privileges.
Its [directory-handle documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory)
does not establish the unprivileged directory-entry persistence guarantee needed
here. Our inference is limited: this candidate can verify visible file contents
and file flush/close, while directory-entry durability remains unproven. Report
that Windows outcome explicitly. This is neither proof that Windows can never
provide stronger persistence nor permission to elevate or flush a volume.

Directory-relative operations and no-follow opening use the pinned
[cap-std Dir API](https://docs.rs/cap-std/4.0.3/cap_std/fs/struct.Dir.html) and
[cap-fs-ext DirExt](https://docs.rs/cap-fs-ext/4.0.3/cap_fs_ext/trait.DirExt.html).
Do not replace the held capability with an unchecked path between operations.

## Acceptance gates

Run native tests and actual-process drills on Linux and Windows MSVC, plus the
available local Windows GNU rehearsal. Use only owned synthetic private parents;
tests may configure those fixtures' ACLs, never an existing user directory.
Compare native-created file bytes against the actual TypeScript writer with the
same UUID/time, then reopen the unchanged v1 files with TypeScript and the existing
read-only native CLI. Keep ready status separate from unknown payment/delivery
and from the platform's publication durability observation.

Cover input admission without writes, existing file/directory targets, unsafe
components, parent/link/reparse boundaries, private permissions, concurrent
creators with exactly one winner, and observed directory replacement. Test builds
write a real prefix before an injected partial-write failure and inject failures
at pre-sync and post-close barriers. Those barriers exercise outcome reporting;
they do not induce a kernel-returned fsync or close error. Review the actual OS
error propagation separately, including the no-retry close rule. Kill a separate
helper process at publication barriers and inspect its retained files from a fresh process. Restart
must not overwrite or repair the original target. Fault switches must not appear
in the packaged CLI or normal production callers.

Tree and file hashes must prove refusal and rollback leave existing records
unchanged. State which platform cases actually ran and which lacked privileges;
do not turn a skipped link test into a pass. Process termination exercises live-OS
crash handling, not power-loss persistence. Windows entry durability, production
target selection, buyer quote/create/recovery policy, caller migration and the
rollback window remain separate gates after this bounded evaluation.

## Recorded local evidence and reproduction

The frozen candidate passed 32 core tests (two fixture/stress tests intentionally
ignored by the ordinary command), 13 CLI tests and all seven focused publication
tests on Windows GNU. Formatting, feature-enabled Clippy with warnings denied,
TypeScript checking and scoped ESLint passed. The release bridge and read-only CLI
were rebuilt from that same source before the final differential run.

The actual-process driver passed two native successes, 30 typed refusals, one
exactly-one-winner concurrency drill, 18 read-only reopens, two link refusals,
15 ACL observations, three killed-and-reaped process checkpoints and three typed
fault-state checks. Successful Windows publication reported
`windows_visible_entry_unproven`. The selected parent included Vietnamese text,
emoji, spaces and parentheses; child names retained the narrow ASCII policy.

Local Windows held-parent and held-child replacement attempts were refused by
the OS with sharing error 32. Identical-byte file replacement was exercised and
detected. Native directory-symlink creation lacked privilege (error 1314), while
the driver exercised junction boundaries. These are distinct observations;
the hosted Linux corpus must perform its intended directory swaps, and hosted
MSVC remains a separate platform gate. Injected sync/close barriers and process
kills do not establish kernel fault coverage or power-loss durability.

With repository Node dependencies and the platform Rust toolchain installed:

```sh
cargo test --manifest-path rust/Cargo.toml --locked
cargo test --manifest-path rust/Cargo.toml -p keryx-core --features publication-evaluation --locked publication::tests -- --show-output
cargo clippy --manifest-path rust/Cargo.toml --all-targets --features publication-evaluation --locked -- -D warnings
cargo build --manifest-path rust/Cargo.toml -p keryx-engine --release --locked
cargo build --manifest-path rust/Cargo.toml -p keryx-core --example publish-task-v1 --features publication-evaluation --release --locked
node --import tsx scripts/test-rust-task-publication.mts
```

The `publication-evaluation` feature exposes the bounded test bridge and fault
hooks. It is not enabled for the packaged read-only CLI or its transferred native
artifact. The Rust workflow runs the publication corpus and actual-process driver
on Linux and Windows MSVC alongside the existing read-only acceptance gates.
