import { a2aReceiptEconomics, type A2aQuote } from "./pricing";
import type { A2aOrder } from "./order";
import type { QueryRun } from "../types";

export function quoteFromA2aOrder(order: A2aOrder): A2aQuote {
  return {
    policy: "a2a-fixed-package-v2",
    researchMode: order.researchMode,
    creatorBudgetUsdc: order.creatorBudgetUsdc,
    serviceFeeUsdc: order.serviceFeeUsdc,
    totalPriceUsdc: order.amountUsdc,
    refundable: false,
  };
}

export function a2aResponseFromRun(run: QueryRun, quote: A2aQuote) {
  if (run.paymentMode !== "real") {
    throw new Error("paid A2A research did not use the real treasury gateway");
  }
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
  } satisfies Record<string, unknown>;
}
