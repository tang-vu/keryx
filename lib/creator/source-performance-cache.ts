import { getDb } from "@/lib/db";
import { buildPerformanceIndex, type SourcePerformance } from "./source-performance";

const WINDOW_RUNS = 400;
/** Read the current public corpus without retaining stale question text.
 * A rejected read remains unavailable; only a successful read can establish an empty window.
 */
export async function getSourcePerformance(sourceId: string): Promise<{ performance: SourcePerformance | null; windowRuns: number }> {
  const db = await getDb();
  const index = buildPerformanceIndex(await db.listRecentQueries(WINDOW_RUNS));
  return { performance: index[sourceId] ?? null, windowRuns: WINDOW_RUNS };
}
