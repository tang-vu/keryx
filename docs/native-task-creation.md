# Native task creation for Operator

The D-259 release integrated immutable v1 task creation into the Operator CLI and
the then-current Electron desktop. Both callers used one Rust
preparation/publication implementation. Task inspection, saved results, exports
and GET-only buyer recovery remained TypeScript operations. Creating a task does
not sign, buy, load a wallet or contact a server. D-260 stages a Tauri shell with
the same creation authority and a packaged TypeScript helper; its separate
desktop release gates are in [desktop alpha](./desktop-alpha.md).

The D-259 acceptance required the integrated CLI, packaged Electron, Linux and
Windows checks below. This document records that domain contract; it does not
establish acceptance of the Tauri shell or any payment migration.

## New workspace and task admission

Create a new workspace through the desktop or the Operator workspace command.
The native engine exclusively creates a new private directory; it never changes
the permissions of an existing directory. Existing workspaces remain available
for inspection. Creating a task there additionally requires the native private
parent checks. An unsupported parent is refused with guidance to create a new
private workspace and keep the original files.

Task targets are new children under existing private parents. Their names contain
one to 64 ASCII letters, digits, hyphens or underscores and cannot be Windows
reserved device names. Parent links, collisions, missing ancestors and unsupported
permissions are refused. Relative CLI task paths are resolved before invocation.
The publisher retains a validated parent handle and checks created object
identity and permissions before exposing task content.

On Windows, the supported private parent has the current user as owner and a
protected, inheritable current-user-only full-access DACL. New workspace security
must be applied at creation, not by repairing a broadly accessible directory
afterward. Windows documents creation-time security descriptors and handle-relative
names in [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile).
The engine does not elevate, adjust token ownership, revert impersonation or enable
privileges. Unsupported creator tokens refuse before mkdir. Use a normal user
session when an elevated token has an incompatible default owner.

For new tasks the creator budget must be finite, positive, at most 0.5 testnet
USDC, and round to at least one micro-USDC. The total cap is an integer number of
micro-USDC, strictly greater than the rounded creator budget and no greater than
1,000,000. Old v1 tasks retain their existing reading and recovery policy, including
historical positive budgets that round to zero. The new writer never rewrites an
old task to make it pass new admission rules.

## Completion and interrupted creation

| Result | Meaning and action |
| --- | --- |
| `unix_synced` | The verified files and directory entries were synced. This still assumes a trusted filesystem and storage stack. |
| `windows_visible_entry_unproven` | The files were written, flushed and verified. Directory-entry persistence after power loss is not established. |
| `refused_unchanged` | This attempt made no filesystem change. An existing collision target may still be present; preserve it. |
| `retained_partial` | The attempt created a directory and did not complete. Preserve it for inspection; there is no automatic repair or deletion. |
| `complete_unconfirmed` | Completion could not be established. Inspect the original target before deciding what to do next. |

A timeout, cancellation, malformed response or lost process acknowledgement after
a write can be uncertain even when files exist. The caller never retries creation
through TypeScript, deletes the target, or treats a new name as recovery. An
unconfirmed child exit disables that transport instance. Payment and delivery stay
unknown: none of these local publication states is settlement evidence.

The release explicitly accepts Windows visible-file completion for local task
creation with the stated power-loss limitation. It does not claim stronger
durability from process-kill tests or change the separate payment journal rules.

## Native process and artifact boundary

The existing `protocol` command keeps `keryx-readonly-cli-v1` unchanged. A separate
`writer-protocol` handshake identifies `keryx-task-writer-cli-v1`. The writer exposes
only `create` and `workspace-create`, with bounded JSON stdin and strict versioned
JSON outcomes. Evaluation fault and token-adjustment flags are absent from the
packaged executable.

The TypeScript adapter pins an absolute binary and trusted manifest, independently
expected source commit, platform, architecture, size and SHA-256. The executable
comes from a clean checkout build. Desktop packaging embeds the expected commit
independently of the manifest; renderer IPC cannot choose an executable. CLI
artifact selection likewise does not trust a manifest to choose its own expected
source identity. A manifest is integrity metadata, not a signature or an
authentication system for untrusted downloads.

Direct subprocesses run without a shell or wallet environment; the writer exposes
no network operation. Input, output, elapsed time, cancellation and child termination are
bounded. The read-only transport is not widened to grant write authority. Missing,
stale or modified artifacts refuse new creation; offline TypeScript inspection
continues to work without the native executable.

## Release checks and rollback

Acceptance requires real CLI and packaged desktop creation, exact v1 bytes and
reopening, legacy mixed-workspace discovery, collision preservation, malformed and
over-limit input refusal, interrupted/uncertain outcomes, and no automatic fallback.
Run the Rust publication corpus plus the adapter and caller checks on Linux and
Windows MSVC. Exercise a supported unadjusted Windows user token separately from
an incompatible token; test fixtures must not add owner mutation to production.

Transfer the exact packaged Windows artifact to a fresh runner and exercise its
IPC, native verification and offline reopening without compiling Rust there.
Record this as fresh-runner package acceptance. It does not establish a signed
installer, auto-update system, every consumer Windows edition or a Tauri migration.
Independent review and required PR CI precede merge and release.

The prior TypeScript source is pinned at
[`4ee6cf82930e67c83bf66bf000486eccf48f94f9`](https://github.com/tang-vu/keryx/tree/4ee6cf82930e67c83bf66bf000486eccf48f94f9).
Retain that release and v1 readers for at least two
accepted release cycles and 14 calendar days of recorded supported-host use after
cutover. This observation window starts at release; elapsed time alone does not
close it. Keep native creation outcomes and an actual rollback drill as evidence.
During rollback, stop new creation, preserve task directories and inspect them
using the previous release. Never reuse a partial target or repeat a purchase.
Historical TypeScript fixture writers are test oracles, not a runtime fallback.

Tauri, payment authority, scheduling, approvals and web/MCP runtime migration are
outside this immutable-task domain release. See the
[shared engine migration plan](./rust-engine-migration.md) for those separate gates.
