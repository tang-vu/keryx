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
  readonly window: "offpeak-peak-interval" | "published-token-rate";
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
/** Published gross tariff, not an invoice: free daily Neurons and other account usage are unknown. */
export const CLOUDFLARE_POLICY = Object.freeze({
  id: "cloudflare-llama-3.3-observed-2026-10-02-v1",
  observedAt: "2026-10-02",
  source: "https://developers.cloudflare.com/workers-ai/platform/pricing/",
  effectiveFrom: null, effectiveUntil: null,
  billingFamily: "Llama-3.3-70B-Instruct-FP8-fast",
  window: "published-token-rate",
  lowerRates: Object.freeze({ cachedInputUsdPerMillion: 0.293, inputUsdPerMillion: 0.293, outputUsdPerMillion: 2.253 }),
  upperRates: Object.freeze({ cachedInputUsdPerMillion: 0.293, inputUsdPerMillion: 0.293, outputUsdPerMillion: 2.253 }),
} as const);
const CLOUDFLARE_ALIASES = new Set(["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
/** Official gross tariff observed for the experimental manual choice; invoice/Neurons unknown. */
export const CLOUDFLARE_GPT_OSS_POLICY = Object.freeze({
  id: "cloudflare-gpt-oss-120b-observed-2026-10-08-v1",
  observedAt: "2026-10-08",
  source: "https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/",
  effectiveFrom: null, effectiveUntil: null,
  billingFamily: "GPT-OSS-120B",
  window: "published-token-rate",
  lowerRates: Object.freeze({ cachedInputUsdPerMillion: 0.35, inputUsdPerMillion: 0.35, outputUsdPerMillion: 0.75 }),
  upperRates: Object.freeze({ cachedInputUsdPerMillion: 0.35, inputUsdPerMillion: 0.35, outputUsdPerMillion: 0.75 }),
} as const);
/** Fresh official observation for the finite business canary. Keep the earlier
 * Flash policy unchanged so retained v1/v2 reservations and captures still validate. */
export const FLASH_POLICY_2026_10_06 = Object.freeze({
  id: "deepseek-flash-observed-2026-10-06-v1",
  observedAt: "2026-10-06",
  source: "https://api-docs.deepseek.com/quick_start/pricing/",
  effectiveFrom: null, effectiveUntil: null,
  billingFamily: "DeepSeek-V4.1-Flash",
  window: "offpeak-peak-interval",
  lowerRates: Object.freeze({ cachedInputUsdPerMillion: 0.003, inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.60 }),
  upperRates: Object.freeze({ cachedInputUsdPerMillion: 0.006, inputUsdPerMillion: 0.30, outputUsdPerMillion: 1.20 }),
} as const);
// Retain entries when a future policy becomes the capture default.
const PRICE_POLICIES = new Map<string, { provider: string; policy: Omit<CapturedPricePolicy, "wireModel">; aliases: Set<string> }>([
  [FLASH_POLICY.id, { provider: "deepseek", policy: FLASH_POLICY, aliases: FLASH_ALIASES }],
  [CLOUDFLARE_POLICY.id, { provider: "cloudflare", policy: CLOUDFLARE_POLICY, aliases: CLOUDFLARE_ALIASES }],
  [CLOUDFLARE_GPT_OSS_POLICY.id, { provider: "cloudflare", policy: CLOUDFLARE_GPT_OSS_POLICY, aliases: new Set(["@cf/openai/gpt-oss-120b"]) }],
  [FLASH_POLICY_2026_10_06.id, { provider: "deepseek", policy: FLASH_POLICY_2026_10_06, aliases: FLASH_ALIASES }],
]);

/** Called before the HTTP request, not when a report is generated. No holiday/window guessing. */
export function capturePricePolicy(provider: string | undefined, wireModel: string): CapturedPricePolicy | null {
  // Newly appended observations become capture defaults; prior entries still validate history.
  const entry = [...PRICE_POLICIES.values()].reverse().find(value => value.provider === provider && value.aliases.has(wireModel));
  return entry ? structuredClone({ ...entry.policy, wireModel }) : null;
}

/** Defensive nested copy at every engine/projection boundary. Historical fields remain absent. */
export function cloneUsage(usage: LlmUsageRecord): LlmUsageRecord {
  return structuredClone(usage);
}

export function usageCostBounds(usage: LlmUsageRecord): CostBounds | null {
  const capture = usage.costCapture, policy = capture?.pricing;
  if (!capture || !usage.engine.startsWith(`llm:${capture.provider}:`) || !policy) return null;
  const registered = PRICE_POLICIES.get(policy.id);
  const expected = registered?.policy;
  if (!expected || capture.provider !== registered!.provider || !registered!.aliases.has(usage.model) || policy.wireModel !== usage.model ||
    policy.observedAt !== expected.observedAt || policy.source !== expected.source ||
    policy.billingFamily !== expected.billingFamily || policy.window !== expected.window ||
    policy.effectiveFrom !== null || policy.effectiveUntil !== null) return null;
  const start = Date.parse(capture.requestStartedAt), end = Date.parse(capture.responseReceivedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < Date.parse(policy.observedAt)) return null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const cacheInsensitive = expected.lowerRates.cachedInputUsdPerMillion === expected.lowerRates.inputUsdPerMillion &&
    expected.upperRates.cachedInputUsdPerMillion === expected.upperRates.inputUsdPerMillion;
  if (!valid(usage.inputTokens) || !valid(usage.outputTokens) ||
    (usage.cachedInputTokens === null ? !cacheInsensitive : !valid(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens)) return null;
  // No cache split is invented; equal gross rates make the split irrelevant to this calculation.
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const calculate = (rates: TokenRates | undefined, known: TokenRates) => {
    if (!rates || rates.inputUsdPerMillion !== known.inputUsdPerMillion ||
      rates.cachedInputUsdPerMillion !== known.cachedInputUsdPerMillion || rates.outputUsdPerMillion !== known.outputUsdPerMillion) return null;
    return ((usage.inputTokens - cachedInputTokens) * rates.inputUsdPerMillion +
      cachedInputTokens * rates.cachedInputUsdPerMillion + usage.outputTokens * rates.outputUsdPerMillion) / 1_000_000;
  };
  const lower = calculate(policy.lowerRates, expected.lowerRates), upper = calculate(policy.upperRates, expected.upperRates);
  return lower === null || upper === null ? null : { lower, upper };
}
