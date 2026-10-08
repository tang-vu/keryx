import { assertPaymentSettlementState } from "./payments/payment-state";
import { receiptAsset } from "./research-receipt-asset";
import type {
  ReceiptCreatorPayment,
  ReceiptLedgerCompleteness,
  ReceiptOperatingPayment,
  ReceiptPaymentStatus,
  ReceiptSettlement,
  ReceiptSettlementStatus,
} from "./research-receipt-types";
import type { PaymentRecord, QueryRun } from "./types";

type ReceiptOutboundPayment = ReceiptCreatorPayment | ReceiptOperatingPayment;

function projectOutboundPayment(payment: PaymentRecord): ReceiptOutboundPayment | null {
  if (payment.kind === "inbound") return null;
  if (!Number.isFinite(payment.amountUsdc) || payment.amountUsdc <= 0) {
    throw new Error("outbound payment amount is invalid");
  }
  const status = assertPaymentSettlementState(payment);
  if (payment.kind === "operating-fee" && status === "settled" &&
    (payment.settlementStatus !== "settled" || !payment.txHash?.trim())) {
    throw new Error("operating fee settlement evidence is missing");
  }
  return {
    kind: payment.kind,
    ...(payment.kind === "operating-fee" ? { funding: "keryx-sponsored" as const } : {}),
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
    ...(payment.scholarlyDeclarationId && payment.scholarlyApprovalId ? { scholarlyRights: {
      declarationId: payment.scholarlyDeclarationId, approvalId: payment.scholarlyApprovalId,
      policy: "supervised-testnet-v1" as const,
    } } : {}),
    ...receiptAsset(payment),
  } as ReceiptOutboundPayment;
}

function comparePayments(a: ReceiptOutboundPayment, b: ReceiptOutboundPayment): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.kind.localeCompare(b.kind) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.payee.localeCompare(b.payee) ||
    a.amountUsdc - b.amountUsdc ||
    (a.circleTransferId ?? "").localeCompare(b.circleTransferId ?? "")
  );
}

function sumUsdc(payments: ReceiptOutboundPayment[]): number {
  return micros(payments.reduce((sum, payment) => sum + payment.amountUsdc, 0));
}

export function micros(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function settlementMode(run: QueryRun, payments: ReceiptOutboundPayment[]): ReceiptSettlement["mode"] {
  if (run.paymentMode) return run.paymentMode;
  if (payments.length === 0) return "legacy";
  return payments.some((payment) => payment.status !== "simulated") ? "legacy" : "offline";
}

function settlementCompleteness(
  run: QueryRun,
  mode: ReceiptSettlement["mode"],
  payments: ReceiptOutboundPayment[],
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
  groups: Record<ReceiptPaymentStatus, ReceiptOutboundPayment[]>,
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
    .map(projectOutboundPayment)
    .filter((payment): payment is ReceiptOutboundPayment => payment !== null)
    .sort(comparePayments);
  const groups: Record<ReceiptPaymentStatus, ReceiptOutboundPayment[]> = {
    settled: payments.filter((payment) => payment.status === "settled"),
    pending: payments.filter((payment) => payment.status === "pending"),
    failed: payments.filter((payment) => payment.status === "failed"),
    simulated: payments.filter((payment) => payment.status === "simulated"),
  };
  const mode = settlementMode(run, payments);
  const { completeness, expected } = settlementCompleteness(run, mode, payments);
  const creators = payments.filter((payment): payment is ReceiptCreatorPayment => payment.kind !== "operating-fee");
  const creatorGroups = {
    settled: creators.filter(payment => payment.status === "settled"),
    pending: creators.filter(payment => payment.status === "pending"),
    failed: creators.filter(payment => payment.status === "failed"),
    simulated: creators.filter(payment => payment.status === "simulated"),
  };
  const operating = payments.filter((payment): payment is ReceiptOperatingPayment => payment.kind === "operating-fee");
  const operatingGroups = {
    settled: operating.filter(payment => payment.status === "settled"),
    pending: operating.filter(payment => payment.status === "pending"),
    failed: operating.filter(payment => payment.status === "failed"),
    simulated: operating.filter(payment => payment.status === "simulated"),
  };
  const settledAccess = creatorGroups.settled.filter((payment) => payment.kind === "fetch");
  const settledCitation = creatorGroups.settled.filter((payment) => payment.kind === "citation");

  return {
    mode,
    status: settlementStatus(mode, completeness, groups),
    ledgerCompleteness: completeness,
    expectedRecordedPaymentsAtFinish: expected,
    recordedCreatorPayments: creators.length,
    settledCreatorPayments: creatorGroups.settled.length,
    pendingCreatorPayments: creatorGroups.pending.length,
    failedCreatorPayments: creatorGroups.failed.length,
    simulatedCreatorPayments: creatorGroups.simulated.length,
    settledCreators: new Set(creatorGroups.settled.map((payment) => payment.payee.toLowerCase())).size,
    settledCreatorUsdc: sumUsdc(creatorGroups.settled),
    settledAccessUsdc: sumUsdc(settledAccess),
    settledCitationUsdc: sumUsdc(settledCitation),
    pendingCreatorUsdc: sumUsdc(creatorGroups.pending),
    failedCreatorUsdc: sumUsdc(creatorGroups.failed),
    simulatedCreatorUsdc: sumUsdc(creatorGroups.simulated),
    creatorPayments: creators,
    ...(operating.length > 0 || run.operatingFee ? {
      operatingPayments: operating,
      recordedOperatingPayments: operating.length,
      settledOperatingPayments: operatingGroups.settled.length,
      pendingOperatingPayments: operatingGroups.pending.length,
      failedOperatingPayments: operatingGroups.failed.length,
      simulatedOperatingPayments: operatingGroups.simulated.length,
      settledOperatingFeeUsdc: sumUsdc(operatingGroups.settled),
      pendingOperatingFeeUsdc: sumUsdc(operatingGroups.pending),
      failedOperatingFeeUsdc: sumUsdc(operatingGroups.failed),
      simulatedOperatingFeeUsdc: sumUsdc(operatingGroups.simulated),
    } : {}),
  };
}
