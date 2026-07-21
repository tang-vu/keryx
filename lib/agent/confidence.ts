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

function fromVerdictStep(run: QueryRun): Confidence | null {
  // Last verdict wins — a run only emits one, but reading from the end is robust to any future
  // re-verdict step without changing this call site.
  for (let i = run.trace.length - 1; i >= 0; i--) {
    const step = run.trace[i]!;
    if (step.phase !== "verdict") continue;
    const d = step.detail as Partial<Confidence> | undefined;
    if (d && typeof d.level === "string" && LEVELS.has(d.level as Confidence["level"])) {
      return { level: d.level as Confidence["level"], reason: String(d.reason ?? "") };
    }
  }
  return null;
}

/** The dispatch's confidence, or null when neither the field nor a verdict step is present
 *  (e.g. a run that errored before synthesis). */
export function deriveConfidence(run: QueryRun): Confidence | null {
  if (run.confidence && LEVELS.has(run.confidence.level)) return run.confidence;
  return fromVerdictStep(run);
}
