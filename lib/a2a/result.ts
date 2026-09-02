import { a2aReceiptEconomics, type A2aQuote } from "./pricing";
import type { A2aOrder } from "./order";
import type { QueryRun } from "../types";
import type { PaymentRecord } from "../types";
import { creatorResolutionEvidence } from "./payment-evidence";
import {
  completedA2aServiceReceipt,
  isSupportedA2aResearchPackage,
} from "./research-package";

export function quoteFromA2aOrder(order: A2aOrder): A2aQuote {
  return {
    policy: "a2a-fixed-package-v2",
    researchMode: order.researchMode,
    researchPackage: order.researchPackage,
    creatorBudgetUsdc: order.creatorBudgetUsdc,
    serviceFeeUsdc: order.serviceFeeUsdc,
    totalPriceUsdc: order.amountUsdc,
    refundable: false,
  };
}

export function a2aResponseFromRun(
  run: QueryRun,
  quote: A2aQuote,
  timing?: { acceptedAt: string; startedAt: string | null; baseUrl?: string },
) {
  if (run.paymentMode !== "real") {
    throw new Error("paid A2A research did not use the real treasury gateway");
  }
  const researchPackage = quote.researchPackage;
  const packageReceipt =
    timing && isSupportedA2aResearchPackage(researchPackage, quote.researchMode)
      ? {
          researchPackage,
          serviceReceipt: completedA2aServiceReceipt({
            researchPackage,
            acceptedAt: timing.acceptedAt,
            startedAt: timing.startedAt,
            run,
            baseUrl: timing.baseUrl,
          }),
        }
      : {};
  return {
    status: "completed",
    queryId: run.id,
    answer: run.answer,
    citations: run.citations.map((citation) => ({
      source: citation.sourceName,
      weight: citation.weight,
      reward: citation.reward,
    })),
    evidence: (run.evidence ?? []).filter((item) => item.qualifiesForReward),
    claimCoverage: run.claimCoverage ?? [],
    creatorsPaid: run.citations.length,
    totalToCreators: run.totalToCreators,
    feePaid: quote.serviceFeeUsdc,
    totalPricePaid: quote.totalPriceUsdc,
    pricing: a2aReceiptEconomics(quote, run.totalToCreators, run.pendingSpendUsdc ?? 0),
    engine: run.engine,
    ...packageReceipt,
  } satisfies Record<string, unknown>;
}

export function currentA2aEconomics(order: A2aOrder, attempts: PaymentRecord[]) {
  const evidence = creatorResolutionEvidence(order, attempts, false);
  const settled = evidence.settledCreatorMicros / 1e6;
  const pending = evidence.pendingCreatorMicros / 1e6;
  return {
    totalToCreators: settled,
    pricing: a2aReceiptEconomics(quoteFromA2aOrder(order), settled, pending),
    creatorPayments: {
      attempts: evidence.creatorAttempts,
      failedUsdc: evidence.failedCreatorMicros / 1e6,
      simulatedUsdc: evidence.simulatedCreatorMicros / 1e6,
    },
  };
}

export function publicA2aResolution(order: A2aOrder) {
  const resolved = order.resolution;
  if (!resolved) return undefined;
  return {
    action: resolved.action,
    actor: resolved.actor,
    reason: resolved.reason,
    resolvedAt: resolved.resolvedAt,
    evidence: {
      executionJournalVersion: resolved.evidence.executionJournalVersion,
      paymentBoundaryCrossed: resolved.evidence.paymentBoundaryCrossed,
      resultSaveBoundaryCrossed: resolved.evidence.resultSaveBoundaryCrossed,
      creatorAttempts: resolved.evidence.creatorAttempts,
      settledCreatorSpendUsdc: resolved.evidence.settledCreatorMicros / 1e6,
      pendingCreatorSpendUsdc: resolved.evidence.pendingCreatorMicros / 1e6,
      failedCreatorSpendUsdc: resolved.evidence.failedCreatorMicros / 1e6,
      simulatedCreatorSpendUsdc: resolved.evidence.simulatedCreatorMicros / 1e6,
      queryRunFound: resolved.evidence.queryRunFound,
    },
  };
}
