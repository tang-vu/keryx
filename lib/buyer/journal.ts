import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { z } from "zod";
import { buyerJobId, buyerIntentEnvelopeSchema } from "./policy";

export const buyerIntentSchema = buyerIntentEnvelopeSchema.superRefine((v, ctx) => {
  if (v.queryId !== buyerJobId(v.authorization) || v.authorization.value !== v.requirement.amount
    || v.authorization.to.toLowerCase() !== v.requirement.payTo.toLowerCase()) {
    ctx.addIssue({ code: "custom", message: "Journal authorization does not match its job" });
  }
});
export type BuyerIntent = z.infer<typeof buyerIntentSchema>;

/** Immutable files, exclusive creation and fsync: a failed write never permits submission. */
export async function writeBuyerFile(directory: string, name: string, value: unknown) {
  const file = await open(join(directory, name), "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  // Node cannot open directory handles on Windows. POSIX also persists directory entries.
  if (process.platform !== "win32") {
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  }
}

export async function createBuyerJournal(directory: string, intent: BuyerIntent) {
  // A job directory is single-use, even if a process died before finishing the first write.
  await mkdir(resolve(directory), { mode: 0o700 });
  if (process.platform !== "win32") {
    const parent = await open(dirname(resolve(directory)), "r");
    try { await parent.sync(); } finally { await parent.close(); }
  }
  await writeBuyerFile(directory, "intent.json", buyerIntentSchema.parse(intent));
}

export async function readBuyerJournal(directory: string): Promise<BuyerIntent> {
  const text = await readFile(join(directory, "intent.json"), "utf8");
  if (text.length > 65536) throw new Error("Buyer journal is too large");
  return buyerIntentSchema.parse(JSON.parse(text));
}

/** Receipt snapshots can be downloaded again; atomically replace only their digest-addressed file. */
export async function archiveBuyerReceipt(directory: string, name: string, receipt: unknown) {
  if (!/^receipt-[a-f0-9]{64}\.json$/.test(name)) throw new Error("Invalid receipt archive name");
  const temporary = `.receipt-${randomUUID()}.tmp`;
  try {
    await writeBuyerFile(directory, temporary, receipt);
    await rename(join(directory, temporary), join(directory, name));
    if (process.platform !== "win32") {
      const parent = await open(directory, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await unlink(join(directory, temporary)).catch(() => undefined); }
}
