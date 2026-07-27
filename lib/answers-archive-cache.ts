/**
 * The one place the public answer archive is built.
 *
 * Every crawlable surface reads the same corpus — the archive index, the topic hubs, the Atom
 * feed, the sitemap, and the related-links mesh on each permalink. Each used to load and parse its
 * own window of runs, so a single revalidation round parsed the run log four times over and, worse,
 * nothing tied the four windows together: a sitemap that advertised a page the index no longer
 * linked to would have gone unnoticed. Building once here and sharing the result makes the four
 * surfaces agree by construction, and costs less than what one of them used to spend.
 *
 * The window is what decides how far back the public corpus reaches. It has to stay comfortably
 * ahead of the run log or the oldest answers silently fall out of the index and the sitemap — the
 * pages keep resolving, but nothing links to them any more and search engines drop them. At the
 * daemon's current pace (~30 runs/day) this covers a little over two months of history beyond the
 * whole log to date. Raising it costs memory during the rebuild, not steady state: a run blob
 * averages ~15KB and only the slim ArchiveEntry (a few hundred bytes) is retained afterwards.
 */

import { getDb } from "@/lib/db";
import { buildArchive, type ArchiveEntry } from "@/lib/answers-archive";

/** How many raw runs the archive is built from. See the note above before changing. */
export const ARCHIVE_WINDOW_RUNS = 2500;

const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; entries: ArchiveEntry[] } | null = null;
/** In-flight rebuild, so a burst of concurrent renders parses the run log once, not once each. */
let building: Promise<ArchiveEntry[]> | null = null;

async function rebuild(): Promise<ArchiveEntry[]> {
  const db = await getDb();
  const runs = await db.listRecentQueries(ARCHIVE_WINDOW_RUNS);
  const entries = buildArchive(runs);
  cached = { at: Date.now(), entries };
  return entries;
}

/**
 * The public archive, newest first. Never throws: a database hiccup serves the previous copy
 * (without refreshing its timestamp, so the next caller retries) rather than blanking a page.
 */
export async function getArchiveCached(): Promise<ArchiveEntry[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.entries;
  if (!building) {
    building = rebuild().finally(() => {
      building = null;
    });
  }
  try {
    return await building;
  } catch {
    return cached?.entries ?? [];
  }
}
