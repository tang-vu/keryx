import type { SourcePerformance } from "./source-performance";

export interface SourcePerformanceResponse {
  sourceId: string;
  name: string;
  windowRuns: number;
  performance: SourcePerformance | null;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const optionalNumber = (value: unknown) => value === null || finite(value);

/** Validate received shape/source identity without repairing absent values with zeros.
 * Finite observations keep their recorded values, without inventing settlement or clamping rates.
 */
export function isSourcePerformanceResponse(value: unknown, sourceId: string): value is SourcePerformanceResponse {
  if (!object(value) || value.sourceId !== sourceId || typeof value.name !== "string" ||
    !count(value.windowRuns) || value.windowRuns === 0) return false;
  const performance = value.performance;
  if (performance === null) return true;
  if (!object(performance) || !["considered", "bought", "reused", "skipped", "cited"].every(key => count(performance[key])) ||
    !["citeThrough", "evChosen", "evSkipped", "price", "rivalPriceOnSkip"].every(key => optionalNumber(performance[key])) ||
    !Array.isArray(performance.recentSkips)) return false;
  return performance.recentSkips.every(note => object(note) && typeof note.queryId === "string" && note.queryId.length > 0 &&
    typeof note.question === "string" && typeof note.rationale === "string" && typeof note.createdAt === "string" &&
    Number.isFinite(Date.parse(note.createdAt)) && finite(note.expectedValue) && finite(note.price) && optionalNumber(note.rivalPrice));
}
