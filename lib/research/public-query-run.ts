import type { QueryRun } from "../types";
import { projectActualReadCheckpoints } from "../research-audit/actual-read-projection";

/** Permalink/client projection. Supplier holds and recovery authority are private
 * operational records, even when the original answer and its citations are public. */
export function publicQueryRun(run: QueryRun): Omit<QueryRun, "originalFulfillment"> {
  const projected = { ...run };
  if (run.trace.some(step => Object.hasOwn(step, "readCheckpoints"))) {
    // Validate while the original/private marker still exists. Unknown/future packets
    // never pass through the raw QueryRun API even when the ordinary answer is public.
    const capture = projectActualReadCheckpoints(run);
    projected.trace = run.trace.map(step => {
      if (!Object.hasOwn(step, "readCheckpoints")) return step;
      const fields = Object.getOwnPropertyDescriptors(step); delete fields.readCheckpoints;
      const publicStep = Object.defineProperties({}, fields) as typeof step;
      if (capture && step.phase === "done") publicStep.readCheckpoints = capture;
      return publicStep;
    });
  }
  delete projected.originalFulfillment;
  return projected;
}
