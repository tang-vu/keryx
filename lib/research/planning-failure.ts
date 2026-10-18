/** Public, caller-scoped failure metadata. Never includes model output or retry authority. */
export interface PlanningFailureDiagnostic {
  version: 1;
  stage: "decompose";
  reason: "expanded_output" | "invalid_output" | "needs_refinement";
  maximumTargets: 8;
  automaticRetry: false;
  outputTokenLimit?: number;
}

export function parsePlanningFailure(value: unknown): PlanningFailureDiagnostic | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.values(fields).some(field => !("value" in field)) ||
      Object.keys(fields).some(key => !["version", "stage", "reason", "maximumTargets", "automaticRetry", "outputTokenLimit"].includes(key))) return;
    const row = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
    if (row.version !== 1 || row.stage !== "decompose" || row.maximumTargets !== 8 || row.automaticRetry !== false ||
      !["expanded_output", "invalid_output", "needs_refinement"].includes(row.reason)) return;
    const limit = row.outputTokenLimit;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) return;
    return { version: 1, stage: "decompose", reason: row.reason, maximumTargets: 8, automaticRetry: false,
      ...(limit === undefined ? {} : { outputTokenLimit: limit }) };
  } catch { return; }
}

/** A saved failed original may receive its existing one-shot private history claim.
 * This identifier alone grants no read, ownership, retry or payment authority. */
export function savedPlanningFailureId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  return row.code === "research_plan_refinement_required" && row.reportSaved === true && parsePlanningFailure(row.planningFailure) &&
    typeof row.failedReportId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.failedReportId)
    ? row.failedReportId : undefined;
}
