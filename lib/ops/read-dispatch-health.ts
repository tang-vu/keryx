import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { projectReceiptSettlement } from "../research-receipt-settlement";
import { assessDispatchHealth, DEFAULT_WINDOW_HOURS, type AssessOptions } from "./dispatch-health";

/** Completed receipts are immutable; reconciliation's current ledger is settlement authority. */
export async function readDispatchHealth(
  db: Pick<KeryxDB, "listCreatorPaymentAttemptsByQuery">,
  runs: QueryRun[],
  options: Omit<AssessOptions, "unsettledRunIds">,
) {
  const cutoff = options.now.getTime() - (options.windowHours ?? DEFAULT_WINDOW_HOURS) * 3_600_000;
  const recent = runs.filter(run => run.paymentMode === "real" && Date.parse(run.createdAt) >= cutoff);
  const unsettledRunIds = new Set<string>();
  const currentPayouts = new Map<string, number>();
  // The caller caps receipts at 200. Keep DB fanout bounded to five reads at a time.
  for (let start = 0; start < recent.length; start += 5) {
    await Promise.all(recent.slice(start, start + 5).map(async run => {
      const settlement = projectReceiptSettlement(run, await db.listCreatorPaymentAttemptsByQuery(run.id));
      currentPayouts.set(run.id, settlement.settledCreatorUsdc);
      if (["pending", "failed", "mixed", "incomplete"].includes(settlement.status)) unsettledRunIds.add(run.id);
    }));
  }
  const projectedRuns = runs.map(run => currentPayouts.has(run.id)
    ? { ...run, totalToCreators: currentPayouts.get(run.id)! }
    : run);
  return assessDispatchHealth(projectedRuns, { ...options, unsettledRunIds });
}
