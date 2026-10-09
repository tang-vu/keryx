import type { Decision, PaymentRecord, QueryRun } from "../types";
import { boundedRatio, decimalMicros, micros } from "./exact-units";
import { auditArray, auditObject, auditString, auditWeight } from "./input-contract";

export interface PurchaseOutcome {
  assetId: string;
  sourceId: string;
  expectedValue: number;
  settledAccessMicros: string;
  cited: boolean;
  contributionWeight: number;
  settledRewardMicros: string;
}
export interface PurchaseScore {
  basis: "recorded-exact-version-citations-and-settlements";
  purchases: PurchaseOutcome[];
  unscoredDecisions: number;
  excludedPayments: number;
  hitRate: number | null;
  uncitedAccessMicros: string;
  calibration: Array<{ lower: number; upper: number; samples: number; predictedMean: number | null; citationRate: number | null }>;
  /** No extra reads or expert claim reassessment are performed by this scorer. */
  missedValue: null;
  costPerSupportedClaim: null;
}

function exactIdentity(value: { sourceId: string; itemId?: string; contentVersion?: string }): string | null {
  auditObject(value); auditString(value.sourceId); auditString(value.itemId, true); auditString(value.contentVersion, true);
  return value.sourceId && value.itemId && value.contentVersion
    ? JSON.stringify([value.sourceId, value.itemId, value.contentVersion]) : null;
}

/** A recorded real settled row is distinct from an intent, simulated payment or planned reward. */
function settledAmount(payment: PaymentRecord, runId: string, network: string): string | null {
  if (payment.queryId !== runId || payment.network !== network || payment.settled !== true
    || payment.settlementStatus !== "settled" || !payment.txHash?.trim()) return null;
  return decimalMicros(payment.amountUsdc);
}

/** Read-only offline scorer. It cannot spend an evaluation allowance or change creator rewards. */
export function scorePurchases(run: Pick<QueryRun, "id" | "decisions" | "citations" | "answer">,
  payments: readonly PaymentRecord[], network: string): PurchaseScore {
  auditObject(run); auditString(run.id); auditString(network); auditArray(run.decisions); auditArray(run.citations); auditArray(payments);
  if (!run.id || !network || !Array.isArray(run.decisions) || !Array.isArray(run.citations)
    || typeof run.answer !== "string" || !run.answer.trim()) throw new Error("A completed recorded answer is required");
  const decisions = new Map<string, Decision>();
  let unscoredDecisions = 0;
  for (const decision of run.decisions) {
    auditObject(decision);
    if (!["BUY", "SKIP", "CACHE"].includes(decision.action)) throw new Error("Invalid recorded action");
    if (decision.action !== "BUY") continue;
    auditString(decision.assetId, true);
    const key = exactIdentity(decision);
    auditWeight(decision.expectedValue);
    if (!key) { unscoredDecisions++; continue; }
    const previous = decisions.get(key);
    if (previous) {
      if (previous.expectedValue !== decision.expectedValue || previous.price !== decision.price)
        throw new Error("Conflicting decision identity");
      unscoredDecisions++;
      if ((decision.assetId ?? decision.sourceId) < (previous.assetId ?? previous.sourceId)) decisions.set(key, decision);
      continue;
    }
    decisions.set(key, decision);
  }
  const access = new Map<string, bigint>(), rewards = new Map<string, bigint>();
  const seen = new Map<string, string>();
  let excludedPayments = 0;
  for (const payment of payments) {
    auditObject(payment); auditString(payment.id, true); auditString(payment.queryId); auditString(payment.network);
    auditString(payment.sourceId); auditString(payment.itemId, true); auditString(payment.contentVersion, true);
    if (typeof payment.settled !== "boolean" || typeof payment.amountUsdc !== "number") throw new Error("Invalid payment fields");
    if (payment.txHash != null) auditString(payment.txHash);
    if (payment.id) {
      const fingerprint = JSON.stringify([payment.queryId, payment.network, payment.kind, payment.sourceId, payment.itemId,
        payment.contentVersion, payment.amountUsdc, payment.settled, payment.settlementStatus, payment.txHash, payment.payer, payment.payee]);
      const previous = seen.get(payment.id);
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new Error("Conflicting payment identity");
        excludedPayments++; continue;
      }
      seen.set(payment.id, fingerprint);
    }
    if (payment.kind !== "fetch" && payment.kind !== "citation") continue;
    const key = exactIdentity(payment), amount = settledAmount(payment, run.id, network);
    // Deduplicate the recorded payment identity. Ambiguous/unidentified rows cannot count as money.
    if (!payment.id || !key || amount === null || !decisions.has(key)) { excludedPayments++; continue; }
    const sums = payment.kind === "fetch" ? access : rewards;
    sums.set(key, (sums.get(key) ?? BigInt(0)) + micros(amount));
  }
  const citationsByIdentity = new Map<string, QueryRun["citations"]>();
  for (const citation of run.citations) {
    const key = exactIdentity(citation); auditWeight(citation.weight);
    if (key) citationsByIdentity.set(key, [...(citationsByIdentity.get(key) ?? []), citation]);
  }
  const purchases: PurchaseOutcome[] = [];
  for (const [key, decision] of decisions) {
    const cost = access.get(key) ?? BigInt(0);
    if (cost === BigInt(0)) { unscoredDecisions++; continue; }
    const citations = citationsByIdentity.get(key) ?? [];
    const weights = citations.map(citation => citation.weight);
    const weightKnown = weights.every(weight => Number.isFinite(weight) && weight >= 0 && weight <= 1);
    // Multiple aliases of a version are not multiple independently contributing purchases.
    const weight = weightKnown ? Math.min(1, weights.reduce((sum, value) => sum + value, 0)) : 0;
    purchases.push({ assetId: decision.assetId ?? decision.sourceId, sourceId: decision.sourceId,
      expectedValue: decision.expectedValue, settledAccessMicros: cost.toString(), cited: citations.length > 0,
      contributionWeight: weight, settledRewardMicros: (rewards.get(key) ?? BigInt(0)).toString() });
  }
  const calibration = Array.from({ length: 5 }, (_, index) => {
    const lower = index / 5, upper = (index + 1) / 5;
    const rows = purchases.filter(row => row.expectedValue >= lower && (index === 4 ? row.expectedValue <= upper : row.expectedValue < upper));
    return { lower, upper, samples: rows.length,
      predictedMean: boundedRatio(rows.reduce((sum, row) => sum + row.expectedValue, 0), rows.length),
      citationRate: boundedRatio(rows.filter(row => row.cited).length, rows.length) };
  });
  return { basis: "recorded-exact-version-citations-and-settlements", purchases, unscoredDecisions, excludedPayments,
    hitRate: boundedRatio(purchases.filter(row => row.cited).length, purchases.length),
    uncitedAccessMicros: purchases.filter(row => !row.cited).reduce((sum, row) => sum + micros(row.settledAccessMicros), BigInt(0)).toString(),
    calibration, missedValue: null, costPerSupportedClaim: null };
}
