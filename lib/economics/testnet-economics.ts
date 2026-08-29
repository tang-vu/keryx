import type { LlmUsageRecord } from "../llm/reasoning-engine";
import type { PaymentSettlementStatus, QueryRun, ResearchMode } from "../types";
import { config } from "../config";

export const ECONOMICS_POLICY = {
  id: "testnet-economics-v1",
  capturedAt: "2026-08-29",
  pricingSource: "https://api-docs.deepseek.com/quick_start/pricing",
  infraAllowanceUsdPerRun: 0.005,
  serviceFeeUsdc: {
    quick: config.a2aFeeUsdc,
    deep: config.a2aDeepFeeUsdc,
  } satisfies Record<ResearchMode, number>,
} as const;

interface TokenRates {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

const TOKEN_RATES: Record<string, TokenRates> = {
  "deepseek-v4-flash": {
    inputUsdPerMillion: 0.14,
    cachedInputUsdPerMillion: 0.0028,
    outputUsdPerMillion: 0.28,
  },
  "deepseek-v4-pro": {
    inputUsdPerMillion: 0.435,
    cachedInputUsdPerMillion: 0.003625,
    outputUsdPerMillion: 0.87,
  },
};

export interface EconomicsPaymentRow {
  queryId: string;
  kind: "fetch" | "citation" | "inbound";
  amountUsdc: number;
  settled: boolean;
  settlementStatus?: PaymentSettlementStatus | null;
  grantEpoch?: string | null;
}

export interface EconomicsA2aOrderRow {
  queryId: string;
  creatorBudgetUsdc: number;
  serviceFeeUsdc: number;
  status: "running" | "completed" | "failed";
  response?: Record<string, unknown> | null;
}

export type EconomicsRunSample = Pick<
  QueryRun,
  "id" | "researchMode" | "fundingOwner" | "llmUsage"
>;

/** Compact DB projection. Historical unsampled runs remain NULL instead of being reconstructed. */
export function economicsRunSample(run: QueryRun): EconomicsRunSample | null {
  if (!Array.isArray(run.llmUsage)) return null;
  return {
    id: run.id,
    researchMode: run.researchMode,
    fundingOwner: run.fundingOwner,
    llmUsage: run.llmUsage,
  };
}

export interface TestnetEconomicsSnapshot {
  label: "testnet-observatory";
  policy: typeof ECONOMICS_POLICY;
  generatedAt: string;
  sampledRuns: number;
  pricedRuns: number;
  unpricedRuns: number;
  providerCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedLlmCostUsd: number;
  shadowServiceFeesUsdc: number;
  shadowGrossMarginUsd: number;
  settledInboundRevenueUsdc: number;
  settledA2aV2ServiceFeesUsdc: number;
  prepaidA2aCreatorCapsUsdc: number;
  prepaidA2aCreatorSpendUsdc: number;
  completedA2aUnusedReserveUsdc: number;
  browserCreatorSpendUsdc: number;
  treasuryCreatorSubsidyUsdc: number;
  unknownFundingCreatorSpendUsdc: number;
  pendingCreatorSpendUsdc: number;
  unpricedModels: string[];
  note: string;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function usageCost(usage: LlmUsageRecord): number | null {
  if (!usage.engine.startsWith("llm:deepseek:")) return null;
  const rates = TOKEN_RATES[usage.model];
  if (!rates) return null;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncached = Math.max(0, usage.inputTokens - cached);
  return (
    uncached * rates.inputUsdPerMillion +
    cached * rates.cachedInputUsdPerMillion +
    usage.outputTokens * rates.outputUsdPerMillion
  ) / 1_000_000;
}

function fundingOwner(run: Partial<QueryRun>): QueryRun["fundingOwner"] | "unknown" {
  if (run.fundingOwner) return run.fundingOwner;
  if (run.askerFunded === true) return "browser";
  return "unknown";
}

/**
 * Economics is an observer only: payment truth comes from the settled ledger; provider cost comes
 * from sampled counters. Historical and unknown-price data stays explicitly incomplete.
 */
export function calculateTestnetEconomics(
  runs: Partial<QueryRun>[],
  payments: EconomicsPaymentRow[],
  now = new Date(),
  a2aOrders: EconomicsA2aOrderRow[] = [],
): TestnetEconomicsSnapshot {
  const sampled = runs.filter((run) => Array.isArray(run.llmUsage));
  const ownerByQuery = new Map(runs.map((run) => [String(run.id), fundingOwner(run)]));
  let pricedRuns = 0;
  let estimatedLlmCostUsd = 0;
  let shadowServiceFeesUsdc = 0;
  let shadowGrossMarginUsd = 0;
  let providerCalls = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  const unpricedModels = new Set<string>();

  for (const run of sampled) {
    const usage = run.llmUsage ?? [];
    let runCost = 0;
    let complete = true;
    for (const call of usage) {
      providerCalls++;
      inputTokens += call.inputTokens;
      cachedInputTokens += call.cachedInputTokens;
      outputTokens += call.outputTokens;
      const cost = usageCost(call);
      if (cost == null) {
        complete = false;
        unpricedModels.add(call.model);
      } else {
        runCost += cost;
      }
    }
    const fee = ECONOMICS_POLICY.serviceFeeUsdc[run.researchMode ?? "deep"];
    shadowServiceFeesUsdc += fee;
    if (complete) {
      pricedRuns++;
      estimatedLlmCostUsd += runCost;
      shadowGrossMarginUsd += fee - runCost - ECONOMICS_POLICY.infraAllowanceUsdPerRun;
    }
  }

  let settledInboundRevenueUsdc = 0;
  let settledA2aV2ServiceFeesUsdc = 0;
  let prepaidA2aCreatorCapsUsdc = 0;
  let prepaidA2aCreatorSpendUsdc = 0;
  let completedA2aUnusedReserveUsdc = 0;
  let browserCreatorSpendUsdc = 0;
  let treasuryCreatorSubsidyUsdc = 0;
  let unknownFundingCreatorSpendUsdc = 0;
  let pendingCreatorSpendUsdc = 0;
  const settledInboundQueries = new Set<string>();
  const a2aOrderByQuery = new Map(a2aOrders.map((order) => [order.queryId, order]));
  const committedA2aCreatorSpendByQuery = new Map<string, number>();
  for (const payment of payments) {
    if (payment.kind === "inbound") {
      if (payment.settled && payment.settlementStatus === "settled") {
        settledInboundRevenueUsdc += payment.amountUsdc;
        settledInboundQueries.add(payment.queryId);
      }
      continue;
    }
    const isA2aCreatorPayment = a2aOrderByQuery.has(payment.queryId);
    if (
      isA2aCreatorPayment &&
      (payment.settlementStatus === "settled" || payment.settlementStatus === "pending")
    ) {
      committedA2aCreatorSpendByQuery.set(
        payment.queryId,
        (committedA2aCreatorSpendByQuery.get(payment.queryId) ?? 0) + payment.amountUsdc,
      );
    }
    if (!payment.settled) {
      if (payment.settlementStatus === "pending") pendingCreatorSpendUsdc += payment.amountUsdc;
      continue;
    }
    if (payment.settlementStatus !== "settled") continue;
    if (isA2aCreatorPayment) {
      prepaidA2aCreatorSpendUsdc += payment.amountUsdc;
      continue;
    }
    const owner = payment.grantEpoch
      ? "browser"
      : (ownerByQuery.get(payment.queryId) ?? "unknown");
    if (owner === "browser") browserCreatorSpendUsdc += payment.amountUsdc;
    else if (owner === "treasury") treasuryCreatorSubsidyUsdc += payment.amountUsdc;
    else if (owner !== "offline") unknownFundingCreatorSpendUsdc += payment.amountUsdc;
  }
  for (const order of a2aOrders) {
    if (!settledInboundQueries.has(order.queryId)) continue;
    settledA2aV2ServiceFeesUsdc += order.serviceFeeUsdc;
    prepaidA2aCreatorCapsUsdc += order.creatorBudgetUsdc;
    if (order.status !== "completed") continue;
    const committed = committedA2aCreatorSpendByQuery.get(order.queryId) ?? 0;
    completedA2aUnusedReserveUsdc += Math.max(0, order.creatorBudgetUsdc - committed);
  }

  return {
    label: "testnet-observatory",
    policy: ECONOMICS_POLICY,
    generatedAt: now.toISOString(),
    sampledRuns: sampled.length,
    pricedRuns,
    unpricedRuns: sampled.length - pricedRuns,
    providerCalls,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    estimatedLlmCostUsd: round(estimatedLlmCostUsd),
    shadowServiceFeesUsdc: round(shadowServiceFeesUsdc),
    shadowGrossMarginUsd: round(shadowGrossMarginUsd),
    settledInboundRevenueUsdc: round(settledInboundRevenueUsdc),
    settledA2aV2ServiceFeesUsdc: round(settledA2aV2ServiceFeesUsdc),
    prepaidA2aCreatorCapsUsdc: round(prepaidA2aCreatorCapsUsdc),
    prepaidA2aCreatorSpendUsdc: round(prepaidA2aCreatorSpendUsdc),
    completedA2aUnusedReserveUsdc: round(completedA2aUnusedReserveUsdc),
    browserCreatorSpendUsdc: round(browserCreatorSpendUsdc),
    treasuryCreatorSubsidyUsdc: round(treasuryCreatorSubsidyUsdc),
    unknownFundingCreatorSpendUsdc: round(unknownFundingCreatorSpendUsdc),
    pendingCreatorSpendUsdc: round(pendingCreatorSpendUsdc),
    unpricedModels: [...unpricedModels].sort(),
    note: "Testnet telemetry and hypothetical pricing only. Shadow fees are not charged and are not revenue.",
  };
}
