import type { KeryxDB } from "../db/keryx-db";
import type { PrivateResultSpool } from "./private-result-spool";

/** Serial bounded scans. Failed records remain on disk and cannot starve later
 * entries. A whole clean sweep is required before the caller admits new work. */
export function createPrivateResultRecovery(db: Pick<KeryxDB, "savePrivateResearchResult">,
  spool: Pick<PrivateResultSpool, "entries" | "restore">) {
  let entries: ReturnType<PrivateResultSpool["entries"]> | undefined;
  let sweepFailed = false, busy = false;
  async function close() {
    const current = entries; entries = undefined;
    await current?.return(undefined);
  }
  return {
    close,
    async tick(signal?: AbortSignal) {
      const result = { status: "recovery" as const, visited: 0, restored: 0, errors: 0, ready: false };
      if (busy || signal?.aborted) return result;
      busy = true;
      try {
        if (!entries) { entries = spool.entries(); sweepFailed = false; }
        while (result.visited < 25 && !signal?.aborted) {
          const next = await entries.next();
          if (next.done) { entries = undefined; result.ready = !sweepFailed; return result; }
          result.visited++;
          if (next.value === null) continue;
          try { await spool.restore(db, next.value); result.restored++; }
          catch { result.errors++; sweepFailed = true; }
        }
        return result;
      } catch {
        result.errors++; sweepFailed = true;
        await close().catch(() => undefined);
        return result;
      } finally { busy = false; }
    },
  };
}
