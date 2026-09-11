import { opendir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema } from "./private-research-intent";
import { createPrivateResultSpool } from "./private-result-spool";
import { withPrivateWorkerLock } from "./private-worker-lock";

export const privateInterruptionLocatorSchema = z.object({ id: privateResearchIdSchema, payer: addressSchema }).strict();
type OperatorDb = Pick<KeryxDB, "getPrivateResearchExecution" | "getPrivateResearchResult" | "savePrivateResearchResult" |
  "getPrivateTreasury" | "getPrivateResearchInterruption" | "interruptPrivateResearch" | "releasePrivateTreasury">;
const report = <T extends string>(status: T) => ({ status, paymentRequestsSent: 0 as const, refundIssuedByThisAction: false as const });

/** Operator-only, on the worker's actual configured spool and database. The cooperative
 * lock must be available; this never stops a process or removes a retained crash lock.
 * Every recognized backup is authenticated before absence can permit interruption. */
export async function resolvePrivateInterruption(db: OperatorDb, value: unknown, options: {
  directory: string; keyHex: string; apply: boolean;
}) {
  const parsed = privateInterruptionLocatorSchema.safeParse(value);
  const { directory, keyHex, apply } = options;
  if (!parsed.success || !isAbsolute(directory) || typeof apply !== "boolean") throw new Error("Private interruption selection unavailable");
  const { id, payer } = parsed.data;
  const spool = await createPrivateResultSpool(directory, keyHex);
  return withPrivateWorkerLock(directory, async () => {
    const claim = await db.getPrivateResearchExecution(id, payer);
    if (!claim) throw new Error("Private interruption execution unavailable");
    if (await db.getPrivateResearchResult(id, payer)) return report("result-available");
    let visited = 0;
    for await (const entry of await opendir(directory)) {
      if (++visited > 10000 || !entry.isFile()) throw new Error("Private backup inspection incomplete");
      if (["private-worker.lock", "private-worker-status.json"].includes(entry.name)
        || /^\.private-worker-status-[a-f0-9-]{36}\.tmp$/.test(entry.name)) continue;
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error("Private backup inspection incomplete");
      const token = entry.name.slice(0, -5), payload = await spool.read(token);
      if (payload.id !== id) continue;
      if (payload.payer.toLowerCase() !== payer.toLowerCase() || payload.workerId !== claim.workerId)
        throw new Error("Private backup authority mismatch");
      if (!apply) return report("backup-available");
      await spool.restore(db, token);
      return report("result-restored");
    }
    const treasury = await db.getPrivateTreasury(id, payer);
    if (!treasury) throw new Error("Private interruption treasury unavailable");
    if (!apply) return report(await db.getPrivateResearchInterruption(id, payer) ? "already-interrupted" : "interruption-proposed");
    const recorded = await db.interruptPrivateResearch(id, payer, claim.workerId);
    if (!recorded) {
      if (await db.getPrivateResearchResult(id, payer)) return report("result-available");
      throw new Error("Private interruption unavailable");
    }
    await db.releasePrivateTreasury(id, payer, treasury.signer);
    return report("interrupted");
  });
}
