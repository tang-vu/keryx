/**
 * DB selector. Supabase adapter when configured (deploy), else local SQLite (offline dev).
 * Adapters are dynamically imported so the unused one is never bundled.
 */

import { hasSupabase } from "../config";
import type { KeryxDB } from "./keryx-db";

// Publish only the shared initialization promise, never a partially ready adapter.
let initialization: Promise<KeryxDB> | null = null;

export async function getDb(): Promise<KeryxDB> {
  if (!initialization) {
    initialization = (async () => {
      // Select once per attempt, before the first asynchronous import boundary.
      const useSupabase = hasSupabase();
      const admitted = await (await import("./application-storage")).createApplicationStorage();
      const adapter = admitted ?? (useSupabase
        ? new (await import("./supabase-adapter")).SupabaseAdapter()
        : new (await import("./sqlite-adapter")).SqliteAdapter());
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
