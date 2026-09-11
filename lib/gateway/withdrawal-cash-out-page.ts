import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { recordObservedWithdrawalCashOut } from "./withdrawal-cash-out";
import { withdrawalIdSchema } from "./withdrawal-request";

/** Bounded repeatable reporting sweep. Counts describe this scan, never new revenue
 * or new transactions. Start a later full sweep without a cursor to revisit unknowns. */
export async function reportWithdrawalCashOutPage(journal: ReturnType<typeof createWithdrawalMintJournal>,
  store: Parameters<typeof recordObservedWithdrawalCashOut>[1], signal: AbortSignal,
  options: { afterId?: string; limit?: number } = {}) {
  const limit = options.limit ?? 32, afterId = options.afterId === undefined ? "" : withdrawalIdSchema.parse(options.afterId);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid reporting page");
  signal.throwIfAborted();
  const ids = journal.listRequestIds().sort().filter(id => id > afterId).slice(0, limit + 1);
  let scanned = 0, recorded = 0, notObserved = 0, unavailable = 0;
  let lastId: string | null = afterId || null;
  for (const id of ids.slice(0, limit)) {
    if (signal.aborted) return { state: "aborted" as const, scanned, recorded, notObserved, unavailable, nextCursor: lastId };
    try {
      const result = await recordObservedWithdrawalCashOut(journal, store, id, signal);
      if (result.state === "recorded") recorded++; else notObserved++;
    } catch {
      if (signal.aborted) return { state: "aborted" as const, scanned, recorded, notObserved, unavailable, nextCursor: lastId };
      unavailable++;
    }
    scanned++; lastId = id;
  }
  return { state: ids.length > limit ? "limited" as const : "scanned" as const,
    scanned, recorded, notObserved, unavailable, nextCursor: ids.length > limit ? lastId : null };
}
