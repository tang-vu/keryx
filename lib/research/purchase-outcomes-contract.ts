import { z } from "zod";
import { boundedPortableCopy } from "./bounded-portable-json";

export const PURCHASE_OUTCOMES_MAX_BYTES = 1024 * 1024;
export const purchaseOutcomeId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const purchaseOutcomeNetwork = z.enum(["eip155:5042", "eip155:5042002"]);
export type PurchaseOutcomeNetwork = z.infer<typeof purchaseOutcomeNetwork>;
export const outcomeIdentifier = z.string().min(1).max(256).refine(value =>
  value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value));
const weight = z.number().finite().min(0).max(1);
const count = z.number().int().min(0).max(512);
const micros = z.string().regex(/^(0|[1-9]\d{0,29})$/);
const time = z.string().datetime({ offset: true }).max(64);
export const purchaseArchive = z.object({
  network: z.literal("eip155:5042002"), label: z.literal("Arc testnet"), capturedAt: time,
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const observation = z.object({
  sourceId: outcomeIdentifier, assetId: outcomeIdentifier, itemId: outcomeIdentifier,
  contentVersion: outcomeIdentifier, expectedValue: weight, settledAccessMicros: micros,
  cited: z.boolean(), contributionWeight: weight, settledRewardMicros: micros,
}).strict();
export const purchaseOutcomesSchema = z.object({
  schemaVersion: z.literal("keryx-purchase-outcomes-v1"), dispatchId: purchaseOutcomeId,
  network: purchaseOutcomeNetwork, runCreatedAt: time,
  basis: z.literal("retained-dispatch-trace-exact-version"),
  settlementEvidence: z.literal("recorded-only-not-revalidated"),
  coverage: z.literal("partial-retained-trace"),
  cohort: z.literal("unknown"), archive: purchaseArchive.nullable(),
  counts: z.object({ recordedBuyDecisions: count, scoredPurchases: count, citedPurchases: count,
    unscoredBuyDecisions: count, tracePaymentObservations: count, excludedPaymentObservations: count }).strict(),
  purchases: z.array(observation).max(512), hitRate: weight.nullable(), uncitedAccessMicros: micros,
  calibration: z.array(z.object({ lower: weight, upper: weight, samples: count,
    predictedMean: weight.nullable(), citationRate: weight.nullable() }).strict()).length(5),
  missedValue: z.null(), costPerSupportedClaim: z.null(),
}).strict();
export type RecordedPurchaseOutcomes = z.infer<typeof purchaseOutcomesSchema>;

/** Validate portable responses and all derived counting/sample bindings. No origin,
 * authenticity, current settlement or causal value is asserted by this check. */
export function validatePurchaseOutcomes(value: unknown, expectedId?: string): RecordedPurchaseOutcomes {
  const report = purchaseOutcomesSchema.parse(boundedPortableCopy(value, PURCHASE_OUTCOMES_MAX_BYTES));
  const { counts, purchases } = report;
  if (expectedId !== undefined && report.dispatchId !== purchaseOutcomeId.parse(expectedId)
    || report.archive && report.network !== report.archive.network
    || counts.scoredPurchases !== purchases.length
    || counts.citedPurchases !== purchases.filter(row => row.cited).length
    || counts.recordedBuyDecisions !== counts.scoredPurchases + counts.unscoredBuyDecisions
    || counts.excludedPaymentObservations > counts.tracePaymentObservations
    || report.hitRate !== (purchases.length ? counts.citedPurchases / purchases.length : null)
    || report.uncitedAccessMicros !== purchases.filter(row => !row.cited)
      .reduce((sum, row) => sum + BigInt(row.settledAccessMicros), BigInt(0)).toString()) throw new Error("Outcome bindings refused");
  const identities = new Set<string>();
  for (const row of purchases) {
    const identity = JSON.stringify([row.sourceId, row.itemId, row.contentVersion]);
    if (identities.has(identity) || row.settledAccessMicros === "0" || !row.cited && row.contributionWeight !== 0)
      throw new Error("Outcome identity refused");
    identities.add(identity);
  }
  report.calibration.forEach((band, index) => {
    const lower = index / 5, upper = (index + 1) / 5;
    const rows = purchases.filter(row => row.expectedValue >= lower && (index === 4 ? row.expectedValue <= upper : row.expectedValue < upper));
    if (band.lower !== lower || band.upper !== upper || band.samples !== rows.length
      || band.predictedMean !== (rows.length ? rows.reduce((sum, row) => sum + row.expectedValue, 0) / rows.length : null)
      || band.citationRate !== (rows.length ? rows.filter(row => row.cited).length / rows.length : null))
      throw new Error("Outcome sample binding refused");
  });
  return report;
}
