/**
 * Portfolio export — every payout across every source ONE wallet owns, in one ledger.
 *
 * The per-creator export answers "what did this source earn". A creator running twenty feeds
 * (and an accountant asking for the year) needs the other question: what did *I* earn, across
 * all of them. Same row shape as the single-source ledger plus the source that earned it, so a
 * pivot table over `source_id` reproduces the per-creator files exactly.
 *
 * Ownership is resolved from the sources, never from the payout rows: a payment row records
 * where money went, and a wallet must not be able to export a stranger's history by having
 * once received a split from it.
 */

import type { PaymentRecord } from "../types";
import {
  EARNINGS_COLUMNS,
  buildEarningsRows,
  round6,
  type EarningsExportRow,
} from "./earnings-export";

export interface PortfolioExportRow extends EarningsExportRow {
  source_id: string;
  source_name: string;
}

export const PORTFOLIO_COLUMNS: (keyof PortfolioExportRow & string)[] = [
  "source_id",
  "source_name",
  ...EARNINGS_COLUMNS,
];

export function buildPortfolioRows(
  payments: PaymentRecord[],
  questionById: Map<string, string>,
  baseUrl: string,
): PortfolioExportRow[] {
  const rows = buildEarningsRows(payments, questionById, baseUrl);
  return rows.map((row, i) => ({
    source_id: payments[i].sourceId,
    source_name: payments[i].sourceName,
    ...row,
  }));
}

export interface PortfolioSourceTotal {
  sourceId: string;
  sourceName: string;
  paymentCount: number;
  totalUsdc: number;
  settledUsdc: number;
}

/** Per-source totals over exactly the exported rows, biggest earner first — the summary a
 *  creator actually reads before opening the detail. */
export function summarisePortfolioBySource(
  payments: PaymentRecord[],
): PortfolioSourceTotal[] {
  const bySource = new Map<string, PortfolioSourceTotal>();
  for (const p of payments) {
    const entry = bySource.get(p.sourceId) ?? {
      sourceId: p.sourceId,
      sourceName: p.sourceName,
      paymentCount: 0,
      totalUsdc: 0,
      settledUsdc: 0,
    };
    entry.paymentCount += 1;
    entry.totalUsdc += p.amountUsdc;
    if (p.settled) entry.settledUsdc += p.amountUsdc;
    bySource.set(p.sourceId, entry);
  }
  return [...bySource.values()]
    .map((e) => ({
      ...e,
      totalUsdc: round6(e.totalUsdc),
      settledUsdc: round6(e.settledUsdc),
    }))
    .sort((a, b) => b.totalUsdc - a.totalUsdc);
}

/** Newest first across sources, so a merged ledger reads like one account statement rather
 *  than a concatenation of per-source blocks. */
export function sortNewestFirst(payments: PaymentRecord[]): PaymentRecord[] {
  return [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
