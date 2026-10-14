import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { cohortPurchaseScore, PURCHASE_AGGREGATE_COHORTS, validatePurchaseAggregate } from "../research/purchase-outcome-aggregate";
import { comparePurchaseScores, MAX_POOLED_PURCHASES } from "./purchase-regression";
import { sha256Text } from "./counterfactual-offline";

export const MAX_PURCHASE_RELEASE_BYTES = 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/), commit = z.string().regex(/^[a-f0-9]{40}$/);
const artifact = z.object({ sourceCommit: commit, aggregateSha256: digest, inputSha256: digest }).strict();
const policySchema = z.object({
  schemaVersion: z.literal("keryx-purchase-release-policy-v1"),
  baseline: artifact, candidate: artifact,
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  cohorts: z.array(z.enum(PURCHASE_AGGREGATE_COHORTS)).min(1).max(PURCHASE_AGGREGATE_COHORTS.length),
  margins: z.object({ maxHitRateDrop: z.number().finite().min(0).max(1),
    maxCalibrationGapRise: z.number().finite().min(0).max(1),
    minScoredPurchases: z.number().int().min(1).max(MAX_POOLED_PURCHASES) }).strict(),
}).strict();
export type PurchaseReleasePolicy = z.infer<typeof policySchema>;
const bindingSchema = z.object({ policySha256: digest, candidateSourceCommit: commit, inputSha256: digest }).strict();

function parseJson(text: string): unknown {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_PURCHASE_RELEASE_BYTES) throw new Error("Release input too large");
  return boundedPortableCopy(JSON.parse(text), MAX_PURCHASE_RELEASE_BYTES);
}

/**
 * Fail-closed offline comparison under an externally reviewed, explicitly pinned policy.
 * Hashes are of exact UTF-8 file text, including formatting. The caller must bind the policy
 * hash, candidate source and input hash independently of the files it is reviewing.
 *
 * This checks content bindings; it cannot attest that a declared input produced an aggregate.
 * Root review/CI must establish that provenance. A pass is a comparison receipt, never
 * permission to merge, publish or deploy, and supplements all existing acceptance gates.
 */
export async function evaluatePurchaseRelease(files: { policyJson: string; baselineJson: string; candidateJson: string },
  expected: { policySha256: string; candidateSourceCommit: string; inputSha256: string }) {
  // Closed portable copies reject getters and hidden capabilities before reading any fields.
  const texts = z.object({ policyJson: z.string(), baselineJson: z.string(), candidateJson: z.string() }).strict()
    .parse(boundedPortableCopy(files, 4 * MAX_PURCHASE_RELEASE_BYTES));
  const bindings = bindingSchema.parse(boundedPortableCopy(expected));
  const policy = policySchema.parse(parseJson(texts.policyJson));
  if (new Set(policy.cohorts).size !== policy.cohorts.length) throw new Error("Repeated release cohort");
  const hashes = { policySha256: await sha256Text(texts.policyJson), baselineSha256: await sha256Text(texts.baselineJson),
    candidateSha256: await sha256Text(texts.candidateJson) };
  if (hashes.policySha256 !== bindings.policySha256 || hashes.baselineSha256 !== policy.baseline.aggregateSha256
    || hashes.candidateSha256 !== policy.candidate.aggregateSha256 || policy.candidate.sourceCommit !== bindings.candidateSourceCommit
    || policy.baseline.inputSha256 !== bindings.inputSha256 || policy.candidate.inputSha256 !== bindings.inputSha256)
    throw new Error("Release artifact bindings refused");
  const baseline = validatePurchaseAggregate(parseJson(texts.baselineJson)), candidate = validatePurchaseAggregate(parseJson(texts.candidateJson));
  if (baseline.network !== policy.network || candidate.network !== policy.network
    || baseline.since !== candidate.since || baseline.until !== candidate.until || baseline.period !== candidate.period)
    throw new Error("Release populations differ");
  const comparisons = policy.cohorts.map(cohort => {
    const score = comparePurchaseScores(cohortPurchaseScore(baseline, cohort), cohortPurchaseScore(candidate, cohort), policy.margins);
    const coverageReasons: string[] = [];
    for (const [name, report] of [["baseline", baseline], ["candidate", candidate]] as const) {
      const column = report.columns.find(row => row.cohort === cohort)!;
      if (!column.sampleComplete) coverageReasons.push(`${name}-incomplete-sample`);
      if (column.unscorableRuns) coverageReasons.push(`${name}-unscorable-runs`);
      if (column.unscoredBuyDecisions) coverageReasons.push(`${name}-unscored-buys`);
    }
    // Do not let dropped/withheld observations turn a worsening release into a pass.
    return { cohort, ...score, coverageReasons,
      status: score.status === "pass" && coverageReasons.length ? "not-evaluable" as const : score.status };
  });
  // All selected cohorts are required. A flagged cohort remains visible even when another is too small.
  const status = comparisons.some(row => row.status === "flagged") ? "flagged" as const :
    comparisons.some(row => row.status === "not-evaluable") ? "not-evaluable" as const : "pass" as const;
  return { schemaVersion: "keryx-purchase-release-check-v1" as const, status, policy, bindings, hashes,
    period: { since: baseline.since, until: baseline.until }, comparisons,
    deploymentAuthorized: false as const,
    basis: "pinned recorded-citation comparison; producer provenance and ordinary release acceptance remain required" as const };
}
