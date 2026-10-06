import type { QueryRun } from "../types";

/** Permalink/client projection. Supplier holds and recovery authority are private
 * operational records, even when the original answer and its citations are public. */
export function publicQueryRun(run: QueryRun): Omit<QueryRun, "originalFulfillment"> {
  const projected = { ...run };
  delete projected.originalFulfillment;
  return projected;
}
