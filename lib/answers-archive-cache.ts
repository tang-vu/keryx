import { privacyReadsActive, requirePrivacy } from "./run-privacy/contracts";
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
 * pages keep resolving, but nothing links to them any more and search engines drop them. The
 * run rate determines the history covered by the window. Read incrementally: raw traces can be much larger than
 * archive cards. Retain only slim winners, never all raw strings and parsed run graphs.
 */

import { getDb } from "@/lib/db";
import { buildArchiveStream, type ArchiveEntry } from "@/lib/answers-archive";
import { getTestnetArchive } from "./history/testnet-archive";

/** How many raw runs the archive is built from. See the note above before changing. */
export const ARCHIVE_WINDOW_RUNS = 2500;

const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; entries: ArchiveEntry[] } | null = null;
/** In-flight rebuild, so a burst of concurrent renders parses the run log once, not once each. */
let building: Promise<ArchiveEntry[]> | null = null;
// Once this process has observed admitted privacy, a database outage must never
// select a previously retained legacy cache. Configuration changes need a restart.
let privacyObserved = privacyReadsActive({});

async function publicArchive(db: Awaited<ReturnType<typeof getDb>>): Promise<ArchiveEntry[]> {
  const privacy = requirePrivacy(db);
  const candidates = async function* () {
    let count = 0, before: { id: string; createdAt: string } | undefined;
    while (count < ARCHIVE_WINDOW_RUNS) {
      // The privacy port filters public/unerased rows in storage before text retrieval.
      const rows = await privacy.list({ take: Math.min(32, ARCHIVE_WINDOW_RUNS - count), before });
      if (!rows.length) break;
      for (const run of rows) { count++; yield run; }
      before = { id: rows.at(-1)!.id, createdAt: rows.at(-1)!.createdAt };
    }
  };
  const selected = await buildArchiveStream(candidates());
  // A winner may have been revoked while later candidates were being scanned.
  // Project fresh bodies, not the text collected before its publication check.
  const published = async function* () {
    for (let offset = 0; offset < selected.length; offset += 32) {
      const ids = selected.slice(offset, offset + 32).map(entry => entry.id);
      const allowed = new Set(ids);
      const rows = await privacy.list({ ids, take: ids.length });
      for (const run of rows) {
        if (!allowed.delete(run.id)) throw new Error("Unadmitted archive publication identity");
        yield run;
      }
    }
  };
  return buildArchiveStream(published());
}

async function rebuild(): Promise<ArchiveEntry[]> {
  const db = await getDb();
  const entries = await buildArchiveStream(db.iterateRecentQueries(ARCHIVE_WINDOW_RUNS));
  let historical: ArchiveEntry[] = [];
  let historicalUnavailable = false;
  try {
    const archive = await getTestnetArchive();
    if (archive) historical = (await buildArchiveStream(archive.iterateRecentQueries(ARCHIVE_WINDOW_RUNS)))
      .map(entry => ({ ...entry, archivedNetwork: archive.info.network }));
  } catch { historicalUnavailable = true; /* Current answers stay available; retry the archive soon. */ }
  const merged = new Map<string, ArchiveEntry>(historical.map(entry => [entry.id, entry]));
  for (const entry of entries) merged.set(entry.id, entry);
  const combined = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  cached = { at: historicalUnavailable ? Date.now() - TTL_MS + 15_000 : Date.now(), entries: combined };
  return combined;
}

/**
 * The public archive, newest first. Never throws: a database hiccup serves the previous copy
 * (without refreshing its timestamp, so the next caller retries) rather than blanking a page.
 */
async function legacyArchiveCached(): Promise<ArchiveEntry[]> {
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

/** Active privacy never serves a retained legacy cache or enumerates immutable archive originals. */
export async function getArchiveCached():Promise<ArchiveEntry[]> {
  let active=privacyObserved || privacyReadsActive({});
  try {
    const db=await getDb();active=active || privacyReadsActive(db);
    if(active) {
      privacyObserved = true;
      return await publicArchive(db);
    }
  } catch {if(active)return [];}
  return legacyArchiveCached();
}
