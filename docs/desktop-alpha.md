# Operator desktop alpha (Windows)

The Electron desktop app is a local interface to the same `lib/operator/task.ts` engine
used by `npm run operator`. It creates and lists private task directories, including
tasks created by the CLI. It saves a research question, Quick/Deep mode, pinned seller
payee, creator budget, and total cap on Arc testnet. Creation does not buy research.

From a Windows checkout with Node 24 and root dependencies installed:

```powershell
npm run desktop:install
npm run desktop:start
```

`desktop:install` installs Electron only in `desktop/`. It is separate from the web
server's root dependency set. To build a local unpacked Windows x64 app:

```powershell
npm run desktop:package
& .\desktop\release\KeryxOperator-win32-x64\KeryxOperator.exe
```

Keep the whole generated folder together. This is an unsigned local build without an
updater or installer. The `release/` directory is ignored by Git.

Choose an existing private workspace folder or create a new workspace in a private
parent. On Windows, workspace files inherit the parent's ACL. Tasks, buyer journals,
answers, and exports may contain private questions or bearer job identifiers. The
desktop app never asks for a key. The only purchase handoff is a PowerShell command
shown in a task's detail view. Run it deliberately **from the Keryx repository**, with
the existing buyer CLI and its documented key environment. Independently verify the
pinned payee and total cap before buying. Keep the original journal after an uncertain
attempt; do not buy again for recovery.

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
