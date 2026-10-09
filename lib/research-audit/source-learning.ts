import { micros } from "./exact-units";
import type { CohortClassification } from "./usage-cohort";
import type { PurchaseOutcome } from "./purchase-outcomes";
import { auditArray, auditObject, auditString, auditWeight } from "./input-contract";

export interface LearningObservation {
  runId: string;
  topic: string;
  actorWallet: string;
  sourceOwnerWallets: readonly string[];
  classification: CohortClassification;
  outcome: PurchaseOutcome;
}
export interface SourceLearningRecord {
  sourceId: string;
  topic: string;
  bought: number;
  cited: number;
  /** Beta(1,1) smoothing; a descriptive estimate, not truth or calibrated probability. */
  smoothedCitationRate: number;
  uncertainty: number;
  averagePriceMicros: { numerator: string; denominator: number };
  averageContribution: number;
  excluded: number;
}
const walletPattern = /^0x[a-fA-F0-9]{40}$/;

/** Requires independently classified ordinary observations; unknown and self-dealing history is excluded. */
export function sourceLearningRecord(sourceId: string, topic: string, observations: readonly LearningObservation[]): SourceLearningRecord {
  auditString(sourceId); auditString(topic); auditArray(observations);
  let bought = 0, cited = 0, price = BigInt(0), contribution = 0, excluded = 0;
  const seen = new Map<string, string>();
  for (const row of observations) {
    auditObject(row); auditObject(row.outcome); auditObject(row.classification);
    auditString(row.runId); auditString(row.topic); auditString(row.actorWallet); auditString(row.outcome.sourceId);
    auditArray(row.sourceOwnerWallets, 100);
    for (const owner of row.sourceOwnerWallets) auditString(owner);
    if (typeof row.outcome.cited !== "boolean" || !["outside", "team", "scripted", "unknown"].includes(row.classification.cohort)
      || !["independent", "sponsored", "team", "unknown"].includes(row.classification.payment)) throw new Error("Invalid learning observation");
    auditWeight(row.outcome.contributionWeight);
    if (row.outcome.sourceId !== sourceId || row.topic !== topic) continue;
    const actor = row.actorWallet.toLowerCase();
    const amount = micros(row.outcome.settledAccessMicros);
    const fingerprint = JSON.stringify([actor, [...row.sourceOwnerWallets].map(owner => owner.toLowerCase()).sort(),
      row.classification.cohort, row.classification.payment, row.outcome.cited, row.outcome.settledAccessMicros,
      row.outcome.contributionWeight]);
    const previous = seen.get(row.runId);
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new Error("Conflicting learning run");
      excluded++; continue;
    }
    seen.set(row.runId, fingerprint);
    const ownersKnown = row.sourceOwnerWallets.length > 0 && row.sourceOwnerWallets.every(owner => typeof owner === "string" && walletPattern.test(owner));
    if (!walletPattern.test(actor) || !ownersKnown || row.sourceOwnerWallets.some(owner => owner.toLowerCase() === actor)
      || row.classification.cohort !== "outside" || row.classification.payment !== "independent" || !row.runId
      || !Number.isFinite(row.outcome.contributionWeight) || row.outcome.contributionWeight < 0 || row.outcome.contributionWeight > 1) {
      excluded++; continue;
    }
    if (amount === BigInt(0)) { excluded++; continue; }
    bought++; price += amount;
    if (row.outcome.cited) { cited++; contribution += row.outcome.contributionWeight; }
  }
  return { sourceId, topic, bought, cited, smoothedCitationRate: (cited + 1) / (bought + 2),
    uncertainty: 1 / Math.sqrt(bought + 2), averagePriceMicros: { numerator: price.toString(), denominator: bought },
    averageContribution: bought ? contribution / bought : 0, excluded };
}

/** Prospective advisory input only. Small samples do not change value; one update is bounded to 0.1. */
export function learnedValue(expectedValue: number, record: SourceLearningRecord): { value: number; rationale: string; changed: boolean } {
  if (!Number.isFinite(expectedValue) || expectedValue < 0 || expectedValue > 1
    || !Number.isSafeInteger(record.bought) || record.bought < 0 || !Number.isSafeInteger(record.cited)
    || record.cited < 0 || record.cited > record.bought
    || record.smoothedCitationRate !== (record.cited + 1) / (record.bought + 2)) throw new Error("Invalid learning state");
  if (record.bought < 5) return { value: expectedValue, changed: false, rationale: "Fewer than five independent purchases on this topic; value unchanged." };
  const delta = Math.max(-0.1, Math.min(0.1, (record.smoothedCitationRate - 0.5) * 0.2));
  const value = Math.max(0, Math.min(1, expectedValue + delta));
  return { value, changed: value !== expectedValue,
    rationale: `Bought ${record.bought} times and cited ${record.cited} times on this topic; smoothed citation rate ${record.smoothedCitationRate.toFixed(3)}. Advisory value adjustment ${delta.toFixed(3)}; hard admission rules remain separate.` };
}

/** Partition only a caller-approved exact budget. No default allowance, reader or signing capability. */
export function explorationAllowance(budgetMicros: string, fractionBps: number): { explorationMicros: string; remainingMicros: string } {
  if (!Number.isSafeInteger(fractionBps) || fractionBps < 0 || fractionBps > 10000) throw new Error("Invalid exploration fraction");
  const budget = micros(budgetMicros), exploration = budget * BigInt(fractionBps) / BigInt(10000);
  return { explorationMicros: exploration.toString(), remainingMicros: (budget - exploration).toString() };
}

export function reserveExploration(remainingMicros: string, proposedMicros: string): string {
  const remaining = micros(remainingMicros), proposed = micros(proposedMicros);
  if (proposed > remaining) throw new Error("Exploration allowance exceeded");
  return (remaining - proposed).toString();
}
