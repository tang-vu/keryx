/**
 * In-process memo of the built answer archive, for pages that render per-request
 * (the dispatch permalink). Building the archive parses ~600 full run blobs, so
 * doing it on every page view would tax the single-box SQLite deploy; a short
 * TTL matches the /answers ISR cadence closely enough that the related-links
 * mesh never lags the index by more than a few minutes.
 */

import { getDb } from "@/lib/db";
import { buildArchive, type ArchiveEntry } from "@/lib/answers-archive";

const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; entries: ArchiveEntry[] } | null = null;

export async function getArchiveCached(): Promise<ArchiveEntry[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.entries;
  try {
    const db = await getDb();
    const runs = await db.listRecentQueries(600);
    cached = { at: Date.now(), entries: buildArchive(runs) };
    return cached.entries;
  } catch {
    // DB hiccup: serve the stale copy if we have one (without refreshing its
    // timestamp, so the next request retries), else render without the section.
    return cached?.entries ?? [];
  }
}
