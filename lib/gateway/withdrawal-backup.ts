import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import { createWithdrawalMintJournal, validateWithdrawalMintJournalPolicy, type WithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";
import { inspectWithdrawalRelayDirectory, inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";

const tables = ["mint_journal_policy", "mint_journal_slots", "mint_journal_prepared", "mint_journal_observations", "mint_journal_admissions"];
async function fingerprint(db: DatabaseSync, policy: WithdrawalMintJournalPolicy, signal: AbortSignal) {
  const check = db.prepare("PRAGMA integrity_check").all();
  if (check.length !== 1 || check[0].integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error();
  const journal = createWithdrawalMintJournal(db, policy);
  journal.gasAdmissionSummary();
  const admissions = db.prepare("SELECT id FROM mint_journal_admissions ORDER BY id LIMIT 1001").all();
  if (admissions.length > policy.maxSlots) throw new Error();
  for (const row of admissions) { signal.throwIfAborted(); await journal.getGasAdmission(String(row.id)); }
  for (const id of journal.listRequestIds()) {
    signal.throwIfAborted(); await journal.getSlot(id); await journal.getPrepared(id); await journal.getObserved(id);
  }
  const hash = createHash("sha256");
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT 1001`).all();
    if (rows.length > (table === "mint_journal_policy" ? 1 : policy.maxSlots)) throw new Error();
    hash.update(JSON.stringify([table, rows]));
  }
  signal.throwIfAborted(); return hash.digest("hex");
}
async function syncPath(path: string, directory = false) {
  const handle = await open(path, constants.O_RDONLY | (directory ? constants.O_DIRECTORY : 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeExclusive(path: string, value: string) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}

/** Private offline recovery evidence, never an authorization to resume signing.
 * Hold the same cooperative lock as admissions/relay through copy and verification.
 * Await SQLite completion on cancellation and retain artifacts for inspection. */
export async function backupWithdrawalJournal(source: string, destination: string, signal: AbortSignal) {
  try {
    signal.throwIfAborted();
    if (typeof backup !== "function" || !isAbsolute(destination) || resolve(destination) !== destination) throw new Error();
    const initial = await inspectWithdrawalRelayFiles(source);
    if (destination === initial.directory || destination.startsWith(initial.directory + sep)) throw new Error();
    await inspectWithdrawalRelayDirectory(dirname(destination)); signal.throwIfAborted();
    return await withPrivateWorkerLock(initial.directory, async () => {
      const files = await inspectWithdrawalRelayFiles(initial.directory);
      if (JSON.stringify(files) !== JSON.stringify(initial)) throw new Error();
      const policy = validateWithdrawalMintJournalPolicy(files.policy);
      const db = new DatabaseSync(files.databasePath, { readOnly: true });
      try {
        const before = await fingerprint(db, policy, signal);
        await mkdir(destination, { mode: 0o700 });
        await inspectWithdrawalRelayDirectory(destination); signal.throwIfAborted();
        await writeExclusive(join(destination, "policy.json"), JSON.stringify(policy));
        const target = join(destination, "mint.sqlite"); await writeExclusive(target, "");
        await backup(db, target); signal.throwIfAborted();
        await syncPath(target);
        const checked = await inspectWithdrawalRelayFiles(destination);
        const copied = new DatabaseSync(checked.databasePath, { readOnly: true });
        try { if (await fingerprint(copied, policy, signal) !== before) throw new Error(); }
        finally { copied.close(); }
        if (await fingerprint(db, policy, signal) !== before) throw new Error();
        if (JSON.stringify(await inspectWithdrawalRelayFiles(initial.directory)) !== JSON.stringify(initial)) throw new Error();
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(target)) { signal.throwIfAborted(); hash.update(chunk); }
        const manifest = { format: "withdrawal-backup-v1", capturedAt: new Date().toISOString(),
          databaseSha256: hash.digest("hex"), journalFingerprint: before, policy,
          signingResumeAuthorized: false };
        signal.throwIfAborted();
        await writeExclusive(join(destination, "manifest.json"), JSON.stringify(manifest));
        await syncPath(destination, true); await syncPath(dirname(destination), true);
        signal.throwIfAborted(); return { state: "verified-backup" as const, directory: destination, manifest };
      } finally { db.close(); }
    });
  } catch { throw new Error("Withdrawal backup unavailable. Retain existing files and inspect; never resume signing from an unverified or stale copy."); }
}
