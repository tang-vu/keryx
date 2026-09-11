import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { inspectWithdrawalRelayFiles } from "./withdrawal-relay-files";
import { validateWithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";
import { withdrawalJournalFingerprint } from "./withdrawal-backup";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ format: z.literal("withdrawal-backup-v1"), capturedAt: z.string().datetime(),
  databaseSha256: digest, journalFingerprint: digest, policy: z.unknown(), signingResumeAuthorized: z.literal(false) }).strict();
async function privateFile(path: string, maximum: number) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.nlink !== 1
    || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > maximum) throw new Error();
  return info;
}
async function hashDatabase(path: string, signal: AbortSignal) {
  const before = await privateFile(path, 80 * 1024 * 1024);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error();
    const hash = createHash("sha256"), bytes = Buffer.alloc(65536); let total = 0;
    for (;;) {
      signal.throwIfAborted(); const { bytesRead } = await file.read(bytes, 0, bytes.length, null);
      if (!bytesRead) break; total += bytesRead; if (total > before.size) throw new Error();
      hash.update(bytes.subarray(0, bytesRead));
    }
    const after = await privateFile(path, 80 * 1024 * 1024);
    if (total !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error();
    return hash.digest("hex");
  } finally { await file.close(); }
}

/** Expected digest must come from an independently retained trusted backup record,
 * not from the copy being inspected. This never establishes absence of newer history. */
export async function inspectWithdrawalBackup(directory: string, expectedManifestSha256: string, signal: AbortSignal) {
  try {
    digest.parse(expectedManifestSha256); signal.throwIfAborted();
    const files = await inspectWithdrawalRelayFiles(directory);
    const path = join(files.directory, "manifest.json"), before = await privateFile(path, 4096);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw: Buffer;
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error();
      const bytes = Buffer.alloc(4097); let count = 0;
      while (count < bytes.length) {
        signal.throwIfAborted(); const read = await handle.read(bytes, count, bytes.length - count, null);
        if (!read.bytesRead) break; count += read.bytesRead;
      }
      if (count !== before.size) throw new Error(); raw = bytes.subarray(0, count);
    } finally { await handle.close(); }
    if (createHash("sha256").update(raw).digest("hex") !== expectedManifestSha256) throw new Error();
    const manifest = schema.parse(JSON.parse(raw.toString("utf8")));
    const policy = validateWithdrawalMintJournalPolicy(manifest.policy);
    if (JSON.stringify(policy) !== JSON.stringify(validateWithdrawalMintJournalPolicy(files.policy))) throw new Error();
    if (await hashDatabase(files.databasePath, signal) !== manifest.databaseSha256) throw new Error();
    const db = new DatabaseSync(files.databasePath, { readOnly: true });
    try { if (await withdrawalJournalFingerprint(db, policy, signal) !== manifest.journalFingerprint) throw new Error(); }
    finally { db.close(); }
    if (await hashDatabase(files.databasePath, signal) !== manifest.databaseSha256
      || JSON.stringify(await inspectWithdrawalRelayFiles(directory)) !== JSON.stringify(files)) throw new Error();
    signal.throwIfAborted();
    return { state: "verified-backup-copy" as const, capturedAt: manifest.capturedAt,
      manifestSha256: expectedManifestSha256, signingResumeAuthorized: false as const };
  } catch { throw new Error("Withdrawal backup inspection unavailable. Retain originals; this copy cannot authorize signing."); }
}
