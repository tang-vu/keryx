import { z } from "zod";
import { scorePurchases } from "../research-audit/purchase-outcomes";
import type { Decision, PaymentRecord, QueryRun } from "../types";
import { boundedPortableCopy } from "./bounded-portable-json";
import { outcomeIdentifier, PURCHASE_OUTCOMES_MAX_BYTES, purchaseArchive, purchaseOutcomeId,
  purchaseOutcomeNetwork, validatePurchaseOutcomes } from "./purchase-outcomes-contract";

const identity = { sourceId: outcomeIdentifier, itemId: outcomeIdentifier.optional(), contentVersion: outcomeIdentifier.optional() };
const decision = z.object({ ...identity, assetId: outcomeIdentifier.optional(), action: z.enum(["BUY", "SKIP", "CACHE"]),
  expectedValue: z.number().finite().min(0).max(1), price: z.number().finite().nonnegative() });
const citation = z.object({ ...identity, weight: z.number().finite().min(0).max(1) });
const payment = z.object({ ...identity, id: outcomeIdentifier.optional(), kind: z.enum(["fetch", "citation"]),
  queryId: outcomeIdentifier, network: outcomeIdentifier, amountUsdc: z.number().finite(), settled: z.boolean(),
  settlementStatus: z.enum(["settled", "simulated", "pending", "failed"]).optional(),
  txHash: outcomeIdentifier.nullable().optional(), payer: outcomeIdentifier.optional(), payee: outcomeIdentifier.optional() });
const input = z.object({ id: purchaseOutcomeId, createdAt: z.string().datetime({ offset: true }).max(64),
  answer: z.string().min(1).max(500_000).refine(value => !!value.trim()),
  decisions: z.array(decision).max(512), citations: z.array(citation).max(512),
  trace: z.array(z.object({ detail: z.unknown().optional() })).max(512), archive: purchaseArchive.nullable().optional() });
export type PurchaseOutcomeSnapshot = z.infer<typeof input>;

/** Public retained snapshot only: callers retain the existing dispatch visibility
 * authority. This function performs no database, source, provider or payment I/O. */
export function projectPurchaseOutcomes(value: unknown, selectedNetwork: string) {
  const snapshot = input.parse(boundedPortableCopy(value, PURCHASE_OUTCOMES_MAX_BYTES));
  const archive = snapshot.archive ?? null;
  const network = archive?.network ?? purchaseOutcomeNetwork.parse(selectedNetwork);
  const payments = snapshot.trace.flatMap(step => {
    const detail = step.detail;
    // Only explicit payment observations in trace.detail are eligible. Trace
    // messages/plan prices and arbitrary nested objects cannot create money.
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return [];
    const kind = (detail as Record<string, unknown>).kind;
    return kind === "fetch" || kind === "citation" ? [payment.parse(detail)] : [];
  });
  const run = { id: snapshot.id, answer: snapshot.answer,
    decisions: snapshot.decisions as Decision[], citations: snapshot.citations as QueryRun["citations"] };
  const score = scorePurchases(run, payments as PaymentRecord[], network);
  const purchases = score.purchases.map(row => {
    const matches = snapshot.decisions.filter(decision => decision.action === "BUY" &&
      decision.sourceId === row.sourceId && (decision.assetId ?? decision.sourceId) === row.assetId &&
      decision.itemId && decision.contentVersion);
    const identities = new Set(matches.map(decision => JSON.stringify([decision.itemId, decision.contentVersion])));
    // A reused display asset ID must never attach a different exact version to a score.
    if (identities.size !== 1) throw new Error("Ambiguous outcome asset identity");
    return { ...row, itemId: matches[0].itemId!, contentVersion: matches[0].contentVersion! };
  });
  return validatePurchaseOutcomes({ schemaVersion: "keryx-purchase-outcomes-v1", dispatchId: snapshot.id,
    network, runCreatedAt: snapshot.createdAt, basis: "retained-dispatch-trace-exact-version",
    settlementEvidence: "recorded-only-not-revalidated", coverage: "partial-retained-trace", cohort: "unknown", archive,
    counts: { recordedBuyDecisions: snapshot.decisions.filter(row => row.action === "BUY").length,
      scoredPurchases: purchases.length, citedPurchases: purchases.filter(row => row.cited).length,
      unscoredBuyDecisions: score.unscoredDecisions, tracePaymentObservations: payments.length,
      excludedPaymentObservations: score.excludedPayments }, purchases, hitRate: score.hitRate,
    uncitedAccessMicros: score.uncitedAccessMicros, calibration: score.calibration,
    missedValue: null, costPerSupportedClaim: null }, snapshot.id);
}
