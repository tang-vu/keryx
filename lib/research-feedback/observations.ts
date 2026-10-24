import type { QueryRun } from "../types";
import { summarizeStageCosts } from "../economics/stage-costs";
import { jobObservationsSchema, type JobObservations } from "./contracts";

/** Observations of this completed generation, never a new tariff or invoice.
 * Include failed/retried calls and unknown usage; do not impute unknowns to zero.
 */
export function recordedJobObservations(run: QueryRun): JobObservations {
  const stages = summarizeStageCosts([run]);
  const sum = (field: "calls" | "failedCalls" | "pendingCalls" | "missingUsageCalls" | "unpricedUsageRecords" | "usageRecords") =>
    stages.reduce((total, stage) => total + stage[field], 0);
  const priced = stages.flatMap(stage => stage.pricedCostUsdBounds ? [stage.pricedCostUsdBounds] : []);
  return jobObservationsSchema.parse({
    format: "keryx-recorded-job-observations-v1",
    generationDurationMs: Number.isSafeInteger(run.durationMs) && run.durationMs! >= 0 ? run.durationMs : null,
    durationBasis: "recorded-orchestrator-completion",
    modelCostUsd: priced.length ? { lower: priced.reduce((n, cost) => n + cost.lower, 0), upper: priced.reduce((n, cost) => n + cost.upper, 0) } : null,
    costBasis: "partial-captured-policy-estimate", recordedCalls: sum("calls"), failedCalls: sum("failedCalls"),
    pendingCalls: sum("pendingCalls"), missingUsageCalls: sum("missingUsageCalls"),
    unpricedUsageRecords: sum("unpricedUsageRecords"), usageRecords: sum("usageRecords"),
    excluded: "search-infrastructure-gas-and-unrecorded-provider-charges", invoice: null, profit: null,
  });
}
