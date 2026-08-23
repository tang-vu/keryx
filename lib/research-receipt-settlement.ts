import { assertPaymentSettlementState } from "./payments/payment-state";
import { receiptAsset } from "./research-receipt-asset";
import type {
  ReceiptCreatorPayment,
  ReceiptLedgerCompleteness,
  ReceiptPaymentStatus,
  ReceiptSettlement,
  ReceiptSettlementStatus,
} from "./research-receipt-types";
import type { PaymentRecord, QueryRun } from "./types";

function projectCreatorPayment(payment: PaymentRecord): ReceiptCreatorPayment | null {
  if (payment.kind === "inbound") return null;
  if (!Number.isFinite(payment.amountUsdc) || payment.amountUsdc <= 0) {
    throw new Error("creator payment amount is invalid");
  }
  const status = assertPaymentSettlementState(payment);
  return {
    kind: payment.kind,
    sourceId: payment.sourceId,
    sourceName: payment.sourceName,
    payee: payment.payee,
    amountUsdc: micros(payment.amountUsdc),
    network: payment.network,
    status,
    ...(status === "settled" && payment.txHash
      ? { circleTransferId: payment.txHash }
      : {}),
    createdAt: payment.createdAt,
    ...receiptAsset(payment),
  };
}

function comparePayments(a: ReceiptCreatorPayment, b: ReceiptCreatorPayment): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.kind.localeCompare(b.kind) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.payee.localeCompare(b.payee) ||
    a.amountUsdc - b.amountUsdc ||
    (a.circleTransferId ?? "").localeCompare(b.circleTransferId ?? "")
  );
}

function sumUsdc(payments: ReceiptCreatorPayment[]): number {
  return micros(payments.reduce((sum, payment) => sum + payment.amountUsdc, 0));
}

export function micros(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function settlementMode(run: QueryRun, payments: ReceiptCreatorPayment[]): ReceiptSettlement["mode"] {
  if (run.paymentMode) return run.paymentMode;
  if (payments.length === 0) return "legacy";
  return payments.some((payment) => payment.status !== "simulated") ? "legacy" : "offline";
}

function settlementCompleteness(
  run: QueryRun,
  mode: ReceiptSettlement["mode"],
  payments: ReceiptCreatorPayment[],
): { completeness: ReceiptLedgerCompleteness; expected: number | null } {
  if (mode === "offline") return { completeness: "not_applicable", expected: null };
  if (run.settledPayments === undefined) return { completeness: "legacy", expected: null };

  const expected = run.settledPayments + (run.pendingPayments ?? 0);
  const recorded = payments.filter((payment) => payment.status !== "simulated").length;
  const hasSimulation = payments.some((payment) => payment.status === "simulated");
  return {
    completeness: recorded === expected && !hasSimulation ? "complete" : "incomplete",
    expected,
  };
}

function settlementStatus(
  mode: ReceiptSettlement["mode"],
  completeness: ReceiptLedgerCompleteness,
  groups: Record<ReceiptPaymentStatus, ReceiptCreatorPayment[]>,
): ReceiptSettlementStatus {
  if (mode === "offline") return "offline";
  if (completeness === "incomplete") return "incomplete";
  if (groups.pending.length > 0) return "pending";
  if (groups.failed.length > 0 && groups.settled.length > 0) return "mixed";
  if (groups.failed.length > 0) return "failed";
  if (groups.settled.length > 0) return "settled";
  if (groups.simulated.length > 0) return "offline";
  return "none";
}

export function projectReceiptSettlement(run: QueryRun, rows: PaymentRecord[]): ReceiptSettlement {
  const payments = rows
    .filter((payment) => payment.queryId === run.id)
    .map(projectCreatorPayment)
    .filter((payment): payment is ReceiptCreatorPayment => payment !== null)
    .sort(comparePayments);
  const groups: Record<ReceiptPaymentStatus, ReceiptCreatorPayment[]> = {
    settled: payments.filter((payment) => payment.status === "settled"),
    pending: payments.filter((payment) => payment.status === "pending"),
    failed: payments.filter((payment) => payment.status === "failed"),
    simulated: payments.filter((payment) => payment.status === "simulated"),
  };
  const mode = settlementMode(run, payments);
  const { completeness, expected } = settlementCompleteness(run, mode, payments);
  const settledAccess = groups.settled.filter((payment) => payment.kind === "fetch");
  const settledCitation = groups.settled.filter((payment) => payment.kind === "citation");

  return {
    mode,
    status: settlementStatus(mode, completeness, groups),
    ledgerCompleteness: completeness,
    expectedRecordedPaymentsAtFinish: expected,
    recordedCreatorPayments: payments.length,
    settledCreatorPayments: groups.settled.length,
    pendingCreatorPayments: groups.pending.length,
    failedCreatorPayments: groups.failed.length,
    simulatedCreatorPayments: groups.simulated.length,
    settledCreators: new Set(groups.settled.map((payment) => payment.payee.toLowerCase())).size,
    settledCreatorUsdc: sumUsdc(groups.settled),
    settledAccessUsdc: sumUsdc(settledAccess),
    settledCitationUsdc: sumUsdc(settledCitation),
    pendingCreatorUsdc: sumUsdc(groups.pending),
    failedCreatorUsdc: sumUsdc(groups.failed),
    simulatedCreatorUsdc: sumUsdc(groups.simulated),
    creatorPayments: payments,
  };
}
