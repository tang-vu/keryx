import type { Decision, EvidencePortfolio } from "../types";
import { documentSelectionKey } from "./document-selection";
import { numberOperand } from "../research-audit/actual-read-policy";
import { decimalMicros } from "../research-audit/exact-units";
import { MAX_OPTIMIZER_TIES, OPTIMIZER_REPLAY_V1, evaluateOptimizer, stateRefs, statePairKey,
  type OptimizerInput, type OptimizerOutcome, type StateTie } from "../research-audit/optimizer-policy-v1";
import { optimizerCheckpoint, type OptimizerCheckpoint } from "../research-audit/optimizer-checkpoint";

/** Server-only private identity translation. It observes, never invokes the live selector or IO. */
export function captureOptimizer(input: { decisions: Decision[]; claimCount: number; attentionLimit: number; fetchBudgetUsdc: number },
  actual: EvidencePortfolio, candidateRef: (id: string) => number): OptimizerCheckpoint {
  try {
    if (input.decisions.length > 256 || !Number.isSafeInteger(input.claimCount) || input.claimCount < 0 || input.claimCount > 32 ||
      !Number.isSafeInteger(input.attentionLimit) || input.attentionLimit < 0 || input.attentionLimit > 32) return { status: "unavailable", reason: "unsupported-input" };
    for (const row of input.decisions) {
      const fields = Object.getOwnPropertyDescriptors(row);
      for (const name of ["assetId", "sourceId", "action", "price", "expectedValue", "targets", "itemUrl", "sourceKind"])
        if (fields[name] && !("value" in fields[name])) return { status: "unavailable", reason: "unsupported-input" };
      if (typeof row.sourceId !== "string" || row.assetId !== undefined && typeof row.assetId !== "string" ||
        (row.assetId ?? row.sourceId).length > 4096 || row.itemUrl !== undefined && typeof row.itemUrl !== "string" ||
        !Array.isArray(row.targets) || Object.getPrototypeOf(row.targets) !== Array.prototype) return { status: "unavailable", reason: "unsupported-input" };
      const targetFields = Object.getOwnPropertyDescriptors(row.targets as object), length: unknown = targetFields.length?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 10000 || Reflect.ownKeys(row.targets).length !== length + 1) return { status: "unavailable", reason: "unsupported-input" };
      for (let index = 0; index < length; index++) if (!targetFields[index] || !("value" in targetFields[index]) ||
        typeof targetFields[index].value !== "number") return { status: "unavailable", reason: "unsupported-input" };
    }
    const ids = input.decisions.map(row => row.assetId ?? row.sourceId);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length || input.decisions.some(row => row.sourceKind !== undefined && row.sourceKind !== "public-reference")) return { status: "unavailable", reason: "unsupported-input" };
    const orderedIds = [...ids].sort((a, b) => a.localeCompare(b)), ranks = new Map<string, number>(); let rank = 0;
    for (let index = 0; index < orderedIds.length; index++) { if (index && orderedIds[index - 1].localeCompare(orderedIds[index]) !== 0) rank++; ranks.set(orderedIds[index], rank); }
    const privateIds = new Map<number, string>(), groups = new Map<string, number>();
    const snapshot: OptimizerInput = { claimCount: input.claimCount, attentionLimit: input.attentionLimit,
      fetchBudget: numberOperand(input.fetchBudgetUsdc), fetchBudgetMicros: decimalMicros(input.fetchBudgetUsdc),
      candidates: input.decisions.map(row => {
        const id = row.assetId ?? row.sourceId, candidate = candidateRef(id), key = documentSelectionKey(row);
        if (!groups.has(key)) groups.set(key, groups.size + 1); privateIds.set(candidate, id);
        return { candidate, documentGroup: groups.get(key)!, idRank: ranks.get(id)!, action: row.action, price: numberOperand(row.price),
          priceMicros: decimalMicros(row.price), expectedValue: numberOperand(row.expectedValue), targets: [...row.targets], public: row.sourceKind === "public-reference" };
      }) };
    const ties: StateTie[] = [], known = new Map<string, -1 | 0 | 1>();
    const result = evaluateOptimizer(snapshot, (left, right) => {
      const key = statePairKey(left, right), reverse = statePairKey(right, left); if (key === reverse) return 0;
      if (known.has(key)) return known.get(key)!; if (known.has(reverse)) return -known.get(reverse)! as -1 | 0 | 1;
      if (ties.length >= MAX_OPTIMIZER_TIES) throw Error("Capture bound");
      const privateKey = (refs: number[]) => refs.map(ref => privateIds.get(ref)!).sort().join("\u0000");
      const comparison = Math.sign(privateKey(left).localeCompare(privateKey(right))) as -1 | 0 | 1;
      ties.push({ left: stateRefs(left), right: stateRefs(right), comparison }); known.set(key, comparison); return comparison;
    });
    const reserveKnown = actual.selectedAssetIds.every(id => { const row = input.decisions.find(row => (row.assetId ?? row.sourceId) === id); return !!row && (row.action !== "BUY" || decimalMicros(row.price) !== null); });
    const recorded: OptimizerOutcome = { selectionMethod: actual.selectionMethod!, evaluatedStates: actual.evaluatedStates!, eligibleCandidates: actual.eligibleCandidates,
      attentionLimit: actual.attentionLimit, selected: actual.selectedAssetIds.map(candidateRef), cap: numberOperand(actual.fetchBudgetUsdc),
      reserved: numberOperand(actual.selectedBuyUsdc), unused: numberOperand(actual.unusedFetchBudgetUsdc),
      capMicros: snapshot.fetchBudgetMicros === null ? null : decimalMicros(actual.fetchBudgetUsdc),
      reservedMicros: reserveKnown ? decimalMicros(actual.selectedBuyUsdc) : null,
      unusedMicros: reserveKnown && snapshot.fetchBudgetMicros !== null ? decimalMicros(actual.unusedFetchBudgetUsdc) : null,
      predictedCoveredClaims: actual.predictedCoveredClaims, claims: actual.claims.map(row => ({ claimIndex: row.claimIndex,
        selected: row.selectedCandidateIds.map(candidateRef), coverage: numberOperand(row.predictedCoverage) })) };
    if (actual.policy !== "claim-coverage-v1" || JSON.stringify(result) !== JSON.stringify(recorded)) return { status: "unavailable", reason: "source-policy-mismatch" };
    return optimizerCheckpoint({ status: "available", policy: OPTIMIZER_REPLAY_V1, sourcePolicy: actual.policy, facts: "assertions", input: snapshot, ties, outcome: recorded });
  } catch (error) { return { status: "unavailable", reason: error instanceof Error && error.message === "Capture bound" ? "capture-bound" : "unsupported-input" }; }
}
