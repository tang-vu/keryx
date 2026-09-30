import type { LlmUsageRecord } from "../llm/reasoning-engine";

export interface TokenRates {
  readonly inputUsdPerMillion: number;
  readonly cachedInputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
}
export interface CostBounds { lower: number; upper: number }
export interface CapturedPricePolicy {
  readonly id: string;
  /** Date precision: the supplier page was checked on this day, not at an inferred midnight. */
  readonly observedAt: string;
  readonly source: string;
  /** Supplier effective dates are not inferred from our observation date. */
  readonly effectiveFrom: null;
  readonly effectiveUntil: null;
  readonly wireModel: string;
  readonly billingFamily: string;
  readonly window: "offpeak-peak-interval";
  readonly lowerRates: TokenRates;
  readonly upperRates: TokenRates;
}
export interface ProviderCostCapture {
  readonly provider: string;
  readonly requestStartedAt: string;
  readonly responseReceivedAt: string;
  readonly pricing: CapturedPricePolicy | null;
}

/** Append a new policy for a later supplier observation; never edit a captured policy's rates. */
export const FLASH_POLICY = Object.freeze({
  id: "deepseek-flash-observed-2026-09-30-v1",
  observedAt: "2026-09-30",
  source: "https://api-docs.deepseek.com/quick_start/pricing/",
  effectiveFrom: null, effectiveUntil: null,
  billingFamily: "DeepSeek-V4.1-Flash",
  window: "offpeak-peak-interval",
  lowerRates: Object.freeze({ cachedInputUsdPerMillion: 0.003, inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.60 }),
  upperRates: Object.freeze({ cachedInputUsdPerMillion: 0.006, inputUsdPerMillion: 0.30, outputUsdPerMillion: 1.20 }),
} as const);
const FLASH_ALIASES = new Set(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]);
// Retain entries when a future policy becomes the capture default.
const PRICE_POLICIES = new Map([[FLASH_POLICY.id as string, { policy: FLASH_POLICY, aliases: FLASH_ALIASES }]]);

/** Called before the HTTP request, not when a report is generated. No holiday/window guessing. */
export function capturePricePolicy(provider: string | undefined, wireModel: string): CapturedPricePolicy | null {
  if (provider !== "deepseek" || !FLASH_ALIASES.has(wireModel)) return null;
  return structuredClone({ ...FLASH_POLICY, wireModel });
}

/** Defensive nested copy at every engine/projection boundary. Historical fields remain absent. */
export function cloneUsage(usage: LlmUsageRecord): LlmUsageRecord {
  return structuredClone(usage);
}

export function usageCostBounds(usage: LlmUsageRecord): CostBounds | null {
  const capture = usage.costCapture, policy = capture?.pricing;
  if (!capture || capture.provider !== "deepseek" || !usage.engine.startsWith("llm:deepseek:") || !policy) return null;
  const registered = PRICE_POLICIES.get(policy.id);
  const expected = registered?.policy;
  if (!expected || !registered!.aliases.has(usage.model) || policy.wireModel !== usage.model ||
    policy.observedAt !== expected.observedAt || policy.source !== expected.source ||
    policy.billingFamily !== expected.billingFamily || policy.window !== expected.window ||
    policy.effectiveFrom !== null || policy.effectiveUntil !== null) return null;
  const start = Date.parse(capture.requestStartedAt), end = Date.parse(capture.responseReceivedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < Date.parse(policy.observedAt)) return null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (!valid(usage.inputTokens) || !valid(usage.outputTokens) || !valid(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens) return null;
  const cachedInputTokens = usage.cachedInputTokens;
  const calculate = (rates: TokenRates | undefined, known: TokenRates) => {
    if (!rates || rates.inputUsdPerMillion !== known.inputUsdPerMillion ||
      rates.cachedInputUsdPerMillion !== known.cachedInputUsdPerMillion || rates.outputUsdPerMillion !== known.outputUsdPerMillion) return null;
    return ((usage.inputTokens - cachedInputTokens) * rates.inputUsdPerMillion +
      cachedInputTokens * rates.cachedInputUsdPerMillion + usage.outputTokens * rates.outputUsdPerMillion) / 1_000_000;
  };
  const lower = calculate(policy.lowerRates, expected.lowerRates), upper = calculate(policy.upperRates, expected.upperRates);
  return lower === null || upper === null ? null : { lower, upper };
}
