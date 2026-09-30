/**
 * DB selector. The explicit checked deployment manifest selects the backend and full identity.
 * Adapters are dynamically imported so the unused one is never bundled.
 */

import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import type { KeryxDB } from "./keryx-db";

// Publish only the shared initialization promise, never a partially ready adapter.
let initialization: Promise<KeryxDB> | null = null;

export async function getDb(): Promise<KeryxDB> {
  // Revalidate the pinned process configuration even when returning a cached adapter.
  const deployment = readRuntimeStorageDeployment();
  if (!initialization) {
    initialization = (async () => {
      // Select once per attempt, before the first asynchronous import boundary.
      const adapter = deployment.backend.kind === "supabase"
        ? new (await import("./supabase-adapter")).SupabaseAdapter(deployment.identity)
        : new (await import("./sqlite-adapter")).SqliteAdapter(deployment.backend.databasePath, { expectedIdentity: deployment.identity });
      try {
        await adapter.init();
        return adapter;
      } catch (error) {
        // SQLite owns a file handle and exposes close(); Supabase has no adapter
        // disposal API. Cleanup does not roll back earlier schema/cache writes.
        if ("close" in adapter && typeof adapter.close === "function") {
          try { adapter.close(); } catch { /* preserve the initialization failure */ }
        }
        throw error;
      }
    })().catch((error: unknown) => {
      // Failed imports, constructors and init are shared failures. A later caller
      // may retry with a fresh adapter; no rejected or partial instance is cached.
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export type { KeryxDB, CreatorEarnings } from "./keryx-db";
