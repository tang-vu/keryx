# Operator task alpha

The [CSL-JSON export candidate](engineering/csl-json-reference-export-2026-10-09.md)
adds `brief --format csl-json` for the original-task-bound, integrity-checked
saved receipt. It uses the same exclusive private file publication path as
BibTeX/RIS. Receipt bytes and payment authority remain unchanged. Desktop0.4.11
adds the JSON save-dialog choice; installer publication and an installed-client
upgrade require separate verification.

The Operator alpha is a local research task handoff on the trusted configured Arc network. It persists
one normalized request, a pinned seller payee, and a per-job total cap. It does not
create a wallet, fund it, sign, submit a purchase, or start a background worker.
The existing buyer CLI remains the only CLI purchase path. Immutable task creation
uses the shared Rust writer; local inspection and buyer recovery remain TypeScript.
See the [native creation contract](./native-task-creation.md) for publication outcomes,
artifact verification and rollback.

For current public production, set BOTH `KERYX_NETWORK=arc` and
`NEXT_PUBLIC_KERYX_NETWORK=arc` before task preparation, buyer handoff and remote
recovery. Mainnet tasks retain `eip155:5042`; legacy v1 tasks remain testnet
originals and must be recovered using their original profile. Unset configuration
retains the local testnet default. Task creation grants no spending authority.
See [current deployment and distribution evidence](mainnet-status.md).

Download `request.json` from [/research](https://keryx.cc/research) as described in
the [buyer guide](./buyer-agent.md). Create a private workspace before creating tasks,
or select an existing parent that passes the native permission checks. A task
directory must be new and use a safe ASCII name. Keep the request, task,
buyer journal, and JSON exports private: the buyer job ID is bearer access to the
result. The commands below do not load `.env.local` or `.env.buyer.local`; only the
deliberate `buyer buy` command loads the buyer key environment if present.

The request must be a regular UTF-8 JSON file of at most 8 KiB. On Unix, a named
pipe is refused without waiting for another process to connect as its writer.
Invalid input is rejected before creating the task directory. New creator budgets
must round to at least one micro-USDC; older task reading keeps its previous rules.
On Windows, use a normal user session and the workspace creation command to obtain
a supported private folder. Existing folder permissions are never changed for you.

```sh
npm run native:build
npm run operator -- workspace --state operator-workspace
npm run operator -- create --request request.json --payee 0xYOUR_VERIFIED_PAYEE --max-total 0.10 --state operator-workspace/task-1
npm run operator -- status --state operator-workspace/task-1
npm run buyer -- buy --request operator-workspace/task-1/request.json --payee 0xYOUR_VERIFIED_PAYEE --max-total 0.10 --state operator-workspace/task-1/buyer
npm run operator -- resume --state operator-workspace/task-1
npm run operator -- export --json --state operator-workspace/task-1
npm run operator -- result --state operator-workspace/task-1
npm run operator -- brief --state operator-workspace/task-1 --file private-brief.md
```

`native:build` needs the supported x64 Rust toolchain and linker on Windows or
Linux. It builds from a clean checkout and stores the binary and manifest in
`.artifacts/native-writer/`; generated artifacts stay outside Git. Rebuild after
changing source revision. `workspace` creates one new directory, so skip that step
when an existing workspace already satisfies the private-parent policy. It never
overwrites or changes the permissions of an existing `operator-workspace` directory.

Confirm the payee independently as described in [buyer-agent.md](./buyer-agent.md).
The `create` output includes the exact buyer arguments for the task. Before spending,
compare them to the pinned payee and cap you intended. `buyer buy` is single-use: if
it times out or exits after creating its journal, do not run `buy` again for recovery.
Run Operator `resume` against the same task. It checks the buyer journal against the
original request, payee, and total cap, then uses the existing GET-only receipt
verification path. A missing/incomplete journal requires inspection; a 404 or lost
acknowledgement leaves payment uncertain.

Creation reports its publication state. Windows completion means visible, flushed,
verified files; directory-entry persistence after power loss remains unproven.
If creation is partial or uncertain, preserve the named directory and inspect it.
There is no automatic deletion, repair, retry or fallback to another writer. A
missing or mismatched native artifact prevents new creation, while `status`,
`result`, `brief` and GET-only recovery can still use the existing TypeScript path.

`status` and `export --json` read local files only. Both keep top-level payment and
delivery `unknown`; after a successful `resume`, they can show a saved, possibly
stale observation with a seller-reported payment state and delivery status. That
snapshot is a diagnostic, not independent settlement proof or portable recovery.
After a completed verified GET recovery, Operator also saves a bounded private
`result.json` bound to the original task, buyer journal, answer, and archived receipt.
`result` reopens that answer offline; `brief --file` writes a private Markdown brief
to a new file and refuses to overwrite an existing one. It writes and syncs a
private sibling staging file before publishing the complete brief through an
exclusive hard link. The output filesystem must support hard links; an unsupported
filesystem is refused without falling back to a partial final-file write. A later incomplete or failed
check leaves the older completed result intact. Offline opening rechecks local bytes
and task binding; it cannot replay the original HTTPS response or independently prove
settlement or answer truth. Keep the buyer journal and receipt files with the task.
If local snapshot saving fails, `resume` still reports the completed remote result
and an actionable local-save warning. Retry GET-only recovery against the same task.
For a shareable redacted report, use `npm run buyer -- report --state
operator-workspace/task-1/buyer` and review it before sharing. JSON stdout is clean with
the direct `node --import tsx scripts/operator.mts ...` form; npm may print its own
headers unless invoked with `--silent`.

An export error identifies whether the final brief was published and any staging
file that could not be removed. Write or sync failures do not publish this attempt.
If the publication call itself fails, the command reports an unconfirmed outcome:
inspect the named final file as well as any leftover staging file. A
cleanup failure after publication leaves the complete final brief intact but emits
no success receipt. Inspect the named files before retrying with a new output path;
do not delete a pre-existing file to make a retry pass. These guarantees assume a
trusted private parent and do not promise directory-entry durability after a crash.

The TypeScript publisher is shared with the desktop's Markdown and status JSON
exports. The desktop selects the destination through its native save dialog and
reports the same publication failure states; it does not maintain a second writer.

The optional [Rust read-only candidate](./rust-engine-migration.md) preserves
JavaScript UTF-16 strings, including unpaired surrogates, through JSON output and
receipt verification. The TypeScript commands above remain authoritative for
existing v1 directories. The candidate also bounds parser nesting and value count;
a resource refusal does not mean an otherwise accepted v1 task is corrupt.
On a candidate refusal, preserve the files and use TypeScript `status`, `result`
or `brief` against the same directory. Do not rewrite receipt text or run another
purchase to make it readable. Both result JSON paths preserve lone code units as
escapes. Markdown brief export replaces them with U+FFFD during UTF-8 encoding,
so keep the original JSON for lossless preservation. This is candidate compatibility
work, not a production engine switch.

For supported inputs, the candidate's `brief --file` returns the same JSON contract
as TypeScript: `{"saved":"ABSOLUTE_PATH","private":true}`. Both resolve the output
path lexically, create a new file, and refuse overwrite. Unix files use mode `0600`;
Windows files inherit the parent ACL. Select a private output parent: parent links
are followed by the export operation, and `private: true` is not an ACL audit.
The candidate anchors input reads to opened directories and refuses observed file
changes. Retry after local writes finish if inspection fails. This is not an atomic
snapshot across every task file, and it does not verify settlement. See the
[inspection boundary and remaining gates](./rust-engine-migration.md#file-inspection-boundary).

This CLI alpha has one local task type and no CLI listing, scheduling, approvals,
obligation ledger, web connection, or automatic funds movement. The
[Windows desktop alpha](./desktop-alpha.md) can list and open these same task
directories. Its `buyer/` child is
the existing buyer journal, so its payment and creator evidence limits remain those
in the [buyer guide](./buyer-agent.md).

## Recorded reference and evidence exports

After checked recovery, use `brief --format bibtex|ris|evidence-csv --state <task> --file <new destination>` for the same recorded formats as web/API, or omit `--format` for a Markdown brief. Export rechecks local receipt integrity and task binding and uses the existing complete-file publisher. It never purchases, enriches records or verifies settlement independently. Local private files do not imply a private server purchase: the deliberate buyer handoff uses `/api/agent/ask`, whose public web and exact-question DOI discovery can send the question externally when configured. General scholarly opt-in is not part of this versioned paid contract; the isolated private-research endpoint has a separate effects policy.
