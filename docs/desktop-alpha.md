# Operator desktop alpha (Windows)

The Electron desktop app and `npm run operator` use the same Rust implementation
for immutable task creation. The packaged desktop includes the verified native
engine; TypeScript continues to provide inspection, exports and GET-only recovery.
It creates and lists private task directories, including
tasks created by the CLI. It saves a research question, Quick/Deep mode, pinned seller
payee, creator budget, and total cap on Arc testnet. Creation does not buy research.

From a clean Windows x64 checkout with Node 24, root dependencies, and a supported
Rust toolchain/linker installed (MSVC or GNU):

```powershell
npm run desktop:install
npm run desktop:start
```

`desktop:install` installs Electron only in `desktop/`. It is separate from the web
server's root dependency set. Start and package commands build the native writer
from the exact checkout before bundling it. Commit source changes before a release
build; a dirty checkout is refused rather than labelled as a different commit.
To build a local unpacked Windows x64 app:

```powershell
npm run desktop:package
& .\desktop\release\KeryxOperator-win32-x64\KeryxOperator.exe
```

Keep the whole generated folder together, including the bundled native engine and
manifest. Running the package requires neither Cargo nor a separate Node install.
This is an unsigned local build without an updater or installer. The `release/`
directory is ignored by Git.

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

The app preserves partial or uncertain creation attempts and identifies the target
for inspection. It never retries with a different writer. On Windows, successful
creation establishes visible, flushed and verified files but does not prove
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
`npm run desktop:build`. The Electron smoke harness in `desktop/scripts/smoke.mjs`
uses temporary workspaces and native-dialog stubs; it never loads `.env.local` or
`.env.buyer.local`.

For the complete-file publisher and packaged Windows app, run from the repository:

```powershell
npx vitest run lib/operator/private-text-export.test.ts
npm run desktop:package
node --import tsx desktop/scripts/smoke.mjs desktop/release/KeryxOperator-win32-x64/KeryxOperator.exe
```

The Windows desktop CI workflow runs dependency installation, publisher and desktop
tests, type checking, packaging and this smoke command. The smoke app stays hidden
unless an explicit screenshot path is supplied. It checks both export formats,
cancellation, overwrite refusal without a success notice, offline reopening and
saved-result recovery using synthetic data. Running the unpacked app on a development
or CI host is not a clean-machine, signed-installer or auto-update acceptance claim.
