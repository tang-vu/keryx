import { PURCHASE_AGGREGATE_COHORTS, PURCHASE_AGGREGATE_RULES, PURCHASE_AGGREGATE_SAMPLE_LIMIT } from "./purchase-outcome-aggregate";

const count = { type: "integer", minimum: 0 };
const weight = { type: "number", minimum: 0, maximum: 1 };
const optionalWeight = { ...weight, type: ["number", "null"] };
const micros = { type: "string", pattern: "^(0|[1-9][0-9]{0,29})$", description: "Exact integer micro-USDC, never floating-point totals." };
const time = { type: "string", format: "date-time", maxLength: 64 };
const optionalTime = { ...time, type: ["string", "null"] };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const purchaseOutcomeAggregateOpenApiPath = { get: {
  operationId: "getPooledPurchaseOutcomes", summary: "Read pooled recorded purchase outcomes by cohort", security: [],
  description: "Public, read-only. Pools the exact-version per-dispatch purchase scores of the newest recorded runs per cohort in one network and UTC period. Every figure carries its sample, period and counting rule. Outcomes come from recorded citations and retained settled payment observations, never from the model's account of itself; settlement is recorded bookkeeping and is not re-verified. Cohorts are write-time records: unknown history stays unknown and is never outside use. Uncited access cost is descriptive, not causal regret. Missed value, cost per supported claim and question-type splits are null because no counterfactual reads, expert claim review or recorded question type exist. No source fetch, provider call or payment is made.",
  parameters: [
    { in: "query", name: "network", schema: { type: "string", enum: ["eip155:5042", "eip155:5042002"] }, description: "Defaults to the deployment network." },
    { in: "query", name: "period", schema: { type: "string", enum: ["all", "7d", "30d"] }, description: "Rolling window ending now; default all." },
    { in: "query", name: "since", schema: { type: "string", format: "date" }, description: "UTC start date, only with period=all. Unknown or repeated arguments refuse." }],
  responses: { "200": { description: "Bounded pooled observation; always no-store.", content: { "application/json": {
    schema: object({ schemaVersion: { const: "keryx-purchase-outcome-aggregate-v1" },
      network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] }, period: { type: "string", enum: ["all", "7d", "30d", "custom"] },
      since: time, until: { ...time, description: "Exclusive end of the interval and the time the figures were built." },
      basis: { const: "newest-recorded-runs-per-cohort" }, sampleLimitPerCohort: { const: PURCHASE_AGGREGATE_SAMPLE_LIMIT },
      settlementEvidence: { const: "recorded-only-not-revalidated" }, coverage: { const: "partial-retained-trace" },
      columns: { type: "array", minItems: PURCHASE_AGGREGATE_COHORTS.length, maxItems: PURCHASE_AGGREGATE_COHORTS.length, items: object({
        cohort: { type: "string", enum: [...PURCHASE_AGGREGATE_COHORTS] }, windowRuns: count,
        sampledRuns: { ...count, maximum: PURCHASE_AGGREGATE_SAMPLE_LIMIT }, sampleComplete: { type: "boolean" }, unscorableRuns: count,
        sampleFirstRunAt: optionalTime, sampleLastRunAt: optionalTime, recordedDecisions: count, decisionsWithBasis: count,
        recordedBuyDecisions: count, unscoredBuyDecisions: count, scoredPurchases: count, citedPurchases: count, hitRate: optionalWeight,
        settledAccessMicros: micros, uncitedAccessMicros: micros, settledRewardMicros: micros,
        calibration: { type: "array", minItems: 5, maxItems: 5, items: object({ lower: weight, upper: weight, samples: count, cited: count,
          predictedMean: optionalWeight, citationRate: optionalWeight }) }, calibrationGap: optionalWeight }) },
      missedValue: { type: "null" }, costPerSupportedClaim: { type: "null" }, byQuestionType: { type: "null" },
      rules: object(Object.fromEntries(Object.entries(PURCHASE_AGGREGATE_RULES).map(([key, rule]) => [key, { const: rule }]))),
    }),
  } } }, "400": { description: "Invalid filter; no storage read" },
    "503": { description: "Uniform unavailable; figures withheld, no private diagnostics and nothing inferred from the failure" } },
} };
