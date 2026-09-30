import type { SupabaseAuthority } from "./supabase-authority";
import type { QueryRun } from "../types";

const PAGE_SIZE = 32;
/** PostgREST quoted filter value: control characters are not valid cursor data. */
function quoted(value: string): string {
  if (!value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Query scan cursor unavailable");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Keyset pages avoid offset shifts from newer inserts. Each HTTP read has its
 * own snapshot; concurrent modifications/backdated inserts are not a DB-wide snapshot. */
export async function* iterateSupabaseRecentQueries(db: SupabaseAuthority, limit: number): AsyncIterable<QueryRun> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2500) throw new Error("Invalid query scan limit");
  let cursor: { createdAt: string; id: string } | undefined;
  const seen = new Set<string>();
  while (seen.size < limit) {
    const count = Math.min(PAGE_SIZE, limit - seen.size);
    const { data, error } = await db.rpc("iterate_recent_queries", { p_limit: count,
      p_before_time: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null }).abortSignal(AbortSignal.timeout(15_000))
      .then(result => result, () => { throw new Error("Query scan unavailable"); });
    if (error || !Array.isArray(data) || data.length > count) throw new Error("Query scan unavailable");
    if (data.length === 0) return;
    for (const row of data) {
      if (typeof row.id !== "string" || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
        || seen.has(row.id) || !row.data || row.data.id !== row.id) throw new Error("Query scan identity unavailable");
      quoted(row.id); quoted(row.created_at);
      seen.add(row.id);
      cursor = { id: row.id, createdAt: row.created_at };
      yield row.data as QueryRun;
    }
    // A server may cap a page below the requested size. Continue from its last
    // row until an empty page or the caller's limit, never silently truncate.
  }
}
