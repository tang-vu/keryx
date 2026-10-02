# Operator desktop alpha (Windows)

Research Monthly purchasing/redemption uses the [shared web/API pilot](research-monthly.md).
The desktop remains a local task/inspection/recovery surface; it does not create
another entitlement writer or schedule recurring research. This release changes
no desktop installer artifact or source pin.

The Windows desktop uses a Tauri 2/WebView2 shell under
[D-260](../DECISIONS.md). The shell bundles a pinned Node runtime and a bounded
stdio helper using the existing TypeScript WorkspaceStore for inspection, private
exports and GET-only recovery. The desktop and `npm run operator` use the same
source-pinned Rust implementation for immutable task and workspace creation.
This is a shell and visual change, not a migration of payment or result authority
to Rust. Release acceptance requires hosted standard-user installer and
fresh-runner checks.
It creates and lists private task directories, including
tasks created by the CLI. It saves a research question, Quick/Deep mode, pinned seller
payee, creator budget, and total cap on Arc testnet. Creation does not buy research.

For development on Windows x64, install Node 24, root dependencies, a Windows SDK,
Microsoft C++ Build Tools, the MSVC Rust toolchain and the WebView2 runtime. Then:

```powershell
npm run desktop:install
npm run desktop:start
```

`desktop:install` installs desktop Tauri and build dependencies in `desktop/`.
Start and package commands build the native writer from the exact checkout and
bundle the UI, helper and runtime. Commit source changes before a release build;
a dirty checkout is refused rather than labelled as a different commit. To build
the Windows package and verify its staged output:

```powershell
npm run desktop:package
```

Keep the whole generated package together, including the bundled TypeScript helper,
Node runtime, native engine and manifest. The installed app does not require a
separate Node installation, but does require WebView2. This alpha has no auto-updater.
The generated `release/` and Tauri build directories are ignored by Git.

A same-machine, three-launch pre-release comparison used Electron desktop 0.2 and
Tauri source `bd3e80cfb00327f613b2bdd9fef898b6a4a6d754` with WebView2
153.0.4234.48. The portable folder shrank from 386,264,152 to 105,143,561
bytes (72.8%), while mean UI readiness rose from 512 to 1,637 ms. After seven
seconds, summed process-tree working set/private memory was 297.9/213.5 MiB for
Electron and 368.6/239.6 MiB for Tauri. Working-set sums include shared pages,
so they are not unique physical RAM. Portable folder sizes exclude the separately
installed/shared WebView2 runtime and do not measure total system install cost.
This one-machine result does not prove lower
memory use or faster startup. WebView2 browser processes dominate the Tauri tree
sample. Profiling remains separate from the release gates and cannot relax the
desktop's process boundary or change domain authority.

Choose an existing workspace to read its tasks, or create a new private workspace
under an existing folder. New workspaces receive current-user-only permissions at
creation. Existing folder permissions are not changed. Creating new tasks requires
the supported private-parent ACL and creator token; use a normal user session if
an elevated session is refused. Tasks, buyer journals,
answers, and exports may contain private questions or bearer job identifiers. The
desktop app never asks for a key. The only purchase handoff is a PowerShell command
shown in a task's detail view. Run it deliberately **from the Keryx repository**, with
the existing buyer CLI and its documented key environment. Independently verify the
pinned payee and total cap before buying. Keep the original journal after an uncertain
attempt; do not buy again for recovery.

The app preserves partial or uncertain creation attempts. When the native writer
returns a typed error, it identifies the generated target for inspection. A helper
timeout or lost IPC acknowledgement may leave that random target unknown; preserve
the chosen parent or selected workspace and inspect recent directories before any
new creation attempt. The app never retries with a different writer. On Windows,
successful creation establishes visible, flushed and verified files but does not prove
directory-entry persistence after power loss. A missing or modified native engine
blocks new creation; reopening old tasks and saved results remains available.
See [native task creation](./native-task-creation.md) for the complete boundary.

Once a buyer journal exists, **Check original job** uses the shared GET-only Operator
recovery path. A completed verified check saves a bounded private result in the task
folder. The desktop can reopen its plain-text answer and cited source names offline
after relaunch, rechecking the original task/journal and archived receipt. It can
export a private Markdown brief through a native save dialog. The answer may itself
contain sensitive material; review the brief before sharing. A later incomplete check
keeps the earlier saved result and labels it as previous. A local save failure shows
the current answer temporarily and preserves the original buyer receipt.

The saved local observation may be out of date; task status and JSON export continue
to say payment and delivery are unknown. Offline rechecking verifies local integrity
and request binding, not the historical HTTPS channel, independent settlement, or
factual correctness. Seller-reported payment evidence is labelled separately. Both
private brief and JSON export use the same complete-file publisher as the CLI brief
command. They write and sync a private sibling staging file, then publish the complete
file without overwriting an existing destination. A filesystem without hard-link
support refuses the export. Select a trusted private output folder; Windows exports
inherit its ACL, and the app does not audit that ACL.

Canceling the save dialog creates no export. A write, sync or close failure does not
publish this attempt. If the hard-link publication step returns an error, its outcome
is unconfirmed: inspect the named final path before retrying. A cleanup failure after publication
leaves the complete final file in place and reports an error. The app identifies any
staging file requiring inspection and never deletes the final path as rollback.
These guarantees cover complete-file publication, not directory-entry durability
after a crash or a hostile process replacing the output parent.

**Import file** accepts a local UTF-8 text or Markdown file up to 256 KiB through a
native picker. The workspace keeps immutable raw bytes and a SHA-256 digest with the
source filename and import time. These reference snapshots stay local and are not yet
used to generate answers. They are not uploaded by the desktop app.

This alpha does not schedule jobs, notify, approve spending, create or fund wallets,
sign purchases, or provide a business obligation ledger. It has no mainnet mode. The
web server and its existing buyer/payment authority are unchanged.

Validation commands: `npm --prefix desktop test`, `npm --prefix desktop run typecheck`,
`node desktop/scripts/test-ui.mjs`, and `npm run desktop:build`. The isolated UI test
uses a fake DesktopAPI to check layout, visible keyboard focus, and overflow at
1240×850 and 760×600; it does not prove packaged IPC or native dialogs. Tauri
package smoke uses temporary workspaces and native-dialog stubs and does not load
`.env.local` or `.env.buyer.local`.
The standard-user installer check compares every bundled resource byte for byte.
Tauri patches the installed executable's single bundle marker from `UNK` to `NSS`
and restores the portable executable after bundling; the identity check allows only
those three marker bytes to differ across the two executables.

For the complete-file publisher and packaged Windows app, run from the repository:

```powershell
npx vitest run lib/operator/private-text-export.test.ts
npm run desktop:package
node --import tsx desktop/scripts/tauri-smoke.mjs desktop/release/KeryxOperator-win32-x64/KeryxOperator.exe
```

The Windows desktop CI workflow must run dependency installation, publisher and
desktop tests, type checking, package verification and the Tauri smoke command.
Synthetic tests should cover both export formats, cancellation, overwrite refusal,
offline reopening and saved-result recovery. The fresh-runner package handoff,
MSVC/WebView2 checks, independent review and CI are separate release gates. A
development-host UI screenshot is not a packaged or clean-machine acceptance claim.
