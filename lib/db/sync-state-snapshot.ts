import type { KeryxDB } from "./keryx-db";

/** One lazy batch per request. Scalar fallback retains each caller's own error
 * boundary when the adapter lacks batching or a batch is unavailable. */
export function syncStateSnapshot(
  db: Pick<KeryxDB, "getSyncState" | "getSyncStates">,
  keys: readonly string[],
): (key: string) => Promise<string | null> {
  let snapshot: Promise<ReadonlyMap<string, string | null> | null> | undefined;
  return async key => {
    if (!db.getSyncStates || !keys.includes(key)) return db.getSyncState(key);
    snapshot ??= (async () => {
      try { return await db.getSyncStates!(keys); }
      catch { return null; }
    })();
    const values = await snapshot;
    return values ? values.get(key) ?? null : db.getSyncState(key);
  };
}
