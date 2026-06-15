/**
 * DB selector. Supabase adapter when configured (deploy), else local SQLite (offline dev).
 * Adapters are dynamically imported so the unused one is never bundled.
 */

import { hasSupabase } from "../config";
import type { KeryxDB } from "./keryx-db";

let instance: KeryxDB | null = null;

export async function getDb(): Promise<KeryxDB> {
  if (instance) return instance;
  if (hasSupabase()) {
    const { SupabaseAdapter } = await import("./supabase-adapter");
    instance = new SupabaseAdapter();
  } else {
    const { SqliteAdapter } = await import("./sqlite-adapter");
    instance = new SqliteAdapter();
  }
  await instance.init();
  return instance;
}

export type { KeryxDB, CreatorEarnings } from "./keryx-db";
