import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
import { checkPendingTransfer, searchCircleTransfer } from "./x402-transfer-reconciliation";

/** Owner-scoped read-only search followed by evidence persistence. No signing or settlement. */
export async function reconcilePrivateIncomingPayment(db: KeryxDB, id: string, payer: string, options: {
  search?: typeof searchCircleTransfer; signal?: AbortSignal;
} = {}) {
  const search = options.search ?? searchCircleTransfer;
  const signal = options.signal ?? AbortSignal.timeout(30_000);
  const intent = await db.getPrivateResearchIntent(id, payer);
  if (!intent) throw new Error("Private research intent unavailable");
  const state = await db.getPrivatePaymentState(id, payer);
  if (!state) return { status: "not-submitted" as const };
  if (state.status === "settled") return { status: "already-confirmed" as const };
  const authorization = intent.submission.payment.authorization;
  const payment: PaymentRecord = { kind: "inbound", queryId: "", sourceId: "", sourceName: "",
    payer: authorization.from, payee: authorization.to, amountUsdc: Number(authorization.value) / 1e6,
    network: intent.requirement.network, settled: false, settlementStatus: "pending", authorizationId: authorization.nonce,
    authorizationExpiresAt: new Date(Number(authorization.validBefore) * 1000).toISOString(), createdAt: state.startedAt };
  try {
    const result = checkPendingTransfer(payment, await search(payment, signal));
    if (result.verdict === "failed") return { status: "failed-observed" as const };
    if (result.verdict !== "settled" || !result.transfer) return { status: result.verdict };
    const transfer = result.transfer;
    // Receipt/batch admission alone must not start a new paid research execution.
    if (transfer.status !== "confirmed" && transfer.status !== "completed") return { status: "processing" as const };
    await db.confirmPrivatePayment(id, payer, { source: "circle-transfer-search", transaction: transfer.id,
      transferStatus: transfer.status, network: intent.requirement.network, payer: authorization.from, payee: authorization.to,
      amountMicros: authorization.value, authorizationId: authorization.nonce });
    return { status: "confirmed" as const };
  } catch { return { status: "unavailable" as const }; }
}
