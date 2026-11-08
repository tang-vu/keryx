import type { Confidence } from "../types";

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
