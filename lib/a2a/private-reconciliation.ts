import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { addressSchema } from "../buyer/protocol";
import { privateResearchIdSchema } from "./private-research-intent";
import { reconcilePrivateIncomingPayment } from "../gateway/private-incoming-reconciliation";
import { reconcilePrivateCreatorSubmissions } from "../gateway/private-creator-reconciliation";
import type { searchCircleTransfer } from "../gateway/x402-transfer-reconciliation";

const candidate = z.object({ id: privateResearchIdSchema, payer: addressSchema }).strict();

/** Serial read-only Circle searches followed by exact evidence persistence. No signer,
 * settlement retry, release or execution. Cursors are private and reset after a full sweep. */
export function createPrivateReconciliation(db: KeryxDB, signer: string, options: { search?: typeof searchCircleTransfer } = {}) {
  const treasury = addressSchema.parse(signer).toLowerCase();
  const search = options.search;
  let after: string | undefined;
  let current: z.infer<typeof candidate> | undefined;
  let legCursor: string | undefined;
  let busy = false;
  const next = () => { after = current?.id ?? after; current = undefined; legCursor = undefined; };
  return {
    async tick(signal?: AbortSignal) {
      const counts = { status: "reconciliation" as const, visited: 0, incomingConfirmed: 0, creatorConfirmed: 0,
        processing: 0, awaiting: 0, failedObserved: 0, mismatched: 0, errors: 0, remainingLegs: 0 };
      if (busy) return { ...counts, errors: 1 };
      if (signal?.aborted) return counts;
      busy = true;
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 30000);
      const stop = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
      try {
        if (!current) {
          const rows = z.array(candidate).max(1).parse(await db.listPrivateReconciliationCandidates(treasury, after));
          if (rows.length === 0) { after = undefined; return counts; }
          if (after !== undefined && rows[0].id <= after) throw new Error();
          current = rows[0];
        }
        if (stop.aborted) return { ...counts, errors: deadline.signal.aborted ? 1 : 0 };
        counts.visited = 1;
        const incoming = await reconcilePrivateIncomingPayment(db, current.id, current.payer, { search, signal: stop });
        if (incoming.status === "confirmed") counts.incomingConfirmed++;
        if (incoming.status !== "confirmed" && incoming.status !== "already-confirmed") {
          if (incoming.status === "unavailable") counts.errors++;
          else if (incoming.status === "failed-observed") counts.failedObserved++;
          else if (incoming.status === "mismatch") counts.mismatched++;
          else if (incoming.status === "processing") counts.processing++;
          else counts.awaiting++;
          next(); return counts;
        }
        if (stop.aborted) return { ...counts, errors: deadline.signal.aborted ? 1 : 0 };
        const creators = await reconcilePrivateCreatorSubmissions(db, current.id, current.payer, {
          search, signal: stop, limit: 25, cursor: legCursor,
        });
        counts.creatorConfirmed += creators.confirmed;
        counts.processing += creators.processing;
        counts.awaiting += creators.awaiting;
        counts.failedObserved += creators.failedObserved;
        counts.mismatched += creators.mismatched;
        counts.errors += creators.unavailable;
        counts.remainingLegs = creators.remaining;
        legCursor = creators.nextCursor ?? undefined;
        if (creators.remaining === 0) next();
        return counts;
      } catch { next(); return { ...counts, errors: counts.errors + 1 }; }
      finally { clearTimeout(timer); busy = false; }
    },
  };
}
