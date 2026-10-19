import type { LlmCallRecord } from "../llm/call-ledger";
import type { LlmCallStage, LlmUsageRecord } from "../llm/reasoning-engine";
import { usageCostBounds, type CostBounds } from "./provider-cost-policy";

const STAGES = new Set<LlmCallStage>(["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "evidence-review", "attribute"]);
export interface StageCostSummary {
  stage: LlmCallStage | "unassigned";
  calls: number;
  failedCalls: number;
  pendingCalls: number;
  missingUsageCalls: number;
  usageRecords: number;
  unpricedUsageRecords: number;
  inputTokens: number;
  outputTokens: number;
  /** Partial captured-policy estimate only; null when no usage in this stage can be priced. */
  pricedCostUsdBounds: CostBounds | null;
}

/** Operator aggregate. Unknown costs and historical stages are never imputed as zero. */
export function summarizeStageCosts(runs: readonly {
  llmCalls?: readonly LlmCallRecord[]; llmUsage?: readonly LlmUsageRecord[];
}[]): StageCostSummary[] {
  const groups = new Map<StageCostSummary["stage"], StageCostSummary>();
  const group = (stage: unknown) => {
    const key = typeof stage === "string" && STAGES.has(stage as LlmCallStage) ? stage as LlmCallStage : "unassigned";
    let value = groups.get(key);
    if (!value) {
      value = { stage: key, calls: 0, failedCalls: 0, pendingCalls: 0, missingUsageCalls: 0,
        usageRecords: 0, unpricedUsageRecords: 0, inputTokens: 0, outputTokens: 0, pricedCostUsdBounds: null };
      groups.set(key, value);
    }
    return value;
  };
  for (const run of runs) {
    const usages = run.llmUsage ?? [], calls = run.llmCalls ?? [];
    const usagesById = new Map<string, LlmUsageRecord[]>();
    for (const usage of usages) if (usage.callId) usagesById.set(usage.callId, [...(usagesById.get(usage.callId) ?? []), usage]);
    const callsById = new Map<string, LlmCallRecord[]>();
    for (const call of calls) callsById.set(call.id, [...(callsById.get(call.id) ?? []), call]);
    for (const call of calls) {
      const g = group(call.stage); g.calls++;
      if (call.outcome === "failed") g.failedCalls++;
      if (call.outcome === "pending") g.pendingCalls++;
      if (usagesById.get(call.id)?.length !== 1) g.missingUsageCalls++;
    }
    for (const usage of usages) {
      const boundCalls = usage.callId ? callsById.get(usage.callId) : undefined;
      const call = boundCalls?.length === 1 ? boundCalls[0] : undefined;
      const stage = usage.stage && call?.stage && usage.stage !== call.stage ? undefined : usage.stage ?? call?.stage;
      const g = group(stage); g.usageRecords++;
      g.inputTokens += usage.inputTokens; g.outputTokens += usage.outputTokens;
      const duplicate = usage.callId && (usagesById.get(usage.callId)!.length !== 1 || (boundCalls?.length ?? 0) > 1);
      const cost = duplicate ? null : usageCostBounds(usage);
      if (!cost) { g.unpricedUsageRecords++; continue; }
      g.pricedCostUsdBounds ??= { lower: 0, upper: 0 };
      g.pricedCostUsdBounds.lower += cost.lower; g.pricedCostUsdBounds.upper += cost.upper;
    }
  }
  return [...groups.values()].sort((a, b) => a.stage.localeCompare(b.stage));
}
