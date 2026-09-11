import { mkdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createWithdrawalMintJournal, validateWithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";
import { inspectWithdrawalRelayDirectory, inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";

/** Explicit operator initialization for a newly generated, never-used testnet key.
 * This is not recovery and cannot prove key freshness or exclusive custody. The
 * caller must establish those separately, along with live latest/pending nonce 0.
 * Existing or partially created directories are never reused or cleaned up here. */
export async function provisionFreshWithdrawalJournal(directory: string, selected: unknown, signal: AbortSignal) {
  try {
    const policy = validateWithdrawalMintJournalPolicy(selected);
    if (policy.initialNonce !== 0 || !isAbsolute(directory) || resolve(directory) !== directory) throw new Error();
    signal.throwIfAborted();
    await inspectWithdrawalRelayDirectory(dirname(directory)); signal.throwIfAborted();
    await mkdir(directory, { mode: 0o700 }); // Exclusive creation; no recursive/existing-directory fallback.
    await inspectWithdrawalRelayDirectory(directory); signal.throwIfAborted();
    const policyFile = await open(join(directory, "policy.json"), "wx", 0o600);
    try { await policyFile.writeFile(JSON.stringify(policy)); await policyFile.sync(); }
    finally { await policyFile.close(); }
    signal.throwIfAborted();
    const databasePath = join(directory, "mint.sqlite"), file = await open(databasePath, "wx", 0o600);
    try { await file.sync(); } finally { await file.close(); }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec("PRAGMA synchronous=FULL;");
      const journal = createWithdrawalMintJournal(db, policy, { initialize: true });
      if (journal.listRequestIds().length || journal.gasAdmissionSummary().committedRequests) throw new Error();
    } finally { db.close(); }
    const folder = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await folder.sync(); } finally { await folder.close(); }
    const parent = await open(dirname(directory), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await parent.sync(); } finally { await parent.close(); }
    signal.throwIfAborted();
    const checked = await inspectWithdrawalRelayFiles(directory);
    if (JSON.stringify(checked.policy) !== JSON.stringify(policy)) throw new Error();
    const reopened = new DatabaseSync(checked.databasePath, { readOnly: true });
    try {
      const journal = createWithdrawalMintJournal(reopened, policy);
      if (journal.listRequestIds().length || journal.gasAdmissionSummary().committedRequests) throw new Error();
    } finally { reopened.close(); }
    signal.throwIfAborted();
    return { directory: checked.directory, policy, state: "initialized-empty" as const };
  } catch { throw new Error("Withdrawal initialization unavailable. Retain any existing files and inspect before proceeding."); }
}
