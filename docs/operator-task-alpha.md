# Operator task alpha

This first Operator slice is a local Arc-testnet research task handoff. It persists
one normalized request, a pinned seller payee, and a per-job total cap. It does not
create a wallet, fund it, sign, submit a purchase, or start a background worker.
The existing buyer CLI remains the only CLI purchase path.

Download `request.json` from [/research](https://keryx.cc/research) as described in
the [buyer guide](./buyer-agent.md). Use a private existing parent such as
`.buyer-jobs/` (gitignored). A task directory
must be new. On Windows, its files inherit the parent ACL. Keep the request, task,
buyer journal, and JSON exports private: the buyer job ID is bearer access to the
result. The commands below do not load `.env.local` or `.env.buyer.local`; only the
deliberate `buyer buy` command loads the buyer key environment if present.

```sh
npm run operator -- create --request request.json --payee 0xYOUR_VERIFIED_PAYEE --max-total 0.10 --state .buyer-jobs/task-1
npm run operator -- status --state .buyer-jobs/task-1
npm run buyer -- buy --request .buyer-jobs/task-1/request.json --payee 0xYOUR_VERIFIED_PAYEE --max-total 0.10 --state .buyer-jobs/task-1/buyer
npm run operator -- resume --state .buyer-jobs/task-1
npm run operator -- export --json --state .buyer-jobs/task-1
```

Confirm the payee independently as described in [buyer-agent.md](./buyer-agent.md).
The `create` output includes the exact buyer arguments for the task. Before spending,
compare them to the pinned payee and cap you intended. `buyer buy` is single-use: if
it times out or exits after creating its journal, do not run `buy` again for recovery.
Run Operator `resume` against the same task. It checks the buyer journal against the
original request, payee, and total cap, then uses the existing GET-only receipt
verification path. A missing/incomplete journal requires inspection; a 404 or lost
acknowledgement leaves payment uncertain.

`status` and `export --json` read local files only. Both keep top-level payment and
delivery `unknown`; after a successful `resume`, they can show a saved, possibly
stale observation with a seller-reported payment state and delivery status. That
snapshot is a diagnostic, not independent settlement proof or portable recovery.
For a shareable redacted report, use `npm run buyer -- report --state
.buyer-jobs/task-1/buyer` and review it before sharing. JSON stdout is clean with
the direct `node --import tsx scripts/operator.mts ...` form; npm may print its own
headers unless invoked with `--silent`.

This CLI alpha has one local task type and no CLI listing, scheduling, approvals,
obligation ledger, web connection, or automatic funds movement. The
[Windows desktop alpha](./desktop-alpha.md) can list and open these same task
directories. Its `buyer/` child is
the existing buyer journal, so its payment and creator evidence limits remain those
in the [buyer guide](./buyer-agent.md).
