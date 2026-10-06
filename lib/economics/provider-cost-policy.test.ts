import { expect, it } from "vitest";
import type { LlmUsageRecord } from "../llm/reasoning-engine";
import { capturePricePolicy, FLASH_POLICY, FLASH_POLICY_2026_10_06, usageCostBounds } from "./provider-cost-policy";
import { HISTORICAL_TOKEN_RATES_V1, HISTORICAL_ECONOMICS_POLICY_V1, calculateTestnetEconomics, economicsRunSample } from "./testnet-economics";
import type { QueryRun } from "../types";

const usage = (model = "deepseek-v4-flash"): LlmUsageRecord => ({
  callId: "synthetic-local-call", engine: `llm:deepseek:${model}`, model,
  inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 500_000,
  costCapture: { provider: "deepseek", requestStartedAt: "2026-09-30T01:59:59.000Z",
    responseReceivedAt: "2026-09-30T02:00:01.000Z", pricing: model.startsWith("deepseek")
      ? structuredClone({ ...FLASH_POLICY, wireModel: model }) : null },
});
it("appends the dated canary observation without rewriting captured Flash history", () => {
  expect(capturePricePolicy("deepseek", "deepseek-v4-flash")).toEqual({ ...FLASH_POLICY_2026_10_06, wireModel: "deepseek-v4-flash" });
  expect(FLASH_POLICY.observedAt).toBe("2026-09-30");
  expect(FLASH_POLICY.id).toBe("deepseek-flash-observed-2026-09-30-v1");
  expect(usageCostBounds(usage())).toEqual({ lower: 0.41325, upper: 0.8265 });
  const fresh = usage();
  fresh.costCapture = { provider: "deepseek", requestStartedAt: "2026-10-06T10:00:00.000Z",
    responseReceivedAt: "2026-10-06T10:00:01.000Z", pricing: capturePricePolicy("deepseek", fresh.model) };
  expect(usageCostBounds(fresh)).toEqual({ lower: 0.41325, upper: 0.8265 });
  expect(Math.ceil((32_000 + 4096) * FLASH_POLICY_2026_10_06.upperRates.inputUsdPerMillion +
    8192 * FLASH_POLICY_2026_10_06.upperRates.outputUsdPerMillion)).toBe(20660);
});
const run = (record: LlmUsageRecord): QueryRun => ({
  id: "synthetic-policy-run", question: "Synthetic policy fixture", budget: 0,
  subClaims: [], decisions: [], citations: [], answer: "Synthetic answer", totalSpent: 0,
  totalToCreators: 0, trace: [], createdAt: "2026-09-30T02:00:02Z", researchMode: "quick", engine: record.engine,
  reasoningAttempts: [{ engine: record.engine, step: "decompose", tier: 0, attempt: 1, outcome: "served", startedAt: 0, durationMs: 1 }],
  llmCalls: [{ id: record.callId ?? "missing-correlation", engine: record.engine, outcome: "returned" }], llmUsage: [record],
});

it.each(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])(
  "retains the wire alias and estimates the documented Flash interval: %s", (model) => {
    const record = usage(model);
    expect(record.costCapture!.pricing).toMatchObject({ wireModel: model, billingFamily: "DeepSeek-V4.1-Flash",
      id: FLASH_POLICY.id, observedAt: "2026-09-30", effectiveFrom: null, effectiveUntil: null,
      window: "offpeak-peak-interval" });
    expect(usageCostBounds(record)).toEqual({ lower: 0.41325, upper: 0.8265 });
    // Changing a caller-owned clone cannot alter the frozen observation used by later calls.
    Object.assign(record.costCapture!.pricing!.lowerRates, { outputUsdPerMillion: 999 });
    expect(usageCostBounds(record)).toBeNull();
    expect(usageCostBounds(usage(model))).toEqual({ lower: 0.41325, upper: 0.8265 });
  },
);

it("keeps unknown provider/model, Pro, missing cache and malformed captures unpriced", () => {
  for (const model of ["deepseek-v4-pro", "unknown"]) expect(usageCostBounds(usage(model))).toBeNull();
  expect(capturePricePolicy("mimo", "deepseek-flash")).toBeNull();
  expect(capturePricePolicy(undefined, "deepseek-flash")).toBeNull();
  const record = usage();
  for (const candidate of [
    { ...record, costCapture: undefined }, { ...record, cachedInputTokens: null },
    { ...record, costCapture: { ...record.costCapture!, provider: "mimo" } },
    { ...record, costCapture: { ...record.costCapture!, requestStartedAt: "2026-08-29T00:00:00Z" } },
    { ...record, costCapture: { ...record.costCapture!, responseReceivedAt: "invalid" } },
    { ...record, costCapture: { ...record.costCapture!, responseReceivedAt: "2026-09-30T01:00:00Z" } },
    { ...record, costCapture: { ...record.costCapture!, pricing: { ...record.costCapture!.pricing!, id: "unknown-policy" } } },
    { ...record, costCapture: { ...record.costCapture!, pricing: { ...record.costCapture!.pricing!, wireModel: "other-model" } } },
  ]) expect(usageCostBounds(candidate)).toBeNull();
});

it("preserves historical v1 as a scenario and never infers a capture for history", () => {
  expect(HISTORICAL_ECONOMICS_POLICY_V1.id).toBe("testnet-economics-v1");
  expect(HISTORICAL_TOKEN_RATES_V1["deepseek-v4-flash"]).toEqual({ inputUsdPerMillion: 0.14, cachedInputUsdPerMillion: 0.0028, outputUsdPerMillion: 0.28 });
  const historical = usage(); delete historical.costCapture;
  const sample = economicsRunSample(run(historical))!;
  expect(sample.llmUsage![0]).not.toHaveProperty("costCapture");
  for (const now of [new Date("2026-08-29"), new Date("2027-01-01")]) {
    expect(calculateTestnetEconomics([JSON.parse(JSON.stringify(sample))], [], now)).toMatchObject({
      pricedRuns: 0, unpricedRuns: 1, estimatedLlmCostUsdBounds: null, shadowGrossMarginUsdBounds: null,
      pricingPolicyIds: [], totalLlmCostUpperBoundUsd: null,
    });
  }
});

it("retains exact JSON policy/counters and nested isolation through the compact projection", () => {
  const measured = run(usage()), sample = economicsRunSample(measured)!;
  expect(JSON.parse(JSON.stringify(sample)).llmUsage).toEqual(measured.llmUsage);
  Object.assign(sample.llmUsage![0].costCapture!.pricing!.upperRates, { outputUsdPerMillion: 99 });
  expect(usageCostBounds(measured.llmUsage![0])).toEqual({ lower: 0.41325, upper: 0.8265 });
  const persisted = JSON.parse(JSON.stringify(economicsRunSample(measured)));
  expect(calculateTestnetEconomics([persisted], [], new Date("2027-01-01"))).toMatchObject({ pricedRuns: 1, pricingPolicyIds: [FLASH_POLICY.id] });
});

it("labels finite bounds as a priced subset when other calls/history remain unknown", () => {
  const unknown = usage(); unknown.cachedInputTokens = null;
  const snapshot = calculateTestnetEconomics([economicsRunSample(run(usage()))!, economicsRunSample(run(unknown))!, { id: "unsampled" }], []);
  expect(snapshot).toMatchObject({ pricedRuns: 1, unpricedRuns: 1, unknownCacheCalls: 1,
    cachedInputTokens: 250_000, costAndMarginScope: "priced-runs-only", totalLlmCostUpperBoundUsd: null,
    shadowServiceFeesAllSampledUsdc: 0.04, shadowServiceFeesPricedRunsUsdc: 0.02 });
  expect(snapshot.estimatedLlmCostUsdBounds).toEqual({ lower: 0.41325, upper: 0.8265 });
  expect(snapshot.shadowGrossMarginUsdBounds).toEqual({ lower: expect.closeTo(-0.8115, 5), upper: expect.closeTo(-0.39825, 5) });
});

it("does not round tiny interval costs inward", () => {
  const tiny = { ...usage(), inputTokens: 0, cachedInputTokens: 0, outputTokens: 1 };
  expect(calculateTestnetEconomics([economicsRunSample(run(tiny))!], []).estimatedLlmCostUsdBounds)
    .toEqual({ lower: 0, upper: 0.000002 });
});
