import type { PaymentRecord, PaymentSettlementStatus, QueryRun, ResearchMode } from "../types";
import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { cloneUsage, usageCostBounds, type CostBounds } from "./provider-cost-policy";

/** Historical scenario identity only. Never applied implicitly to newly generated reports. */
export const HISTORICAL_ECONOMICS_POLICY_V1 = {
  id: "testnet-economics-v1",
  capturedAt: "2026-08-29",
  pricingSource: "https://api-docs.deepseek.com/quick_start/pricing",
  infraAllowanceUsdPerRun: 0.005,
  serviceFeeUsdc: {
    quick: config.a2aFeeUsdc,
    deep: config.a2aDeepFeeUsdc,
  } satisfies Record<ResearchMode, number>,
} as const;

export const HISTORICAL_TOKEN_RATES_V1 = {
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
} as const;

export const ECONOMICS_POLICY = {
  ...HISTORICAL_ECONOMICS_POLICY_V1,
  id: "testnet-economics-v2",
  capturedAt: "2026-09-30",
  pricingSource: "https://api-docs.deepseek.com/quick_start/pricing/",
  costBasis: "immutable-per-call-policy-interval",
} as const;

export const MAINNET_ECONOMICS_POLICY = { ...ECONOMICS_POLICY, id: "mainnet-economics-v1" } as const;

export interface EconomicsPaymentRow {
  network?: string;
  txHash?: string | null;
  queryId: string;
  kind: PaymentRecord["kind"];
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
> & { usageCoverage?: "complete" | "unknown"; usageCoverageVersion?: 2 };

/** Require one valid usage record for every completed instrumented call. */
function completeUsage(run: Partial<QueryRun>): boolean {
  // New recovery counters cannot erase the first failed execution's unknown bill.
  if (run.originalFulfillment?.originalProviderBilling === "unknown") return false;
  if (!Array.isArray(run.reasoningAttempts) || !Array.isArray(run.llmUsage)) return false;
  const realAttempts = run.reasoningAttempts.filter(
    (attempt) => attempt.engine !== "heuristic" && attempt.outcome !== "circuit-open" && attempt.outcome !== "input-limited",
  );
  if (realAttempts.some((attempt) => attempt.outcome !== "served")) return false;
  if (realAttempts.length === 0 && run.llmUsage.length === 0 && !run.llmCalls?.length) {
    return run.engine === "heuristic" || run.reasoningAttempts.some(
      (attempt) => attempt.engine === "heuristic" && attempt.outcome === "served",
    );
  }
  if (!Array.isArray(run.llmCalls) || run.llmCalls.length !== run.llmUsage.length) return false;
  if (realAttempts.length === 0) return false;
  const calls = new Map<string, string>();
  for (const call of run.llmCalls) {
    if (!call.id || calls.has(call.id) || call.outcome !== "returned") return false;
    calls.set(call.id, call.engine);
  }
  if (realAttempts.some((attempt) => !run.llmCalls!.some((call) => call.engine === attempt.engine))) return false;
  for (const usage of run.llmUsage) {
    if (!usage.callId || calls.get(usage.callId) !== usage.engine) return false;
    calls.delete(usage.callId);
  }
  return calls.size === 0;
}

/** Compact DB projection. Historical unsampled runs remain NULL instead of being reconstructed. */
export function economicsRunSample(run: QueryRun): EconomicsRunSample | null {
  if (!Array.isArray(run.llmUsage)) return null;
  return {
    id: run.id,
    researchMode: run.researchMode,
    fundingOwner: run.fundingOwner,
    llmUsage: run.llmUsage.map(cloneUsage),
    usageCoverage: completeUsage(run) ? "complete" : "unknown",
    usageCoverageVersion: 2,
  };
}

export interface EconomicsSnapshot {
  label: "testnet-observatory" | "mainnet-observatory";
  network?: "eip155:5042002" | "eip155:5042";
  policy: typeof ECONOMICS_POLICY | typeof MAINNET_ECONOMICS_POLICY;
  generatedAt: string;
  sampledRuns: number;
  pricedRuns: number;
  unpricedRuns: number;
  providerCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  unknownCacheCalls: number;
  outputTokens: number;
  /** Partial totals for pricedRuns only; null when there are no eligible runs. */
  estimatedLlmCostUsdBounds: CostBounds | null;
  shadowServiceFeesAllSampledUsdc: number;
  shadowServiceFeesPricedRunsUsdc: number;
  shadowGrossMarginUsdBounds: CostBounds | null;
  pricingPolicyIds: string[];
  costAndMarginScope: "priced-runs-only";
  /** The store projection omits unsampled history and is not complete billing accounting. */
  totalLlmCostUpperBoundUsd: null;
  settledInboundRevenueUsdc: number;
  /** Keryx-sponsored owner transfer, separate from external revenue and creator spend. */
  settledOperatingFeeUsdc: number;
  pendingOperatingFeeUsdc: number;
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

export interface TestnetEconomicsSnapshot extends EconomicsSnapshot {
  label: "testnet-observatory";
  policy: typeof ECONOMICS_POLICY;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Display rounding must not narrow an estimate interval, including tiny token costs. */
function roundBounds(bounds: CostBounds): CostBounds {
  return { lower: Math.floor(bounds.lower * 1_000_000) / 1_000_000,
    upper: Math.ceil(bounds.upper * 1_000_000) / 1_000_000 };
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
  runs: (Partial<QueryRun> & Pick<EconomicsRunSample, "usageCoverage" | "usageCoverageVersion">)[],
  payments: EconomicsPaymentRow[],
  now = new Date(),
  a2aOrders: EconomicsA2aOrderRow[] = [],
): TestnetEconomicsSnapshot {
  return calculateEconomics(ARC_TESTNET_PROFILE, runs, payments, now, a2aOrders) as TestnetEconomicsSnapshot;
}

export function calculateEconomics(
  profile: ArcNetworkProfile,
  runs: (Partial<QueryRun> & Pick<EconomicsRunSample, "usageCoverage" | "usageCoverageVersion">)[],
  payments: EconomicsPaymentRow[],
  now = new Date(),
  a2aOrders: EconomicsA2aOrderRow[] = [],
): EconomicsSnapshot {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Economics profile refused");
  if (!profile.testnet && payments.some(payment => payment.network !== profile.networkId ||
    (payment.settled && payment.settlementStatus === "settled" &&
      (typeof payment.txHash !== "string" || !payment.txHash.trim()))))
    throw new Error("Mainnet economics requires original-network rows and recorded settlement evidence");
  const policy = profile.testnet ? ECONOMICS_POLICY : MAINNET_ECONOMICS_POLICY;
  const sampled = runs.filter((run) => Array.isArray(run.llmUsage));
  const ownerByQuery = new Map(runs.map((run) => [String(run.id), fundingOwner(run)]));
  let pricedRuns = 0;
  const estimatedLlmCostUsdBounds = { lower: 0, upper: 0 };
  let shadowServiceFeesAllSampledUsdc = 0;
  let shadowServiceFeesPricedRunsUsdc = 0;
  const shadowGrossMarginUsdBounds = { lower: 0, upper: 0 };
  let providerCalls = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let unknownCacheCalls = 0;
  let outputTokens = 0;
  const unpricedModels = new Set<string>();
  const pricingPolicyIds = new Set<string>();

  for (const run of sampled) {
    const usage = run.llmUsage ?? [];
    const runCost = { lower: 0, upper: 0 };
    const runPolicies = new Set<string>();
    let complete = (run.usageCoverageVersion === 2 && run.usageCoverage === "complete") ||
      (run.usageCoverage === undefined && completeUsage(run));
    for (const call of usage) {
      providerCalls++;
      inputTokens += call.inputTokens;
      if (call.cachedInputTokens === null || call.cachedInputTokens === undefined) unknownCacheCalls++;
      else cachedInputTokens += call.cachedInputTokens;
      outputTokens += call.outputTokens;
      const cost = usageCostBounds(call);
      if (cost == null) {
        complete = false;
        unpricedModels.add(call.model);
      } else {
        runCost.lower += cost.lower;
        runCost.upper += cost.upper;
        runPolicies.add(call.costCapture!.pricing!.id);
      }
    }
    const fee = policy.serviceFeeUsdc[run.researchMode ?? "deep"];
    shadowServiceFeesAllSampledUsdc += fee;
    if (complete) {
      pricedRuns++;
      shadowServiceFeesPricedRunsUsdc += fee;
      estimatedLlmCostUsdBounds.lower += runCost.lower;
      estimatedLlmCostUsdBounds.upper += runCost.upper;
      shadowGrossMarginUsdBounds.lower += fee - runCost.upper - policy.infraAllowanceUsdPerRun;
      shadowGrossMarginUsdBounds.upper += fee - runCost.lower - policy.infraAllowanceUsdPerRun;
      for (const id of runPolicies) pricingPolicyIds.add(id);
    }
  }

  let settledInboundRevenueUsdc = 0;
  let settledOperatingFeeUsdc = 0;
  let pendingOperatingFeeUsdc = 0;
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
    if (payment.kind === "operating-fee") {
      if (payment.settled && payment.settlementStatus === "settled") settledOperatingFeeUsdc += payment.amountUsdc;
      else if (!payment.settled && payment.settlementStatus === "pending") pendingOperatingFeeUsdc += payment.amountUsdc;
      continue;
    }
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
    label: profile.testnet ? "testnet-observatory" : "mainnet-observatory",
    ...(!profile.testnet ? { network: profile.networkId } : {}),
    policy,
    generatedAt: now.toISOString(),
    sampledRuns: sampled.length,
    pricedRuns,
    unpricedRuns: sampled.length - pricedRuns,
    providerCalls,
    inputTokens,
    cachedInputTokens,
    unknownCacheCalls,
    outputTokens,
    estimatedLlmCostUsdBounds: pricedRuns ? roundBounds(estimatedLlmCostUsdBounds) : null,
    shadowServiceFeesAllSampledUsdc: round(shadowServiceFeesAllSampledUsdc),
    shadowServiceFeesPricedRunsUsdc: round(shadowServiceFeesPricedRunsUsdc),
    shadowGrossMarginUsdBounds: pricedRuns ? roundBounds(shadowGrossMarginUsdBounds) : null,
    pricingPolicyIds: [...pricingPolicyIds].sort(),
    costAndMarginScope: "priced-runs-only",
    totalLlmCostUpperBoundUsd: null,
    settledInboundRevenueUsdc: round(settledInboundRevenueUsdc),
    settledOperatingFeeUsdc: round(settledOperatingFeeUsdc),
    pendingOperatingFeeUsdc: round(pendingOperatingFeeUsdc),
    settledA2aV2ServiceFeesUsdc: round(settledA2aV2ServiceFeesUsdc),
    prepaidA2aCreatorCapsUsdc: round(prepaidA2aCreatorCapsUsdc),
    prepaidA2aCreatorSpendUsdc: round(prepaidA2aCreatorSpendUsdc),
    completedA2aUnusedReserveUsdc: round(completedA2aUnusedReserveUsdc),
    browserCreatorSpendUsdc: round(browserCreatorSpendUsdc),
    treasuryCreatorSubsidyUsdc: round(treasuryCreatorSubsidyUsdc),
    unknownFundingCreatorSpendUsdc: round(unknownFundingCreatorSpendUsdc),
    pendingCreatorSpendUsdc: round(pendingCreatorSpendUsdc),
    unpricedModels: [...unpricedModels].sort(),
    note: `Partial ${profile.testnet ? "testnet" : "mainnet"} telemetry and hypothetical price intervals only, not reconciled invoices or profit. Billing windows and holidays are not inferred. Shadow fees are not charged and are not revenue.`,
  };
}
