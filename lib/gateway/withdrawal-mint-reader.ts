import { DatabaseSync } from "node:sqlite";
import { inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { readWithdrawalMintProgress } from "./withdrawal-mint-progress";
import type { WithdrawalRequestRecord } from "./withdrawal-request";

/** Operator-selected existing history; no signer, RPC or write-enabled connection.
 * This reader remains usable while new relay submissions are disabled. */
export function createWithdrawalMintReader(directory: string) {
  return async (value: WithdrawalRequestRecord, owner: string, signal: AbortSignal) => {
    const record = structuredClone(value); signal.throwIfAborted();
    const files = await inspectWithdrawalRelayFiles(directory);
    const db = new DatabaseSync(files.databasePath, { readOnly: true });
    try {
      const rechecked = await inspectWithdrawalRelayFiles(directory);
      if (JSON.stringify(rechecked.databaseIdentity) !== JSON.stringify(files.databaseIdentity)
        || JSON.stringify(rechecked.policy) !== JSON.stringify(files.policy)) throw new Error("Withdrawal history changed");
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
      signal.throwIfAborted();
      const journal = createWithdrawalMintJournal(db, files.policy as Parameters<typeof createWithdrawalMintJournal>[1]);
      return await readWithdrawalMintProgress(journal, record, owner, signal);
    } finally { db.close(); }
  };
}
