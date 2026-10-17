import type { KeryxDB } from "../db/keryx-db";
import { APPROVED_PUBLIC_REFERENCES } from "./approved-catalog";
import { fetchPublicReferenceFeed, referenceSnapshot } from "./catalog";
import { fetchPublicText } from "../net/public-fetch";

export const PUBLIC_CATALOG_IMPORT_DURATION_MS = 15 * 60 * 1000;
export interface PublicCatalogImportResult {
  name: string; items: number; ok: boolean;
  code?: "read-failed" | "feed-failed" | "write-failed" | "capacity" | "write-deadline" | "cancelled";
}
export type PublicCatalogImportProgress = { name: string; index: number; total: number } &
  ({ phase: "started" } | { phase: "completed"; result: PublicCatalogImportResult });
export interface PublicCatalogImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PublicCatalogImportProgress) => void;
}

const ingestFeed = (url: string, signal?: AbortSignal) => fetchPublicReferenceFeed(url,
  (target, limits) => fetchPublicText(target, { ...limits, signal }));

/** Explicit one-time onboarding, independent of the consumed recurring hourly journal. */
export async function importPublicReferenceCatalog(
  db: Pick<KeryxDB, "getSource" | "getPublicReference" | "upsertPublicReference">,
  ingest: (url: string, signal?: AbortSignal) => ReturnType<typeof fetchPublicReferenceFeed> = ingestFeed,
  options: PublicCatalogImportOptions = {},
) {
  if (!db.getPublicReference || !db.upsertPublicReference) throw new Error("Public reference catalog unsupported");
  const results: PublicCatalogImportResult[] = [], controller = new AbortController();
  const deadline = Date.now() + PUBLIC_CATALOG_IMPORT_DURATION_MS;
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const timer = setTimeout(stop, PUBLIC_CATALOG_IMPORT_DURATION_MS);
  const check = () => {
    if (Date.now() >= deadline) stop();
    controller.signal.throwIfAborted();
  };
  try {
    for (const [index, approved] of APPROVED_PUBLIC_REFERENCES.entries()) {
      // DB writes are synchronous and atomic. Yield only outside their SAVEPOINT
      // so SIGINT/SIGTERM can stop before the next publisher starts.
      await new Promise<void>(resolve => setImmediate(resolve));
      if (controller.signal.aborted || Date.now() >= deadline) break;
      const progress = { name: approved.name, index: index + 1, total: APPROVED_PUBLIC_REFERENCES.length };
      options.onProgress?.({ ...progress, phase: "started" });
      let stage: "read-failed" | "feed-failed" | "write-failed" = "read-failed";
      let result: PublicCatalogImportResult;
      try {
        check();
        if (await db.getSource(approved.id)) throw new Error("Reserved public ID collides with a paid source");
        const existing = await db.getPublicReference(approved.id);
        check();
        // Preserve explicit operator deactivation; onboarding never silently re-enables a source.
        const reference = { ...approved, active: existing?.active ?? approved.active };
        stage = "feed-failed";
        const snapshot = referenceSnapshot(reference, await ingest(approved.rssUrl, controller.signal));
        if (!snapshot.items.length) throw new Error("Feed has no usable linked content");
        check(); stage = "write-failed";
        await db.upsertPublicReference(snapshot);
        result = { name: reference.name, items: snapshot.items.length, ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = controller.signal.aborted || Date.now() >= deadline ? "cancelled"
          : /^Public archive write .+ limit$/.test(message) || message === "Public archive term batch byte limit" ? "capacity"
          : message === "Public archive write deadline" ? "write-deadline" : stage;
        result = { name: approved.name, items: 0, ok: false, code };
      }
      results.push(result);
      options.onProgress?.({ ...progress, phase: "completed", result });
      if (controller.signal.aborted || Date.now() >= deadline || result.code === "capacity" || result.code === "write-deadline") break;
    }
    return results;
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", stop);
  }
}
