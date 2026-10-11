import { getDb } from "@/lib/db";
import { buildArchiveStream, type ArchiveEntry } from "@/lib/answers-archive";
export const ARCHIVE_WINDOW_RUNS=2500;
/** Fresh public-only reads. No process text cache, stale copy or archive enumeration after revocation. */
export async function getArchiveCached():Promise<ArchiveEntry[]> {
  try {return await buildArchiveStream((await getDb()).iterateRecentQueries(ARCHIVE_WINDOW_RUNS));}
  catch {return [];}
}
