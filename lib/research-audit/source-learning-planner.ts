import type { Decision } from "../types";
import type { SourceLearningReport } from "../research/source-learning-contract";
import { selectEvidencePortfolio } from "../agent/evidence-portfolio";
import { documentSelectionKey } from "../agent/document-selection";
import { decimalMicros, micros } from "./exact-units";
import { explorationAllowance, learnedValue } from "./source-learning";

/** Prospective offline planner only. The live orchestrator does not call this function. */
export function planLearnedPortfolio(input: { decisions: Decision[];
  records: ReadonlyMap<string, SourceLearningReport["records"][number]>;
  fetchBudgetMicros: string; explorationFractionBps: number; attentionLimit: number; claimCount: number }) {
  const budget = micros(input.fetchBudgetMicros);
  if (budget > BigInt(Number.MAX_SAFE_INTEGER) || input.decisions.some(d => d.action === "BUY" && decimalMicros(d.price) === null))
    throw new Error("Unrepresentable learned-plan budget or price");
  const allowance = explorationAllowance(input.fetchBudgetMicros, input.explorationFractionBps);
  const adjusted = input.decisions.map(decision => {
    const record = input.records.get(decision.sourceId);
    if (!record || decision.action !== "BUY" || record.bought < 5) return { ...decision };
    const result = learnedValue(decision.expectedValue, { sourceId: decision.sourceId, topic: record.topic,
      bought: record.bought, cited: record.cited, smoothedCitationRate: record.smoothedCitationRate!,
      uncertainty: record.uncertainty!, averagePriceMicros: record.averagePriceMicros,
      averageContribution: record.averageContribution!, excluded: 0 });
    // A sudden five-purchase shift halves the already bounded ±0.1 adjustment.
    const value = record.shiftFlag ? decision.expectedValue + (result.value - decision.expectedValue) / 2 : result.value;
    return { ...decision, expectedValue: value,
      rationale: result.changed ? `${decision.rationale} ${result.rationale}${record.shiftFlag ? " Sudden outcome shift flagged; adjustment halved." : ""}` : decision.rationale };
  });
  const unknown = (d: Decision) => d.action === "BUY" && (input.records.get(d.sourceId)?.bought ?? 0) < 5;
  const exploration = selectEvidencePortfolio({ decisions: adjusted.filter(unknown), claimCount: input.claimCount,
    attentionLimit: input.attentionLimit, fetchBudgetUsdc: Number(allowance.explorationMicros) / 1e6 });
  const explorationIds = new Set(exploration.selectedAssetIds);
  const explored = adjusted.filter(d => explorationIds.has(d.assetId ?? d.sourceId));
  const documents = new Set(explored.map(documentSelectionKey));
  const remaining = BigInt(input.fetchBudgetMicros) - BigInt(decimalMicros(exploration.selectedBuyUsdc) ?? "0");
  const ordinary = selectEvidencePortfolio({ decisions: adjusted.filter(d => !unknown(d) && !documents.has(documentSelectionKey(d))),
    claimCount: input.claimCount, attentionLimit: Math.max(0, input.attentionLimit - explored.length), fetchBudgetUsdc: Number(remaining) / 1e6 });
  const selected = new Set([...exploration.selectedAssetIds, ...ordinary.selectedAssetIds]);
  const selectedCosts = adjusted.filter(d => selected.has(d.assetId ?? d.sourceId) && d.action === "BUY")
    .map(d => decimalMicros(d.price));
  if (selectedCosts.some(cost => cost === null)) throw new Error("Unrepresentable learned-plan price");
  const spent = selectedCosts.reduce((sum, cost) => sum + BigInt(cost!), BigInt(0));
  const explorationSpent = explored.filter(d => d.action === "BUY")
    .reduce((sum, d) => sum + BigInt(decimalMicros(d.price) ?? "0"), BigInt(0));
  if (spent > BigInt(input.fetchBudgetMicros) || explorationSpent > BigInt(allowance.explorationMicros))
    throw new Error("Learned portfolio exceeds its exact allowance");
  return { decisions: adjusted.map(d => ({ ...d, action: selected.has(d.assetId ?? d.sourceId) ? d.action : "SKIP" as const,
    rationale: unknown(d) ? `${d.rationale} Exploration allowance ${input.explorationFractionBps} basis points: ${allowance.explorationMicros} micro-USDC; ${selected.has(d.assetId ?? d.sourceId) ? "selected" : "withheld"} within the partition.` : d.rationale })),
    selectedAssetIds: [...selected], spentMicros: spent.toString(), explorationSpentMicros: explorationSpent.toString(),
    explorationAllowanceMicros: allowance.explorationMicros };
}
