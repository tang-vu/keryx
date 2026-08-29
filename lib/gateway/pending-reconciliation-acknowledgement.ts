import crypto from "node:crypto";
import type { PaymentRecord } from "../types";

export const PENDING_RECONCILIATION_ACK_STATE_KEY =
  "pendingPaymentReconciliationAcknowledgements";
export const LEGACY_TREASURY_ACK_MIN_AGE_MS = 24 * 60 * 60 * 1_000;

export interface PendingReconciliationAcknowledgement {
  schemaVersion: 1;
  paymentId: string;
  authorizationId: string;
  treasuryPayer: string;
  economicTupleHash: string;
  acknowledgedAt: string;
  circleCheckedAt: string;
  evidencePolicy: "circle-x402-cursor-complete-v1";
  circleCandidateCount: number;
  reason: string;
}

interface PendingReconciliationAcknowledgementStore {
  schemaVersion: 1;
  acknowledgements: PendingReconciliationAcknowledgement[];
}

function atomicUsdc(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const atomic = Math.round(amount * 1_000_000);
  return Math.abs(amount - atomic / 1_000_000) <= 1e-10 ? atomic : null;
}

export function pendingPaymentTupleHash(payment: PaymentRecord): string {
  const amount = atomicUsdc(payment.amountUsdc);
  if (!payment.id || !payment.authorizationId || amount === null) {
    throw new Error("pending payment lacks a stable economic tuple");
  }
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        paymentId: payment.id,
        authorizationId: payment.authorizationId.toLowerCase(),
        payer: payment.payer.toLowerCase(),
        payee: payment.payee.toLowerCase(),
        network: payment.network,
        amountMicroUsdc: amount,
      }),
    )
    .digest("hex");
}

/** Acknowledgement is deliberately narrower than reconciliation: browser capacity and rows with
 * exact signed expiry always remain alertable until Circle supplies terminal evidence. */
export function isLegacyTreasuryAcknowledgementEligible(
  payment: PaymentRecord,
  treasuryPayer: string | null | undefined,
  now = Date.now(),
): boolean {
  const createdAt = Date.parse(payment.createdAt);
  return (
    !!payment.id &&
    !!payment.authorizationId &&
    !!treasuryPayer &&
    payment.payer.toLowerCase() === treasuryPayer.toLowerCase() &&
    payment.settled === false &&
    payment.settlementStatus === "pending" &&
    !payment.grantEpoch &&
    !payment.authorizationExpiresAt &&
    Number.isFinite(createdAt) &&
    now - createdAt >= LEGACY_TREASURY_ACK_MIN_AGE_MS
  );
}

export function createPendingReconciliationAcknowledgement(
  payment: PaymentRecord,
  input: {
    treasuryPayer: string;
    reason: string;
    circleCheckedAt: string;
    circleCandidateCount: number;
    now?: Date;
  },
): PendingReconciliationAcknowledgement {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (!isLegacyTreasuryAcknowledgementEligible(payment, input.treasuryPayer, now.getTime())) {
    throw new Error("only critical legacy treasury pending rows may be acknowledged");
  }
  if (reason.length < 20 || reason.length > 500) {
    throw new Error("acknowledgement reason must contain 20 to 500 characters");
  }
  if (!Number.isFinite(Date.parse(input.circleCheckedAt))) {
    throw new Error("acknowledgement requires a valid Circle check timestamp");
  }
  if (!Number.isInteger(input.circleCandidateCount) || input.circleCandidateCount < 0) {
    throw new Error("acknowledgement requires the complete Circle candidate count");
  }
  return {
    schemaVersion: 1,
    paymentId: payment.id!,
    authorizationId: payment.authorizationId!,
    treasuryPayer: input.treasuryPayer,
    economicTupleHash: pendingPaymentTupleHash(payment),
    acknowledgedAt: now.toISOString(),
    circleCheckedAt: new Date(input.circleCheckedAt).toISOString(),
    evidencePolicy: "circle-x402-cursor-complete-v1",
    circleCandidateCount: input.circleCandidateCount,
    reason,
  };
}

export function isAcknowledgedLegacyTreasuryPending(
  payment: PaymentRecord,
  acknowledgements: PendingReconciliationAcknowledgement[],
  treasuryPayer: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!isLegacyTreasuryAcknowledgementEligible(payment, treasuryPayer, now)) return false;
  return acknowledgements.some(
    (acknowledgement) =>
      acknowledgement.paymentId === payment.id &&
      acknowledgement.treasuryPayer.toLowerCase() === treasuryPayer!.toLowerCase() &&
      acknowledgement.authorizationId.toLowerCase() === payment.authorizationId!.toLowerCase() &&
      acknowledgement.economicTupleHash === pendingPaymentTupleHash(payment),
  );
}

export function parsePendingReconciliationAcknowledgements(
  raw: string | null,
): PendingReconciliationAcknowledgement[] {
  const decoded = decodePendingReconciliationAcknowledgements(raw);
  return decoded.valid ? decoded.acknowledgements : [];
}

export function decodePendingReconciliationAcknowledgements(raw: string | null): {
  valid: boolean;
  acknowledgements: PendingReconciliationAcknowledgement[];
} {
  if (!raw) return { valid: true, acknowledgements: [] };
  try {
    const store = JSON.parse(raw) as Partial<PendingReconciliationAcknowledgementStore>;
    if (
      store.schemaVersion !== 1 ||
      !Array.isArray(store.acknowledgements) ||
      !store.acknowledgements.every(isAcknowledgement)
    ) {
      return { valid: false, acknowledgements: [] };
    }
    const paymentIds = new Set(store.acknowledgements.map((row) => row.paymentId));
    if (paymentIds.size !== store.acknowledgements.length) {
      return { valid: false, acknowledgements: [] };
    }
    return { valid: true, acknowledgements: store.acknowledgements };
  } catch {
    return { valid: false, acknowledgements: [] };
  }
}

export function serializePendingReconciliationAcknowledgements(
  acknowledgements: PendingReconciliationAcknowledgement[],
): string {
  return JSON.stringify({ schemaVersion: 1, acknowledgements });
}

export function addPendingReconciliationAcknowledgementOnce(
  existing: PendingReconciliationAcknowledgement[],
  next: PendingReconciliationAcknowledgement,
): {
  acknowledgements: PendingReconciliationAcknowledgement[];
  acknowledgement: PendingReconciliationAcknowledgement;
  created: boolean;
} {
  const prior = existing.find((candidate) => candidate.paymentId === next.paymentId);
  if (!prior) {
    return {
      acknowledgements: [...existing, next],
      acknowledgement: next,
      created: true,
    };
  }
  if (
    prior.authorizationId.toLowerCase() !== next.authorizationId.toLowerCase() ||
    prior.economicTupleHash !== next.economicTupleHash
  ) {
    throw new Error("existing acknowledgement conflicts with the current economic tuple");
  }
  return { acknowledgements: existing, acknowledgement: prior, created: false };
}

function isAcknowledgement(value: unknown): value is PendingReconciliationAcknowledgement {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.schemaVersion === 1 &&
    typeof row.paymentId === "string" &&
    typeof row.authorizationId === "string" &&
    typeof row.treasuryPayer === "string" &&
    typeof row.economicTupleHash === "string" &&
    /^[a-f0-9]{64}$/.test(row.economicTupleHash) &&
    typeof row.acknowledgedAt === "string" &&
    Number.isFinite(Date.parse(row.acknowledgedAt)) &&
    typeof row.circleCheckedAt === "string" &&
    Number.isFinite(Date.parse(row.circleCheckedAt)) &&
    row.evidencePolicy === "circle-x402-cursor-complete-v1" &&
    typeof row.circleCandidateCount === "number" &&
    Number.isInteger(row.circleCandidateCount) &&
    row.circleCandidateCount >= 0 &&
    typeof row.reason === "string" &&
    row.reason.length >= 20 &&
    row.reason.length <= 500
  );
}
