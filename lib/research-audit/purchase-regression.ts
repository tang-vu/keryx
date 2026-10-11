import { auditArray, auditObject } from "./input-contract";

/**
 * Pooled purchase-score summary and a release comparison over two such summaries.
 *
 * Pure arithmetic over already scored observations. It reads nothing, spends nothing and
 * cannot decide what the acceptable margin is: the caller must state every margin and the
 * minimum sample explicitly, and too small a sample is "not evaluable", never a pass.
 */
export const PURCHASE_SCORE_BANDS = 5;
export const MAX_POOLED_PURCHASES = 100_000;
export interface PurchaseObservation { expectedValue: number; cited: boolean }
export interface PurchaseScoreBand {
  lower: number; upper: number; samples: number; cited: number;
  predictedMean: number | null; citationRate: number | null;
}
export interface PurchaseScoreSummary {
  scoredPurchases: number;
  citedPurchases: number;
  hitRate: number | null;
  calibration: PurchaseScoreBand[];
  /** Sample-weighted mean |predicted mean - citation rate| over non-empty bands. Descriptive only. */
  calibrationGap: number | null;
}
const TOLERANCE = 1e-9;
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_POOLED_PURCHASES;
const close = (a: number | null, b: number | null) => a === null || b === null ? a === b : Math.abs(a - b) <= TOLERANCE;
/** Same comparisons as the per-dispatch scorer, so a boundary value can never land in two different bands. */
function bandOf(expectedValue: number): number {
  for (let index = 0; index < PURCHASE_SCORE_BANDS - 1; index++) if (expectedValue < (index + 1) / PURCHASE_SCORE_BANDS) return index;
  return PURCHASE_SCORE_BANDS - 1;
}

function gapOf(bands: readonly PurchaseScoreBand[], total: number): number | null {
  if (!total) return null;
  return bands.reduce((sum, band) => band.samples ? sum + band.samples * Math.abs(band.predictedMean! - band.citationRate!) : sum, 0) / total;
}

/** Each observation counts once; banding matches the per-dispatch scorer (the top band includes 1). */
export function summarizePurchaseScores(observations: readonly PurchaseObservation[]): PurchaseScoreSummary {
  auditArray(observations, MAX_POOLED_PURCHASES);
  const sums = Array.from({ length: PURCHASE_SCORE_BANDS }, () => ({ samples: 0, cited: 0, predicted: 0 }));
  for (const row of observations) {
    auditObject(row);
    if (!unit(row.expectedValue) || typeof row.cited !== "boolean") throw new Error("Invalid purchase observation");
    const band = sums[bandOf(row.expectedValue)];
    band.samples++; band.predicted += row.expectedValue; if (row.cited) band.cited++;
  }
  const calibration = sums.map((band, index) => ({ lower: index / PURCHASE_SCORE_BANDS, upper: (index + 1) / PURCHASE_SCORE_BANDS,
    samples: band.samples, cited: band.cited,
    predictedMean: band.samples ? Math.min(1, band.predicted / band.samples) : null,
    citationRate: band.samples ? band.cited / band.samples : null }));
  const scoredPurchases = observations.length, citedPurchases = sums.reduce((sum, band) => sum + band.cited, 0);
  return { scoredPurchases, citedPurchases, hitRate: scoredPurchases ? citedPurchases / scoredPurchases : null,
    calibration, calibrationGap: gapOf(calibration, scoredPurchases) };
}

/** Closed validation of a supplied summary: every derived figure must follow from its counts. */
export function parsePurchaseScoreSummary(value: unknown): PurchaseScoreSummary {
  auditObject(value);
  const names = ["scoredPurchases", "citedPurchases", "hitRate", "calibration", "calibrationGap"];
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new Error("Invalid score summary");
  const { scoredPurchases, citedPurchases, hitRate, calibrationGap } = value;
  auditArray(value.calibration, PURCHASE_SCORE_BANDS);
  if (!count(scoredPurchases) || !count(citedPurchases) || citedPurchases > scoredPurchases
    || value.calibration.length !== PURCHASE_SCORE_BANDS) throw new Error("Invalid score summary");
  const calibration = value.calibration.map((raw, index) => {
    auditObject(raw);
    const fields = ["lower", "upper", "samples", "cited", "predictedMean", "citationRate"];
    if (Object.keys(raw).length !== fields.length || fields.some(name => !Object.hasOwn(raw, name))) throw new Error("Invalid score band");
    const { samples, cited, predictedMean, citationRate } = raw;
    const lower = index / PURCHASE_SCORE_BANDS, upper = (index + 1) / PURCHASE_SCORE_BANDS;
    if (raw.lower !== lower || raw.upper !== upper || !count(samples) || !count(cited) || cited > samples) throw new Error("Invalid score band");
    if (samples === 0 ? predictedMean !== null || citationRate !== null
      : !unit(predictedMean) || !unit(citationRate) || !close(citationRate, cited / samples)
        || predictedMean < lower - TOLERANCE || predictedMean > upper + TOLERANCE) throw new Error("Invalid score band");
    return { lower, upper, samples, cited, predictedMean: predictedMean as number | null, citationRate: citationRate as number | null };
  });
  if (calibration.reduce((sum, band) => sum + band.samples, 0) !== scoredPurchases
    || calibration.reduce((sum, band) => sum + band.cited, 0) !== citedPurchases
    || !(hitRate === null || unit(hitRate)) || !close(hitRate as number | null, scoredPurchases ? citedPurchases / scoredPurchases : null)
    || !(calibrationGap === null || unit(calibrationGap)) || !close(calibrationGap as number | null, gapOf(calibration, scoredPurchases)))
    throw new Error("Invalid score summary");
  return { scoredPurchases, citedPurchases, hitRate: hitRate as number | null, calibration, calibrationGap: calibrationGap as number | null };
}

export interface RegressionMargins {
  /** Largest tolerated absolute fall in hit rate, as a fraction of 1 (0.05 = five points). */
  maxHitRateDrop: number;
  /** Largest tolerated absolute rise in the calibration gap. */
  maxCalibrationGapRise: number;
  /** Both samples must hold at least this many scored purchases to be compared at all. */
  minScoredPurchases: number;
}
export type RegressionReason = "baseline-sample-too-small" | "candidate-sample-too-small" | "hit-rate-fell" | "calibration-gap-rose";
export interface RegressionResult {
  schemaVersion: "keryx-purchase-regression-v1";
  status: "pass" | "flagged" | "not-evaluable";
  reasons: RegressionReason[];
  margins: RegressionMargins;
  baseline: Pick<PurchaseScoreSummary, "scoredPurchases" | "citedPurchases" | "hitRate" | "calibrationGap">;
  candidate: Pick<PurchaseScoreSummary, "scoredPurchases" | "citedPurchases" | "hitRate" | "calibrationGap">;
  hitRateChange: number | null;
  calibrationGapChange: number | null;
}

/**
 * Flag a candidate whose hit rate fell or whose calibration gap rose beyond the stated margins.
 * No significance test is applied: the caller chooses margins and a minimum sample that
 * already allow for sampling noise. Citation occurrence is not expert-judged usefulness.
 */
export function comparePurchaseScores(baselineInput: unknown, candidateInput: unknown, margins: RegressionMargins): RegressionResult {
  auditObject(margins);
  if (Object.keys(margins).sort().join() !== "maxCalibrationGapRise,maxHitRateDrop,minScoredPurchases"
    || !unit(margins.maxHitRateDrop) || !unit(margins.maxCalibrationGapRise)
    || !Number.isSafeInteger(margins.minScoredPurchases) || margins.minScoredPurchases < 1
    || margins.minScoredPurchases > MAX_POOLED_PURCHASES) throw new Error("Explicit regression margins required");
  const baseline = parsePurchaseScoreSummary(baselineInput), candidate = parsePurchaseScoreSummary(candidateInput);
  const brief = ({ scoredPurchases, citedPurchases, hitRate, calibrationGap }: PurchaseScoreSummary) =>
    ({ scoredPurchases, citedPurchases, hitRate, calibrationGap });
  const reasons: RegressionReason[] = [];
  if (baseline.scoredPurchases < margins.minScoredPurchases) reasons.push("baseline-sample-too-small");
  if (candidate.scoredPurchases < margins.minScoredPurchases) reasons.push("candidate-sample-too-small");
  const result = { schemaVersion: "keryx-purchase-regression-v1" as const, margins: { ...margins },
    baseline: brief(baseline), candidate: brief(candidate) };
  if (reasons.length) return { ...result, status: "not-evaluable", reasons, hitRateChange: null, calibrationGapChange: null };
  const hitRateChange = candidate.hitRate! - baseline.hitRate!, calibrationGapChange = candidate.calibrationGap! - baseline.calibrationGap!;
  if (-hitRateChange > margins.maxHitRateDrop + TOLERANCE) reasons.push("hit-rate-fell");
  if (calibrationGapChange > margins.maxCalibrationGapRise + TOLERANCE) reasons.push("calibration-gap-rose");
  return { ...result, status: reasons.length ? "flagged" : "pass", reasons, hitRateChange, calibrationGapChange };
}
