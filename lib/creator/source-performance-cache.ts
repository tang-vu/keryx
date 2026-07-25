/**
 * In-process memo of the decision-feedback index.
 *
 * The creator page renders per-request (a creator opens it right after registering, so staleness
 * there reads as "my source doesn't exist"). Parsing the run window on every view would tax the
 * single-box SQLite deploy for data that changes a few times an hour, so the whole index is built
 * once per TTL and served to every source's panel from the same pass.
 *
 * The window is a window on purpose: the last WINDOW_RUNS dispatches, not all time. What a creator
 * needs to know is how the agent judges their source *now* — a repriced listing or a deepened
 * preview should show up here within a day, not be averaged away by six weeks of old verdicts.
 */

import { getDb } from "@/lib/db";
import { buildPerformanceIndex, type SourcePerformance } from "./source-performance";

const TTL_MS = 5 * 60 * 1000;
const WINDOW_RUNS = 400;

let cached: { at: number; index: Record<string, SourcePerformance> } | null = null;

/** The feedback for one source, or null when the window never considered it (new source, or idle). */
export async function getSourcePerformance(
  sourceId: string,
): Promise<{ performance: SourcePerformance | null; windowRuns: number }> {
  const index = await loadIndex();
  return { performance: index[sourceId] ?? null, windowRuns: WINDOW_RUNS };
}

async function loadIndex(): Promise<Record<string, SourcePerformance>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(WINDOW_RUNS);
    cached = { at: Date.now(), index: buildPerformanceIndex(runs) };
    return cached.index;
  } catch {
    // DB hiccup: serve the stale copy without refreshing its timestamp, so the next request
    // retries. No copy yet → the panel renders nothing, which is the correct silence.
    return cached?.index ?? {};
  }
}
