import type { Decision, PreviewCoverage } from "../types";

/**
 * A low but meaningful floor: the heuristic engine starts BUY at 0.12, while real engines return
 * calibrated 0..1 expected value. The pre-check only removes weak/untargeted spend; it cannot add a
 * candidate, raise a price, or change a payee.
 */
export const MIN_PREVIEW_EXPECTED_VALUE = 0.12;

export function normalizeClaimTargets(targets: unknown, claimCount: number): number[] {
  const values = Array.isArray(targets) ? targets : [];
  return [...new Set(values)]
    .filter((target): target is number => typeof target === "number")
    .filter((target) => Number.isInteger(target) && target >= 0 && target < claimCount)
    .sort((a, b) => a - b);
}

export function previewCoverageBlockReason(
  decision: Decision,
  claimCount: number,
): string | null {
  if (decision.action !== "BUY" && decision.action !== "CACHE") return null;
  if (normalizeClaimTargets(decision.targets, claimCount).length === 0) {
    return "the free-preview coverage check could not connect this source to any sub-claim";
  }
  if (!Number.isFinite(decision.expectedValue) || decision.expectedValue < MIN_PREVIEW_EXPECTED_VALUE) {
    return `free-preview expected value ${decision.expectedValue.toFixed(2)} is below the ${MIN_PREVIEW_EXPECTED_VALUE.toFixed(2)} spend floor`;
  }
  return null;
}

export function buildPreviewCoverage(
  subClaims: string[],
  decisions: Decision[],
): PreviewCoverage {
  const actionable = decisions.filter(
    (decision) =>
      !decision.external &&
      (decision.action === "BUY" || decision.action === "CACHE") &&
      decision.expectedValue >= MIN_PREVIEW_EXPECTED_VALUE,
  );
  const claims = subClaims.map((claim, claimIndex) => {
    const matching = actionable.filter((decision) =>
      normalizeClaimTargets(decision.targets, subClaims.length).includes(claimIndex),
    );
    return {
      claimIndex,
      claim,
      candidateIds: matching.map((decision) => decision.assetId ?? decision.sourceId),
      strongestExpectedValue: matching.reduce(
        (strongest, decision) => Math.max(strongest, decision.expectedValue),
        0,
      ),
    };
  });
  const coveredClaims = claims.filter((claim) => claim.candidateIds.length > 0).length;
  const totalClaims = claims.length;
  const ratio = totalClaims > 0 ? coveredClaims / totalClaims : 0;
  return {
    status: coveredClaims === 0 ? "insufficient" : coveredClaims === totalClaims ? "ready" : "partial",
    coveredClaims,
    totalClaims,
    ratio,
    claims,
  };
}
