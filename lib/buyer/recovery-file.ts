import { open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buyerIntentSchema, createBuyerJournal, readBuyerJournal, writeBuyerFile } from "./journal";
import { encodeBuyerRecovery, parseBuyerRecovery, RECOVERY_MAX_BYTES } from "./recovery";

/** Read at most the limit plus one byte, even if a file grows after opening. */
async function readBoundedFile(path: string) {
  const file = await open(path, "r");
  try {
    if (!(await file.stat()).isFile()) throw new Error("Recovery input must be a regular file");
    const buffer = Buffer.alloc(RECOVERY_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > RECOVERY_MAX_BYTES) throw new Error("Recovery file exceeds 64 KB");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally { await file.close(); }
}

/** Exclusive, local-only import. Existing or partially written directories never become buyable. */
export async function importBuyerRecovery(file: string, directory: string) {
  const recovery = parseBuyerRecovery(await readBoundedFile(file));
  const intent = buyerIntentSchema.parse(recovery.intent);
  await createBuyerJournal(directory, intent);
  if (recovery.acknowledgement) await writeBuyerFile(directory, "payment-response.json", recovery.acknowledgement);
  await writeBuyerFile(directory, "recovery-import.json", { schema: "keryx-buyer-recovery-import-v1", recoveryOnly: true });
}

/** Export never overwrites an existing file or fabricates a missing acknowledgement. */
export async function exportBuyerRecovery(directory: string, file: string) {
  const intent = await readBuyerJournal(directory);
  let acknowledgement: unknown;
  try { acknowledgement = JSON.parse(await readBoundedFile(join(directory, "payment-response.json"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const recovery = parseBuyerRecovery(JSON.stringify({ schema: "keryx-buyer-recovery-v1", intent, acknowledgement }));
  const text = encodeBuyerRecovery(intent, recovery.acknowledgement);
  const destination = resolve(file);
  await writeBuyerFile(dirname(destination), basename(destination), JSON.parse(text));
}
