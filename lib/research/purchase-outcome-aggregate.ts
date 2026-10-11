import { z } from "zod";
import { parsePurchaseScoreSummary, summarizePurchaseScores, PURCHASE_SCORE_BANDS,
  type PurchaseScoreSummary } from "../research-audit/purchase-regression";
import { usageWindowSchema, type UsageWindow } from "../usage/contracts";
import type { RecordedPurchaseOutcomes } from "./purchase-outcomes-contract";

/**
 * Pooled purchase outcomes for one network and UTC period, split by recorded cohort.
 *
 * Pure: every figure is recomputed from per-dispatch observations that were already scored
 * against recorded citations and settlements. The sample, period and counting rule travel
 * with the figures. Nothing here reads a source, spends, or infers a cohort or question type.
 */
export const PURCHASE_AGGREGATE_COHORTS = ["outside", "team", "scripted", "unknown"] as const;
export type PurchaseAggregateCohort = typeof PURCHASE_AGGREGATE_COHORTS[number];
export const PURCHASE_AGGREGATE_SAMPLE_LIMIT = 100;
/** Machine-readable counting rules. The public page states the same rules in its message catalogue. */
export const PURCHASE_AGGREGATE_RULES = Object.freeze({
  sample: "newest recorded runs per cohort created in the network and UTC interval, at most the stated limit per cohort; older runs in the period are outside the sample",
  cohort: "write-time recorded cohort only; absent or malformed history stays unknown and is never counted as outside use",
  scoredPurchase: "one per run and exact source, item and content version with a BUY decision and positive matching recorded settled access in the retained trace",
  hitRate: "scored purchases with a recorded exact-version citation divided by scored purchases; a citation is observed use, not an expert quality verdict",
  uncitedAccess: "exact micro-USDC sum of recorded settled access for scored purchases without an exact-version citation; descriptive, not causal regret",
  calibration: "five equal bands of recorded predicted value compared with citation occurrence; predicted value is not assumed to be a probability",
  calibrationGap: "sample-weighted mean absolute difference between band predicted mean and band citation rate; null without scored purchases",
  decisionBasis: "recorded decisions carrying a valid structured planning basis divided by recorded decisions in the sampled runs",
  settlement: "recorded bookkeeping in the retained trace; not re-verified against Circle or the chain; pending, simulated and failed rows excluded",
  unmeasured: "missed value, cost per supported claim and question-type splits are not measured: no counterfactual reads, expert claim review or recorded question type exist",
});

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const micros = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const unit = z.number().finite().min(0).max(1);
const time = z.string().datetime({ offset: true }).max(64);
const band = z.object({ lower: unit, upper: unit, samples: count, cited: count,
  predictedMean: unit.nullable(), citationRate: unit.nullable() }).strict();
const column = z.object({
  cohort: z.enum(PURCHASE_AGGREGATE_COHORTS),
  windowRuns: count, sampledRuns: count.max(PURCHASE_AGGREGATE_SAMPLE_LIMIT), sampleComplete: z.boolean(), unscorableRuns: count,
  sampleFirstRunAt: time.nullable(), sampleLastRunAt: time.nullable(),
  recordedDecisions: count, decisionsWithBasis: count,
  recordedBuyDecisions: count, unscoredBuyDecisions: count,
  scoredPurchases: count, citedPurchases: count, hitRate: unit.nullable(),
  settledAccessMicros: micros, uncitedAccessMicros: micros, settledRewardMicros: micros,
  calibration: z.array(band).length(PURCHASE_SCORE_BANDS), calibrationGap: unit.nullable(),
}).strict();
export const purchaseAggregateSchema = z.object({
  schemaVersion: z.literal("keryx-purchase-outcome-aggregate-v1"),
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  period: z.enum(["all", "7d", "30d", "custom"]), since: time, until: time,
  basis: z.literal("newest-recorded-runs-per-cohort"),
  sampleLimitPerCohort: z.literal(PURCHASE_AGGREGATE_SAMPLE_LIMIT),
  settlementEvidence: z.literal("recorded-only-not-revalidated"),
  coverage: z.literal("partial-retained-trace"),
  columns: z.array(column).length(PURCHASE_AGGREGATE_COHORTS.length),
  missedValue: z.null(), costPerSupportedClaim: z.null(), byQuestionType: z.null(),
  rules: z.object(Object.fromEntries(Object.keys(PURCHASE_AGGREGATE_RULES).map(key => [key, z.string().min(1).max(400)])) as
    Record<keyof typeof PURCHASE_AGGREGATE_RULES, z.ZodString>).strict(),
}).strict();
export type PurchaseOutcomeAggregate = z.infer<typeof purchaseAggregateSchema>;
export type PurchaseAggregateColumn = PurchaseOutcomeAggregate["columns"][number];

export interface AggregateRun {
  id: string;
  createdAt: string;
  recordedDecisions: number;
  decisionsWithBasis: number;
  /** Null when the retained record could not be scored; counted, never read as a zero-cost success. */
  report: RecordedPurchaseOutcomes | null;
}
export interface AggregateCohortInput { cohort: PurchaseAggregateCohort; windowRuns: number; runs: readonly AggregateRun[] }

function scoreOf(row: PurchaseAggregateColumn): PurchaseScoreSummary {
  return { scoredPurchases: row.scoredPurchases, citedPurchases: row.citedPurchases, hitRate: row.hitRate,
    calibration: row.calibration, calibrationGap: row.calibrationGap };
}

/** Derived bindings a schema cannot express. Authenticity and current settlement are not asserted. */
export function validatePurchaseAggregate(value: unknown): PurchaseOutcomeAggregate {
  const report = purchaseAggregateSchema.parse(value);
  usageWindowSchema.parse({ network: report.network, since: report.since, until: report.until, period: report.period });
  report.columns.forEach((row, index) => {
    parsePurchaseScoreSummary(scoreOf(row));
    if (row.cohort !== PURCHASE_AGGREGATE_COHORTS[index] || row.sampledRuns > row.windowRuns
      || row.sampleComplete !== (row.sampledRuns === row.windowRuns) || row.unscorableRuns > row.sampledRuns
      || row.decisionsWithBasis > row.recordedDecisions || row.recordedBuyDecisions > row.recordedDecisions
      || row.recordedBuyDecisions !== row.scoredPurchases + row.unscoredBuyDecisions
      || BigInt(row.uncitedAccessMicros) > BigInt(row.settledAccessMicros)
      || (row.scoredPurchases === 0) !== (row.settledAccessMicros === "0")
      || row.citedPurchases === row.scoredPurchases && row.uncitedAccessMicros !== "0"
      || row.citedPurchases < row.scoredPurchases && row.uncitedAccessMicros === "0"
      || (row.sampledRuns === 0) !== (row.sampleFirstRunAt === null) || (row.sampledRuns === 0) !== (row.sampleLastRunAt === null)
      || row.sampleFirstRunAt !== null && (row.sampleFirstRunAt > row.sampleLastRunAt!
        || row.sampleFirstRunAt < report.since || row.sampleLastRunAt! >= report.until))
      throw new Error("Aggregate bindings refused");
  });
  if (JSON.stringify(report.rules) !== JSON.stringify(PURCHASE_AGGREGATE_RULES)) throw new Error("Aggregate rules refused");
  return report;
}

export function aggregatePurchaseOutcomes(input: { window: UsageWindow; cohorts: readonly AggregateCohortInput[] }): PurchaseOutcomeAggregate {
  const window = usageWindowSchema.parse(input.window), seen = new Set<string>();
  if (input.cohorts.length !== PURCHASE_AGGREGATE_COHORTS.length) throw new Error("Every cohort column is required");
  const columns = input.cohorts.map((group, index): PurchaseAggregateColumn => {
    if (group.cohort !== PURCHASE_AGGREGATE_COHORTS[index] || group.runs.length > PURCHASE_AGGREGATE_SAMPLE_LIMIT)
      throw new Error("Invalid cohort sample");
    let recordedDecisions = 0, decisionsWithBasis = 0, recordedBuyDecisions = 0, unscoredBuyDecisions = 0, unscorableRuns = 0;
    let access = BigInt(0), uncited = BigInt(0), rewards = BigInt(0);
    const observations: Array<{ expectedValue: number; cited: boolean }> = [], times: string[] = [];
    for (const run of group.runs) {
      // A run is one sample in exactly one cohort; a repeated identity would count its purchases twice.
      if (seen.has(run.id) || run.createdAt < window.since || run.createdAt >= window.until) throw new Error("Ambiguous sampled run");
      seen.add(run.id); times.push(run.createdAt);
      recordedDecisions += run.recordedDecisions; decisionsWithBasis += run.decisionsWithBasis;
      if (!run.report) { unscorableRuns++; continue; }
      if (run.report.dispatchId !== run.id || run.report.network !== window.network || run.report.runCreatedAt !== run.createdAt)
        throw new Error("Sampled outcome does not match its run");
      recordedBuyDecisions += run.report.counts.recordedBuyDecisions; unscoredBuyDecisions += run.report.counts.unscoredBuyDecisions;
      for (const purchase of run.report.purchases) {
        observations.push({ expectedValue: purchase.expectedValue, cited: purchase.cited });
        access += BigInt(purchase.settledAccessMicros); rewards += BigInt(purchase.settledRewardMicros);
        if (!purchase.cited) uncited += BigInt(purchase.settledAccessMicros);
      }
    }
    times.sort();
    // The run count and the sample are separate reads; a run saved between them can only add to the period.
    const windowRuns = Math.max(group.windowRuns, group.runs.length);
    return { cohort: group.cohort, windowRuns, sampledRuns: group.runs.length, sampleComplete: group.runs.length === windowRuns,
      unscorableRuns, sampleFirstRunAt: times[0] ?? null, sampleLastRunAt: times.at(-1) ?? null,
      recordedDecisions, decisionsWithBasis, recordedBuyDecisions, unscoredBuyDecisions,
      ...summarizePurchaseScores(observations), settledAccessMicros: access.toString(),
      uncitedAccessMicros: uncited.toString(), settledRewardMicros: rewards.toString() };
  });
  return validatePurchaseAggregate({ schemaVersion: "keryx-purchase-outcome-aggregate-v1", network: window.network,
    period: window.period, since: window.since, until: window.until, basis: "newest-recorded-runs-per-cohort",
    sampleLimitPerCohort: PURCHASE_AGGREGATE_SAMPLE_LIMIT, settlementEvidence: "recorded-only-not-revalidated",
    coverage: "partial-retained-trace", columns, missedValue: null, costPerSupportedClaim: null, byQuestionType: null,
    rules: { ...PURCHASE_AGGREGATE_RULES } });
}

/** The pooled score of one cohort, in the shape the release comparison consumes. */
export function cohortPurchaseScore(report: PurchaseOutcomeAggregate, cohort: PurchaseAggregateCohort): PurchaseScoreSummary {
  return scoreOf(report.columns[PURCHASE_AGGREGATE_COHORTS.indexOf(cohort)]);
}
