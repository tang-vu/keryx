/**
 * Deterministic claim-aware portfolio selection over model-proposed BUY/CACHE decisions.
 *
 * The model decides whether a candidate is worth reading and which claims it may support. This
 * module can only choose a subset of those positive proposals. It cannot promote SKIP, add a
 * candidate, change registry/offer price, select payTo, or authorize a citation reward.
 *
 * Two independent costs are enforced:
 *   - BUY consumes authoritative fetch USDC plus one attention slot;
 *   - CACHE consumes zero fetch USDC plus one attention slot.
 *
 * Expected claim coverage uses diminishing returns, so corroboration can help while four nearly
 * identical sources do not automatically crowd out a source that covers a different claim.
 */

import type { Decision, EvidencePortfolio } from "../types";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";

export const EVIDENCE_PORTFOLIO_POLICY = "claim-coverage-v1" as const;

/** A source must add this much portfolio utility to justify another scarce context slot. */
const ATTENTION_PENALTY = 0.04;
const MAX_OPTIMIZED_CANDIDATES = 48;
const EPSILON = 1e-9;

interface Candidate {
  id: string;
  decision: Decision;
  buyUsdc: number;
  expectedValue: number;
  targets: number[];
}

interface PortfolioState {
  candidates: Candidate[];
  predicted: number[];
  predictedTotal: number;
  utility: number;
  buyUsdc: number;
  key: string;
}

export function selectEvidencePortfolio(input: {
  decisions: Decision[];
  claimCount: number;
  attentionLimit: number;
  fetchBudgetUsdc: number;
}): EvidencePortfolio {
  const claimCount = Math.max(0, Math.floor(input.claimCount));
  const attentionLimit = Math.max(0, Math.floor(input.attentionLimit));
  // A fractional micro-USDC cannot be spent. Floor the cap so normalization can never increase the
  // caller's authority (for example, 0.5 micro must not become permission to spend 1 micro).
  const fetchBudgetUsdc = floorMicros(Math.max(0, input.fetchBudgetUsdc));
  const allEligible = input.decisions
    .filter((decision) => decision.action === "BUY" || decision.action === "CACHE")
    .map((decision) => toCandidate(decision, claimCount))
    .filter((candidate): candidate is Candidate => candidate !== null);

  // The live catalog is currently small. This guard keeps the exact subset search bounded if a
  // future/custom engine marks hundreds of candidates positive. The pre-rank is deterministic and
  // price-neutral for CACHE, so input order and a cache entry's list price cannot choose the set.
  const candidates = [...allEligible]
    .sort(compareStandalone)
    .slice(0, MAX_OPTIMIZED_CANDIDATES)
    .sort((a, b) => a.id.localeCompare(b.id));

  let best = evaluate([], claimCount);

  function visit(start: number, selected: Candidate[], buyUsdc: number) {
    const state = evaluate(selected, claimCount);
    if (betterState(state, best)) best = state;
    if (selected.length >= attentionLimit) return;

    for (let index = start; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const nextBuyUsdc = buyUsdc + candidate.buyUsdc;
      if (nextBuyUsdc > fetchBudgetUsdc + EPSILON) continue;
      selected.push(candidate);
      visit(index + 1, selected, nextBuyUsdc);
      selected.pop();
    }
  }

  if (attentionLimit > 0 && claimCount > 0) visit(0, [], 0);

  const ordered = orderForReading(best.candidates, claimCount);
  const selectedAssetIds = ordered.map((candidate) => candidate.id);
  const claims = best.predicted.map((predictedCoverage, claimIndex) => ({
    claimIndex,
    selectedCandidateIds: ordered
      .filter((candidate) => candidate.targets.includes(claimIndex))
      .map((candidate) => candidate.id),
    predictedCoverage: round(predictedCoverage),
  }));

  return {
    policy: EVIDENCE_PORTFOLIO_POLICY,
    eligibleCandidates: allEligible.length,
    attentionLimit,
    fetchBudgetUsdc,
    selectedAssetIds,
    selectedBuyUsdc: round(best.buyUsdc),
    unusedFetchBudgetUsdc: round(Math.max(0, fetchBudgetUsdc - best.buyUsdc)),
    predictedCoveredClaims: claims.filter(
      (claim) => claim.predictedCoverage >= MIN_REWARD_SUPPORT,
    ).length,
    claims,
  };
}

export function attachEvidencePortfolioOutcome(
  portfolio: EvidencePortfolio,
  input: {
    read: Array<{ assetId?: string; sourceId: string; marker: string }>;
    acceptedMarkers: ReadonlySet<string>;
    groundedClaims: number;
  },
): EvidencePortfolio {
  const selected = new Set(portfolio.selectedAssetIds);
  const read = input.read.filter((item) => selected.has(item.assetId ?? item.sourceId));
  const readAssetIds = unique(read.map((item) => item.assetId ?? item.sourceId));
  const evidenceAssetIds = unique(
    read
      .filter((item) => input.acceptedMarkers.has(item.marker))
      .map((item) => item.assetId ?? item.sourceId),
  );
  return {
    ...portfolio,
    outcome: {
      readAssetIds,
      evidenceAssetIds,
      nonqualifyingReads: Math.max(0, readAssetIds.length - evidenceAssetIds.length),
      unreadSelected: Math.max(0, portfolio.selectedAssetIds.length - readAssetIds.length),
      groundedClaims: Math.max(0, Math.floor(input.groundedClaims)),
      evidenceYield:
        readAssetIds.length > 0 ? round(evidenceAssetIds.length / readAssetIds.length) : null,
    },
  };
}

function toCandidate(decision: Decision, claimCount: number): Candidate | null {
  const id = decision.assetId ?? decision.sourceId;
  if (!id || !Number.isFinite(decision.expectedValue)) return null;
  const expectedValue = clamp01(decision.expectedValue);
  const targets = [...new Set(decision.targets)]
    .filter((target) => Number.isInteger(target) && target >= 0 && target < claimCount)
    .sort((a, b) => a - b);
  if (expectedValue <= 0 || targets.length === 0) return null;
  if (decision.action === "BUY" && (!Number.isFinite(decision.price) || decision.price < 0)) {
    return null;
  }
  return {
    id,
    decision,
    buyUsdc: decision.action === "BUY" ? decision.price : 0,
    expectedValue,
    targets,
  };
}

function evaluate(candidates: Candidate[], claimCount: number): PortfolioState {
  const predicted = Array.from({ length: claimCount }, () => 0);
  let buyUsdc = 0;
  for (const candidate of candidates) {
    buyUsdc += candidate.buyUsdc;
    for (const claimIndex of candidate.targets) {
      if (claimIndex >= claimCount) continue;
      predicted[claimIndex] = combine(predicted[claimIndex]!, candidate.expectedValue);
    }
  }
  const predictedTotal = predicted.reduce((sum, value) => sum + value, 0);
  const ids = candidates.map((candidate) => candidate.id).sort();
  return {
    candidates: [...candidates],
    predicted,
    predictedTotal,
    utility: predictedTotal - ATTENTION_PENALTY * candidates.length,
    buyUsdc,
    key: ids.join("\u0000"),
  };
}

function betterState(candidate: PortfolioState, incumbent: PortfolioState): boolean {
  if (candidate.utility > incumbent.utility + EPSILON) return true;
  if (candidate.utility < incumbent.utility - EPSILON) return false;
  if (candidate.predictedTotal > incumbent.predictedTotal + EPSILON) return true;
  if (candidate.predictedTotal < incumbent.predictedTotal - EPSILON) return false;
  if (candidate.candidates.length !== incumbent.candidates.length) {
    return candidate.candidates.length < incumbent.candidates.length;
  }
  if (candidate.buyUsdc < incumbent.buyUsdc - EPSILON) return true;
  if (candidate.buyUsdc > incumbent.buyUsdc + EPSILON) return false;
  return candidate.key.localeCompare(incumbent.key) < 0;
}

/** Read the strongest marginal evidence first; CACHE wins a true tie because it cannot spend. */
function orderForReading(candidates: Candidate[], claimCount: number): Candidate[] {
  const remaining = [...candidates];
  const predicted = Array.from({ length: claimCount }, () => 0);
  const ordered: Candidate[] = [];
  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const gain = marginalGain(b, predicted, claimCount) - marginalGain(a, predicted, claimCount);
      if (Math.abs(gain) > EPSILON) return gain;
      if (a.decision.action !== b.decision.action) {
        return a.decision.action === "CACHE" ? -1 : 1;
      }
      if (Math.abs(a.expectedValue - b.expectedValue) > EPSILON) {
        return b.expectedValue - a.expectedValue;
      }
      if (Math.abs(a.buyUsdc - b.buyUsdc) > EPSILON) return a.buyUsdc - b.buyUsdc;
      return a.id.localeCompare(b.id);
    });
    const next = remaining.shift()!;
    ordered.push(next);
    for (const claimIndex of next.targets) {
      if (claimIndex < claimCount) {
        predicted[claimIndex] = combine(predicted[claimIndex]!, next.expectedValue);
      }
    }
  }
  return ordered;
}

function marginalGain(candidate: Candidate, predicted: number[], claimCount: number): number {
  return candidate.targets.reduce(
    (sum, claimIndex) =>
      claimIndex < claimCount
        ? sum + (combine(predicted[claimIndex]!, candidate.expectedValue) - predicted[claimIndex]!)
        : sum,
    0,
  );
}

function compareStandalone(a: Candidate, b: Candidate): number {
  const aCoverage = a.targets.length * a.expectedValue;
  const bCoverage = b.targets.length * b.expectedValue;
  if (Math.abs(aCoverage - bCoverage) > EPSILON) return bCoverage - aCoverage;
  if (a.decision.action !== b.decision.action) return a.decision.action === "CACHE" ? -1 : 1;
  if (Math.abs(a.buyUsdc - b.buyUsdc) > EPSILON) return a.buyUsdc - b.buyUsdc;
  return a.id.localeCompare(b.id);
}

function combine(current: number, next: number): number {
  return 1 - (1 - clamp01(current)) * (1 - clamp01(next));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function floorMicros(value: number): number {
  return Math.floor(value * 1_000_000 + EPSILON) / 1_000_000;
}
