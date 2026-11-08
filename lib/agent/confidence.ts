/**
 * Reading a dispatch's confidence, wherever it came from.
 *
 * `confidence` became a first-class field partway through the run log's life. Every dispatch before
 * that carries the same judgement, but only inside its trace — the `verdict` step run-agent emits.
 * deriveConfidence() prefers the field and falls back to that step, so the ~hundreds of archived
 * dispatches show a badge without a recompute or a migration.
 */

import type { Confidence, QueryRun } from "../types";

const LEVELS = new Set<Confidence["level"]>(["High", "Moderate", "Low"]);

export function isConfidenceLevel(value: unknown): value is Confidence["level"] {
  return typeof value === "string" && LEVELS.has(value as Confidence["level"]);
}

function fromVerdictStep(run: QueryRun): Confidence | null {
  // Last verdict wins — a run only emits one, but reading from the end is robust to any future
  // re-verdict step without changing this call site.
  for (let i = run.trace.length - 1; i >= 0; i--) {
    const step = run.trace[i];
    // Persisted runs admit opaque historical entries, including JSON null.
    if (!step || step.phase !== "verdict") continue;
    const d = step.detail as Partial<Confidence> | undefined;
    if (d && isConfidenceLevel(d.level)) {
      try {
        return { level: d.level, reason: String(d.reason ?? "") };
      } catch {
        // A JSON object may shadow toString. The last recognized verdict still
        // wins: leave its assessment unavailable instead of reviving an older one.
        return null;
      }
    }
  }
  return null;
}

/** The dispatch's readable confidence, or null when unavailable. A recognized
 * stored level still takes precedence when its explanation is malformed: omit
 * that optional assessment rather than reviving an older verdict. */
export function deriveConfidence(run: QueryRun): Confidence | null {
  if (run.confidence && isConfidenceLevel(run.confidence.level))
    return typeof run.confidence.reason === "string" ? run.confidence : null;
  return fromVerdictStep(run);
}
