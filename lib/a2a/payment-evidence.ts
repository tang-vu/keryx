import { paymentSettlementStatus } from "../payments/payment-state";
import type { PaymentRecord } from "../types";
import type { A2aOrder, A2aResolutionEvidence } from "./order";

export function a2aAmountMicros(amountUsdc: number): number {
  const raw = amountUsdc * 1e6;
  const rounded = Math.round(raw);
  if (!Number.isFinite(raw) || rounded < 0 || Math.abs(raw - rounded) > 1e-6) {
    throw new Error("creator payment amount is not exact non-negative micro-USDC");
  }
  return rounded;
}

export function creatorResolutionEvidence(
  order: Pick<
    A2aOrder,
    "executionJournalVersion" | "paymentStartedAt" | "resultSavingAt"
  >,
  attempts: PaymentRecord[],
  queryRunFound: boolean,
): A2aResolutionEvidence {
  const evidence: A2aResolutionEvidence = {
    executionJournalVersion: order.executionJournalVersion,
    paymentBoundaryCrossed: order.paymentStartedAt !== null,
    resultSaveBoundaryCrossed: order.resultSavingAt !== null,
    creatorAttempts: attempts.length,
    settledCreatorMicros: 0,
    pendingCreatorMicros: 0,
    failedCreatorMicros: 0,
    simulatedCreatorMicros: 0,
    queryRunFound,
  };
  for (const attempt of attempts) {
    const micros = a2aAmountMicros(attempt.amountUsdc);
    switch (paymentSettlementStatus(attempt)) {
      case "settled":
        evidence.settledCreatorMicros += micros;
        break;
      case "pending":
        evidence.pendingCreatorMicros += micros;
        break;
      case "failed":
        evidence.failedCreatorMicros += micros;
        break;
      case "simulated":
        evidence.simulatedCreatorMicros += micros;
        break;
      default:
        throw new Error("creator payment has an unknown settlement state");
    }
  }
  return evidence;
}
