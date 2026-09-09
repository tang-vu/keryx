import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import { checkPendingTransfer, searchCircleTransfer } from "./x402-transfer-reconciliation";

type ReconciliationDb = Pick<KeryxDB, "listPrivateCreatorSubmissions" | "getPrivateCreatorConfirmation" | "confirmPrivateCreatorSubmission">;

/** Owner-scoped backend reconciliation only. Never signs, retries a payment, releases budget or writes public metrics. */
export async function reconcilePrivateCreatorSubmissions(db: ReconciliationDb, id: string, payer: string,
  options: { search?: typeof searchCircleTransfer; signal?: AbortSignal; limit?: number; cursor?: string } = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid private reconciliation limit");
  const signal = options.signal ?? AbortSignal.timeout(30_000);
  const rows = await db.listPrivateCreatorSubmissions(id, payer);
  let offset = 0;
  if (options.cursor !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(options.cursor)) throw new Error("Invalid private reconciliation cursor");
    const index = rows.findIndex(row => row.legId === options.cursor);
    if (index < 0) throw new Error("Private reconciliation cursor unavailable");
    offset = index + 1;
  }
  const summary = { scanned: 0, confirmed: 0, alreadyConfirmed: 0, awaiting: 0, failedObserved: 0, mismatched: 0, unavailable: 0,
    remaining: rows.length - offset, nextCursor: options.cursor ?? null as string | null };
  if (!summary.remaining) summary.nextCursor = null;
  const search = options.search ?? searchCircleTransfer;
  for (const row of rows.slice(offset, offset + limit)) {
    if (signal.aborted) break;
    summary.scanned++; summary.remaining--;
    summary.nextCursor = summary.remaining ? row.legId : null;
    const submission = row.data.submission;
    try {
      if (await db.getPrivateCreatorConfirmation(id, payer, submission.authorizationId)) {
        summary.alreadyConfirmed++; continue;
      }
      // The shared search needs payment fields, but no private research identity/content.
      const payment: PaymentRecord = { kind: row.data.kind, queryId: "", sourceId: "", sourceName: "",
        payer: submission.payer, payee: submission.payee, amountUsdc: Number(submission.amountMicros) / 1e6,
        network: submission.network, settled: false, settlementStatus: "pending", authorizationId: submission.authorizationId,
        authorizationExpiresAt: submission.authorizationExpiresAt, createdAt: row.startedAt };
      const result = checkPendingTransfer(payment, await search(payment, signal));
      if (result.verdict === "awaiting") { summary.awaiting++; continue; }
      if (result.verdict === "failed") { summary.failedObserved++; continue; }
      const transfer = result.transfer;
      if (result.verdict !== "settled" || !transfer || transfer.status === "failed") { summary.mismatched++; continue; }
      await db.confirmPrivateCreatorSubmission(id, payer, row.workerId, { source: "circle-transfer-search", transaction: transfer.id,
        transferStatus: transfer.status, submission });
      summary.confirmed++;
    } catch {
      // Storage/search ambiguity is not a settlement failure and cannot authorize another payment.
      summary.unavailable++;
    }
  }
  return summary;
}
