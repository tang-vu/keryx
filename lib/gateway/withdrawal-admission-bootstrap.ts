import { DatabaseSync } from "node:sqlite";
import { withdrawalRelayRuntime } from "./withdrawal-relay-runtime";
import { inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";
import { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { withdrawalGasAdmissionForRpc } from "./withdrawal-backed-admission";
import type { WithdrawalRequestRecord } from "./withdrawal-request";

/** Server-owned configuration only. Opens the existing dedicated journal per admission;
 * never creates keys, initializes/upgrades history or falls back to the public treasury. */
export function createWithdrawalRuntimeAdmission(env: Readonly<Record<string, string | undefined>>,
  network: string, rpcUrl: string, ceilingWei: string) {
  const selected = { ...env };
  return async (record: WithdrawalRequestRecord, signal: AbortSignal) => {
    const original = structuredClone(record);
    signal.throwIfAborted();
    const runtime = withdrawalRelayRuntime(selected, network);
    if (!runtime) throw new Error("Withdrawal relay admission is disabled");
    const files = await inspectWithdrawalRelayFiles(runtime.directory);
    const policy = files.policy as Parameters<typeof createWithdrawalMintJournal>[1];
    if (policy.relayer?.toLowerCase() !== runtime.signer.address.toLowerCase()) throw new Error("Withdrawal relay policy mismatch");
    signal.throwIfAborted();
    const db = new DatabaseSync(files.databasePath);
    try {
      const rechecked = await inspectWithdrawalRelayFiles(runtime.directory);
      if (JSON.stringify(rechecked.databaseIdentity) !== JSON.stringify(files.databaseIdentity)
        || JSON.stringify(rechecked.policy) !== JSON.stringify(files.policy)) throw new Error("Withdrawal relay history changed");
      signal.throwIfAborted();
      const journal = createWithdrawalMintJournal(db, policy);
      await withdrawalGasAdmissionForRpc(files.directory, journal, ceilingWei, rpcUrl)(original, signal);
    } finally { db.close(); }
  };
}
