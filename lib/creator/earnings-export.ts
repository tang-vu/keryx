/**
 * Creator earnings export — the payout ledger a creator can keep.
 *
 * The creator page shows the last 25 payouts; a creator filing taxes, reconciling a
 * withdrawal, or proving to a publisher that citations really pay needs the whole
 * history in a file. This turns the raw `payment_events` rows into a flat, spreadsheet-
 * shaped ledger: one line per payout, with the question that triggered it.
 *
 * Column note: `settlement_ref` is Circle's settlement identifier, NOT an EVM tx hash —
 * it does not resolve at the block explorer's /tx/. The verifiable on-chain artefact is
 * the withdrawal mint hash on the dashboard, so the header spells the distinction out
 * rather than letting a creator paste a UUID into arcscan and conclude we made it up.
 */

import type { PaymentRecord } from "../types";

export interface EarningsExportRow {
  date: string;
  kind: PaymentRecord["kind"];
  question: string;
  amount_usdc: string;
  weight: string;
  settled: string;
  settlement_ref: string;
  payer: string;
  network: string;
  origin: string;
  dispatch_id: string;
  dispatch_url: string;
}

export const EARNINGS_COLUMNS: (keyof EarningsExportRow)[] = [
  "date",
  "kind",
  "question",
  "amount_usdc",
  "weight",
  "settled",
  "settlement_ref",
  "payer",
  "network",
  "origin",
  "dispatch_id",
  "dispatch_url",
];

/** Payouts → ledger rows. `questionById` is best-effort: a missing question leaves the
 *  cell empty rather than dropping the payout, so totals still reconcile with /status. */
export function buildEarningsRows(
  payments: PaymentRecord[],
  questionById: Map<string, string>,
  baseUrl: string,
): EarningsExportRow[] {
  const origin = baseUrl.replace(/\/+$/, "");
  return payments.map((p) => ({
    date: p.createdAt,
    kind: p.kind,
    question: questionById.get(p.queryId) ?? "",
    // Fixed 6dp: USDC's real precision. Floats would render a citation micro-reward as
    // "1.0000000000000002e-4" in a spreadsheet, which reads as a bug to the creator.
    amount_usdc: p.amountUsdc.toFixed(6),
    weight: p.weight === undefined ? "" : p.weight.toFixed(4),
    settled: p.settled ? "yes" : "no",
    settlement_ref: p.txHash ?? "",
    payer: p.payer,
    network: p.network,
    origin: p.origin ?? "",
    dispatch_id: p.queryId,
    dispatch_url: p.queryId ? `${origin}/dispatch/${p.queryId}` : "",
  }));
}

export interface EarningsSummary {
  paymentCount: number;
  citationCount: number;
  fetchCount: number;
  totalUsdc: number;
  settledUsdc: number;
  firstPaymentAt: string | null;
  lastPaymentAt: string | null;
}

/** Header figures for the JSON envelope, computed over exactly the exported rows so the
 *  file is self-consistent even when a `limit` truncated the history. */
export function summariseEarnings(payments: PaymentRecord[]): EarningsSummary {
  const dates = payments.map((p) => p.createdAt).sort();
  return {
    paymentCount: payments.length,
    citationCount: payments.filter((p) => p.kind === "citation").length,
    fetchCount: payments.filter((p) => p.kind === "fetch").length,
    totalUsdc: round6(payments.reduce((s, p) => s + p.amountUsdc, 0)),
    settledUsdc: round6(
      payments.filter((p) => p.settled).reduce((s, p) => s + p.amountUsdc, 0),
    ),
    firstPaymentAt: dates[0] ?? null,
    lastPaymentAt: dates[dates.length - 1] ?? null,
  };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
