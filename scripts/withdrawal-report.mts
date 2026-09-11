import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { inspectWithdrawalRelayFiles } from "../lib/gateway/withdrawal-relay-files";
import { createWithdrawalMintJournal } from "../lib/gateway/withdrawal-mint-journal";
import { withWithdrawalCashOutStore } from "../lib/gateway/withdrawal-application-store";
import { reportWithdrawalCashOutPage } from "../lib/gateway/withdrawal-cash-out-page";

async function main() {
  const { values } = parseArgs({ options: { help: { type: "boolean" }, directory: { type: "string" },
    "application-db": { type: "string" }, "after-id": { type: "string" }, limit: { type: "string" } }, strict: true });
  if (values.help) {
    console.log(`Usage: npm run withdrawal:report -- --directory ABSOLUTE_RELAY_DIR --application-db ABSOLUTE_DB [--after-id DIGEST] [--limit 1..64]
Report validated Arc-testnet mint observations into the existing cash-out ledger.
No keys, RPC, signing, transfer, broadcast, initialization or migration.
Counts are confirmations within this scan, not new cash-outs or revenue. Keep cursors private.
Continue cursor pages, then start later full sweeps without a cursor to revisit unknowns.`); return;
  }
  if (!values.directory || !values["application-db"]) throw new Error();
  const limit = values.limit === undefined ? 32 : /^[1-9][0-9]?$/.test(values.limit) ? Number(values.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit > 64) throw new Error();
  const files = await inspectWithdrawalRelayFiles(values.directory);
  const db = new DatabaseSync(files.databasePath, { readOnly: true });
  const stop = new AbortController(), shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    const rechecked = await inspectWithdrawalRelayFiles(values.directory);
    if (JSON.stringify(rechecked.databaseIdentity) !== JSON.stringify(files.databaseIdentity)
      || JSON.stringify(rechecked.policy) !== JSON.stringify(files.policy)) throw new Error();
    db.exec("PRAGMA query_only=ON;");
    const journal = createWithdrawalMintJournal(db, files.policy as Parameters<typeof createWithdrawalMintJournal>[1]);
    const result = await withWithdrawalCashOutStore(values["application-db"], store =>
      reportWithdrawalCashOutPage(journal, store, stop.signal, { afterId: values["after-id"], limit }));
    console.log(JSON.stringify(result));
    if (result.state === "aborted" || result.unavailable) process.exitCode = 2;
  } finally { db.close(); process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }
}
main().catch(() => { console.error("Withdrawal reporting unavailable; verify protected original journals. Private details omitted."); process.exitCode = 1; });
