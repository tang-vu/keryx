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
private brief and JSON export refuse to overwrite an existing file.

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
