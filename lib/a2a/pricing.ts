import { config } from "../config";
import type { ResearchMode } from "../types";

const MICROS = 1_000_000;

export interface A2aQuote {
  policy: "a2a-fixed-package-v2";
  researchMode: ResearchMode;
  creatorBudgetUsdc: number;
  serviceFeeUsdc: number;
  totalPriceUsdc: number;
  refundable: false;
}

function positiveMicros(value: number): number {
  return Math.max(1, Math.round(value * MICROS));
}

export function parseResearchMode(value: unknown): ResearchMode {
  return value === "quick" ? "quick" : "deep";
}

export function quoteA2aResearch(rawBudget: unknown, mode: ResearchMode): A2aQuote {
  const requested =
    typeof rawBudget === "number" && Number.isFinite(rawBudget) && rawBudget > 0
      ? rawBudget
      : config.defaultBudget;
  const creatorBudgetMicros = Math.min(
    positiveMicros(config.a2aMaxBudget),
    positiveMicros(requested),
  );
  const serviceFeeMicros = positiveMicros(
    mode === "quick" ? config.a2aFeeUsdc : config.a2aDeepFeeUsdc,
  );
  return {
    policy: "a2a-fixed-package-v2",
    researchMode: mode,
    creatorBudgetUsdc: creatorBudgetMicros / MICROS,
    serviceFeeUsdc: serviceFeeMicros / MICROS,
    totalPriceUsdc: (creatorBudgetMicros + serviceFeeMicros) / MICROS,
    refundable: false,
  };
}

export function a2aReceiptEconomics(
  quote: A2aQuote,
  settledCreatorSpendUsdc: number,
  pendingCreatorSpendUsdc = 0,
) {
  const budgetMicros = Math.round(quote.creatorBudgetUsdc * MICROS);
  const settledMicros = Math.round(settledCreatorSpendUsdc * MICROS);
  const pendingMicros = Math.round(pendingCreatorSpendUsdc * MICROS);
  if (
    !Number.isFinite(settledCreatorSpendUsdc) ||
    !Number.isFinite(pendingCreatorSpendUsdc) ||
    settledMicros < 0 ||
    pendingMicros < 0 ||
    settledMicros + pendingMicros > budgetMicros
  ) {
    throw new Error("creator spend exceeded the prepaid A2A cap");
  }
  return {
    ...quote,
    settledCreatorSpendUsdc: settledMicros / MICROS,
    pendingCreatorSpendUsdc: pendingMicros / MICROS,
    unusedCreatorReserveUsdc: (budgetMicros - settledMicros - pendingMicros) / MICROS,
  };
}
