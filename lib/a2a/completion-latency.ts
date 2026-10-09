/** Recorded completion paths only; these labels confer no payment or delivery authority. */
export type CompletionLatencyCohort = "ordinary" | "recovered" | "unknown";
export interface CompletionLatencySummary {
  completed: number;
  timedSamples: number;
  p50Ms: number | null;
  p95Ms: number | null;
}
export type CompletionLatencyCohorts = Record<CompletionLatencyCohort, CompletionLatencySummary>;

export interface CompletionMarkers {
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  executionJournalVersion?: unknown;
  researchPackage?: unknown;
  serviceReceipt?: unknown;
  resolution?: unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function canonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** An absent/malformed recovery marker never becomes evidence of ordinary execution. */
export function recordedCompletionCohort(row: CompletionMarkers): CompletionLatencyCohort {
  const updatedMs = Date.parse(row.updatedAt);
  if (!Number.isFinite(updatedMs)) return "unknown";
  if (row.resolution !== null) {
    const resolution = object(row.resolution), evidence = object(resolution?.evidence);
    if (!resolution || !evidence || !["automatic-poll", "operator-cli"].includes(String(resolution.actor)) ||
      canonicalTimestamp(resolution.resolvedAt) !== updatedMs || evidence.queryRunFound !== true) return "unknown";
    if (resolution.action === "repair_completed" && resolution.reason === "saved_real_query_run") return "recovered";
    const fulfillment = object(resolution.fulfillment);
    if (resolution.action === "fulfill_failed_original" && resolution.actor === "operator-cli" &&
      resolution.reason === "verified_failed_original_fulfilled" && evidence.executionJournalVersion === 1 &&
      fulfillment && ["claimId", "originalFailureSha256", "authoritySha256", "providerLedgerSha256", "runSha256"]
        .every(key => digest(fulfillment[key]))) return "recovered";
    return "unknown";
  }
  const receipt = object(row.serviceReceipt), pkg = object(row.researchPackage);
  const createdMs = Date.parse(row.createdAt), startedMs = row.startedAt === null ? NaN : Date.parse(row.startedAt);
  const finishedMs = canonicalTimestamp(receipt?.finishedAt);
  if (row.executionJournalVersion !== 1 || !receipt || !pkg || pkg.schema !== "urn:keryx:a2a-research-package:1" ||
    pkg.version !== "1.0.0" || !["keryx-quick", "keryx-deep"].includes(String(pkg.id)) ||
    receipt.packageId !== pkg.id || receipt.packageVersion !== pkg.version || receipt.outcome !== "completed" ||
    receipt.objectiveKind !== "provisional_slo" || receipt.remedy !== "none" ||
    !Number.isFinite(createdMs) || !Number.isFinite(startedMs) || startedMs < createdMs ||
    canonicalTimestamp(receipt.acceptedAt) !== createdMs || canonicalTimestamp(receipt.startedAt) !== startedMs ||
    finishedMs === null || finishedMs < startedMs || finishedMs > updatedMs) return "unknown";
  return "ordinary";
}

export function completionLatencyCohorts(): CompletionLatencyCohorts {
  const empty = (): CompletionLatencySummary => ({ completed: 0, timedSamples: 0, p50Ms: null, p95Ms: null });
  return { ordinary: empty(), recovered: empty(), unknown: empty() };
}
