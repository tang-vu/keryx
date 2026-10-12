import { decimalMicros } from "./exact-units";
import { numberOperand } from "./actual-read-policy";

/** Frozen diagnostic replay of claim-coverage-v1; never a payment/selection authority. */
export const OPTIMIZER_REPLAY_V1 = "claim-coverage-replay-v1" as const;
export const MAX_OPTIMIZER_TIES = 1024;
export interface OptimizerCandidate {
  candidate: number; documentGroup: number; idRank: number; action: "BUY" | "SKIP" | "CACHE";
  price: string; priceMicros: string | null; expectedValue: string; targets: number[]; public: boolean;
}
export interface OptimizerInput {
  claimCount: number; attentionLimit: number; fetchBudget: string; fetchBudgetMicros: string | null;
  candidates: OptimizerCandidate[];
}
export interface StateTie { left: number[]; right: number[]; comparison: -1 | 0 | 1 }
export interface OptimizerOutcome {
  selectionMethod: "exhaustive" | "bounded-heuristic"; evaluatedStates: number; eligibleCandidates: number;
  attentionLimit: number; selected: number[]; cap: string; reserved: string; unused: string;
  capMicros: string | null; reservedMicros: string | null; unusedMicros: string | null;
  predictedCoveredClaims: number; claims: { claimIndex: number; selected: number[]; coverage: string }[];
}
interface Candidate { row: OptimizerCandidate; buyUsdc: number; expectedValue: number; targets: number[] }
interface State { candidates: Candidate[]; predicted: number[]; predictedTotal: number; utility: number; buyUsdc: number; publicReads: number }
export type CompareStates = (left: number[], right: number[]) => -1 | 0 | 1;
const EPSILON = 1e-9, ATTENTION_PENALTY = 0.04, MAX_CANDIDATES = 48, MIN_REWARD_SUPPORT = 0.4;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const combine = (current: number, next: number) => 1 - (1 - clamp01(current)) * (1 - clamp01(next));
export const stateRefs = (refs: number[]) => [...refs].sort((a, b) => a - b);
export const statePairKey = (left: number[], right: number[]) => JSON.stringify([stateRefs(left), stateRefs(right)]);

/** Numeric identity order and private collation witnesses are asserted inputs, not source truth. */
export function replayOptimizer(input: OptimizerInput, ties: StateTie[]): OptimizerOutcome {
  const table = new Map(ties.map(tie => [statePairKey(tie.left, tie.right), tie.comparison]));
  const used = new Set<string>();
  const result = evaluateOptimizer(input, (left, right) => {
    const key = statePairKey(left, right), reverse = statePairKey(right, left);
    if (key === reverse) return 0;
    if (table.has(key)) { used.add(key); return table.get(key)!; }
    if (table.has(reverse)) { used.add(reverse); return -table.get(reverse)! as -1 | 0 | 1; }
    throw Error("Missing optimizer collation witness");
  });
  if (used.size !== table.size) throw Error("Unused optimizer collation witness");
  return result;
}

/** Same bounded Number policy as the live selector. Nonmicro operands are never repaired. */
export function evaluateOptimizer(input: OptimizerInput, compareStates: CompareStates): OptimizerOutcome {
  const claimCount = Math.max(0, Math.floor(input.claimCount)), attentionLimit = Math.max(0, Math.floor(input.attentionLimit));
  const fetchBudgetUsdc = Math.floor(Math.max(0, Number(input.fetchBudget)) * 1_000_000 + EPSILON) / 1_000_000;
  const allEligible = input.candidates.filter(row => row.action === "BUY" || row.action === "CACHE")
    .map(row => {
      const expectedValue = clamp01(Number(row.expectedValue));
      const targets = [...new Set(row.targets)].filter(target => Number.isInteger(target) && target >= 0 && target < claimCount).sort((a, b) => a - b);
      if (expectedValue <= 0 || !targets.length || row.action === "BUY" && Number(row.price) < 0) return null;
      return { row, buyUsdc: row.action === "BUY" ? Number(row.price) : 0, expectedValue, targets };
    }).filter((candidate): candidate is Candidate => candidate !== null);
  const compareIds = (a: Candidate, b: Candidate) => a.row.idRank - b.row.idRank;
  const ranked = [...allEligible].sort((a, b) => {
    const aCoverage = a.targets.length * a.expectedValue, bCoverage = b.targets.length * b.expectedValue;
    if (Math.abs(aCoverage - bCoverage) > EPSILON) return bCoverage - aCoverage;
    if (a.row.action !== b.row.action) return a.row.action === "CACHE" ? -1 : 1;
    if (Math.abs(a.buyUsdc - b.buyUsdc) > EPSILON) return a.buyUsdc - b.buyUsdc;
    if (a.row.public !== b.row.public) return a.row.public ? -1 : 1;
    return compareIds(a, b);
  });
  const seenDocuments = new Set<number>();
  const representatives = ranked.filter(candidate => {
    if (seenDocuments.has(candidate.row.documentGroup)) return false;
    seenDocuments.add(candidate.row.documentGroup); return true;
  });
  const representativesSet = new Set(representatives);
  const candidates = [...representatives, ...ranked.filter(candidate => !representativesSet.has(candidate))].slice(0, MAX_CANDIDATES).sort(compareIds);
  function evaluate(candidates: Candidate[]): State {
    const predicted = Array.from({ length: claimCount }, () => 0); let buyUsdc = 0;
    for (const candidate of candidates) {
      buyUsdc += candidate.buyUsdc;
      for (const index of candidate.targets) { if (index >= claimCount) continue; predicted[index] = combine(predicted[index]!, candidate.expectedValue); }
    }
    const predictedTotal = predicted.reduce((sum, value) => sum + value, 0);
    return { candidates: [...candidates], predicted, predictedTotal, utility: predictedTotal - ATTENTION_PENALTY * candidates.length,
      buyUsdc, publicReads: candidates.filter(candidate => candidate.row.public).length };
  }
  function betterState(candidate: State, incumbent: State): boolean {
    if (candidate.utility > incumbent.utility + EPSILON) return true;
    if (candidate.utility < incumbent.utility - EPSILON) return false;
    if (candidate.predictedTotal > incumbent.predictedTotal + EPSILON) return true;
    if (candidate.predictedTotal < incumbent.predictedTotal - EPSILON) return false;
    if (candidate.candidates.length !== incumbent.candidates.length) return candidate.candidates.length < incumbent.candidates.length;
    if (candidate.buyUsdc < incumbent.buyUsdc - EPSILON) return true;
    if (candidate.buyUsdc > incumbent.buyUsdc + EPSILON) return false;
    if (candidate.publicReads !== incumbent.publicReads) return candidate.publicReads > incumbent.publicReads;
    return compareStates(candidate.candidates.map(row => row.row.candidate), incumbent.candidates.map(row => row.row.candidate)) < 0;
  }
  let best = evaluate([]), evaluations = 0; const evaluationLimit = 20000, seed: Candidate[] = []; let seedCost = 0;
  for (let slot = 0; slot < attentionLimit; slot++) {
    const next = candidates.filter(candidate => !seed.some(selected => selected.row.documentGroup === candidate.row.documentGroup) && seedCost + candidate.buyUsdc <= fetchBudgetUsdc + EPSILON)
      .map(candidate => evaluate([...seed, candidate])).sort((a, b) => betterState(a, b) ? -1 : betterState(b, a) ? 1 : 0)[0];
    if (!next || !betterState(next, evaluate(seed))) break;
    seed.splice(0, seed.length, ...next.candidates); seedCost = next.buyUsdc;
  }
  best = evaluate(seed);
  function visit(start: number, selected: Candidate[], buyUsdc: number) {
    if (evaluations >= evaluationLimit) return;
    evaluations++; const state = evaluate(selected); if (betterState(state, best)) best = state;
    if (selected.length >= attentionLimit) return;
    for (let index = start; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      if (selected.some(item => item.row.documentGroup === candidate.row.documentGroup)) continue;
      const nextBuyUsdc = buyUsdc + candidate.buyUsdc; if (nextBuyUsdc > fetchBudgetUsdc + EPSILON) continue;
      selected.push(candidate); visit(index + 1, selected, nextBuyUsdc); selected.pop();
    }
  }
  if (attentionLimit > 0 && claimCount > 0) visit(0, [], 0);
  const remaining = [...best.candidates], predicted = Array.from({ length: claimCount }, () => 0), ordered: Candidate[] = [];
  const marginalGain = (candidate: Candidate) => candidate.targets.reduce((sum, index) => index < claimCount ? sum + (combine(predicted[index]!, candidate.expectedValue) - predicted[index]!) : sum, 0);
  while (remaining.length) {
    remaining.sort((a, b) => {
      const gain = marginalGain(b) - marginalGain(a); if (Math.abs(gain) > EPSILON) return gain;
      if (a.row.action !== b.row.action) return a.row.action === "CACHE" ? -1 : 1;
      if (Math.abs(a.expectedValue - b.expectedValue) > EPSILON) return b.expectedValue - a.expectedValue;
      if (Math.abs(a.buyUsdc - b.buyUsdc) > EPSILON) return a.buyUsdc - b.buyUsdc;
      return compareIds(a, b);
    });
    const next = remaining.shift()!; ordered.push(next);
    for (const index of next.targets) if (index < claimCount) predicted[index] = combine(predicted[index]!, next.expectedValue);
  }
  const claims = best.predicted.map((coverage, claimIndex) => ({ claimIndex,
    selected: ordered.filter(candidate => candidate.targets.includes(claimIndex)).map(candidate => candidate.row.candidate), coverage: numberOperand(round(coverage)) }));
  const reserved = round(best.buyUsdc), unused = round(Math.max(0, fetchBudgetUsdc - best.buyUsdc));
  const reserveKnown = ordered.every(candidate => candidate.row.action !== "BUY" || candidate.row.priceMicros !== null);
  return { selectionMethod: evaluations >= evaluationLimit ? "bounded-heuristic" : "exhaustive", evaluatedStates: evaluations,
    eligibleCandidates: allEligible.length, attentionLimit, selected: ordered.map(candidate => candidate.row.candidate),
    cap: numberOperand(fetchBudgetUsdc), reserved: numberOperand(reserved), unused: numberOperand(unused),
    capMicros: input.fetchBudgetMicros === null ? null : decimalMicros(fetchBudgetUsdc),
    reservedMicros: reserveKnown ? decimalMicros(reserved) : null,
    unusedMicros: reserveKnown && input.fetchBudgetMicros !== null ? decimalMicros(unused) : null,
    predictedCoveredClaims: claims.filter(claim => Number(claim.coverage) >= MIN_REWARD_SUPPORT).length, claims };
}
