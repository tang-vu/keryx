import type { KeryxDB } from "../db/keryx-db";
import { captureLedgerPayment, captureLedgerRun, iso, type LedgerRunSnapshot } from "./capture";
import { LEDGER_PAYMENT_LIMIT, LEDGER_RUN_LIMIT } from "./contracts";
import { projectOperatorLedger } from "./projection";
import { ledgerRunCursor, publicLedgerRunReader, type PublicLedgerRunCursor } from "./native-pages";

export type PublicLedgerReader = Pick<KeryxDB, "iterateRecentQueries" | "listPayments" | "publicLedgerRuns">;

/** Two bounded public-domain reads. No customer/private history or financial journal read. */
export async function readOperatorLedger(reader: PublicLedgerReader, network: string, days = 7, clock = () => new Date().toISOString()) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 31) throw new Error("Ledger window refused");
  const readStartedAt = clock();
  if (!iso(readStartedAt)) throw new Error("Ledger clock unavailable");
  const runs: LedgerRunSnapshot[] = [];
  let scanned = 0, runLimitReached = false;
  const native = publicLedgerRunReader(reader);
  if (native) {
    let before: PublicLedgerRunCursor | undefined;
    while (scanned <= LEDGER_RUN_LIMIT) {
      const take = Math.min(32, LEDGER_RUN_LIMIT + 1 - scanned);
      const page = native.page({ take, ...(before ? { before } : {}) });
      if (!page || !Array.isArray(page.snapshots) || page.snapshots.length > take ||
        page.snapshots.length === 0 && page.before !== null || page.snapshots.length > 0 && !ledgerRunCursor(page.before))
        throw new Error("Ledger native page unavailable");
      if (!page.snapshots.length) break;
      if (before && page.before && !(page.before.createdAt < before.createdAt ||
        page.before.createdAt === before.createdAt && page.before.id < before.id)) throw new Error("Ledger native cursor unavailable");
      for (const snapshot of page.snapshots) {
        if (++scanned > LEDGER_RUN_LIMIT) { runLimitReached = true; break; }
        if (snapshot) runs.push(snapshot);
      }
      before = page.before!;
    }
  } else {
    for await (const value of reader.iterateRecentQueries(LEDGER_RUN_LIMIT + 1)) {
      if (++scanned > LEDGER_RUN_LIMIT) { runLimitReached = true; break; }
      const snapshot = captureLedgerRun(value);
      if (snapshot) runs.push(snapshot);
    }
  }
  const rows = await reader.listPayments(LEDGER_PAYMENT_LIMIT + 1);
  if (!Array.isArray(rows) || rows.length > LEDGER_PAYMENT_LIMIT + 1) throw new Error("Ledger payment slice unavailable");
  const payments = rows.slice(0, LEDGER_PAYMENT_LIMIT).map(captureLedgerPayment);
  return projectOperatorLedger({ network, days, readStartedAt, readCompletedAt: clock(), runs, payments,
    runLimitReached, paymentLimitReached: rows.length > LEDGER_PAYMENT_LIMIT });
}
