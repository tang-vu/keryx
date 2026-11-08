import type { Confidence, QueryRun } from "../types";
import { deriveConfidence } from "../agent/confidence";

// Match the existing sponsored public-snapshot text bound. An unsupported
// optional assessment must not discard an otherwise readable report.
export const MAX_RECORDED_CONFIDENCE_REASON_CHARS = 256 * 1024;

/** Project the recorded assessment only, never infer a grade or trust score.
 * Copy known scalar fields so private/unrecognized properties cannot hitchhike
 * across public transports, even when the archived object contains extra data.
 */
export function projectRecordedConfidence(value: unknown): Confidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.level !== "High" && record.level !== "Moderate" && record.level !== "Low" ||
    typeof record.reason !== "string" || record.reason.length > MAX_RECORDED_CONFIDENCE_REASON_CHARS) return;
  return { level: record.level, reason: record.reason };
}

/** The persisted-run boundary retains opaque historical trace entries. Apply
 * the existing stored-first/last-recognized-level rule without asking its typed
 * reader to traverse those entries or coerce an unsupported reason object.
 */
export function projectRunConfidence(run: QueryRun): Confidence | undefined {
  const lookup = { ...run, trace: [] };
  const stored = deriveConfidence(lookup);
  if (stored) return projectRecordedConfidence(stored);
  if (!Array.isArray(run.trace)) return;
  for (let index = run.trace.length - 1; index >= 0; index--) {
    const step = run.trace[index] as unknown;
    if (!step || typeof step !== "object" || Array.isArray(step) || (step as Record<string, unknown>).phase !== "verdict") continue;
    const detail = (step as Record<string, unknown>).detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    lookup.confidence = detail as Confidence;
    const recorded = deriveConfidence(lookup);
    // A recognized later level still wins when its explanation is malformed:
    // omit that optional assessment rather than revive an older higher grade.
    if (recorded) return projectRecordedConfidence({ level: recorded.level, reason: recorded.reason ?? "" });
  }
}
