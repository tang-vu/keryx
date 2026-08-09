import type { PaymentRecord, PaymentSettlementStatus } from "../types";

/** Legacy false rows predate an explicit status and were offline simulations. New ambiguous real
 * attempts always persist `pending`, so this fallback cannot silently promote them to settled. */
export function paymentSettlementStatus(
  payment: Pick<PaymentRecord, "settled" | "settlementStatus">,
): PaymentSettlementStatus {
  return payment.settlementStatus ?? (payment.settled ? "settled" : "simulated");
}

export function assertPaymentSettlementState(
  payment: Pick<PaymentRecord, "settled" | "settlementStatus">,
): PaymentSettlementStatus {
  const status = paymentSettlementStatus(payment);
  if (payment.settled !== (status === "settled")) {
    throw new Error("payment settled flag conflicts with settlement status");
  }
  return status;
}

/** Amounts that actually count in a completed run. Failed and ambiguous attempts never do. */
export function paymentCountsAsSpent(
  payment: Pick<PaymentRecord, "settled" | "settlementStatus">,
): boolean {
  const status = paymentSettlementStatus(payment);
  return status === "settled" || status === "simulated";
}

/** Thrown only after a signed authorization crossed the submission boundary. The attached record
 * is safe to persist/display and deliberately contains no signature. */
export class PaymentPendingError extends Error {
  readonly payment: PaymentRecord;

  constructor(message: string, payment: PaymentRecord) {
    super(message);
    this.name = "PaymentPendingError";
    this.payment = payment;
  }
}

export function pendingPaymentFrom(error: unknown): PaymentRecord | null {
  return error instanceof PaymentPendingError ? error.payment : null;
}

/** Thrown when Circle returned definitive settlement proof but the paid route could not deliver
 * its resource/acknowledgement. The debit is settled even though the caller must skip the content. */
export class PaymentSettledError extends Error {
  readonly payment: PaymentRecord;

  constructor(message: string, payment: PaymentRecord) {
    super(message);
    this.name = "PaymentSettledError";
    this.payment = payment;
  }
}

export function settledPaymentFrom(error: unknown): PaymentRecord | null {
  return error instanceof PaymentSettledError ? error.payment : null;
}

export function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PaymentRecord>;
  return (
    (candidate.kind === "fetch" ||
      candidate.kind === "citation" ||
      candidate.kind === "inbound") &&
    typeof candidate.queryId === "string" &&
    typeof candidate.amountUsdc === "number" &&
    typeof candidate.settled === "boolean"
  );
}
