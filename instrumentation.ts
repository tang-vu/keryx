/**
 * Next.js instrumentation hook — runs once on Node.js server boot.
 *
 * Starts the registry indexer background loop so on-chain SourceRegistry events
 * are projected into the KeryxDB cache within ≤4s of being mined.
 *
 * The `process.env.NEXT_RUNTIME === 'nodejs'` guard ensures this only runs in the
 * Node.js runtime (not the Edge runtime), where `setInterval` and the SQLite/Supabase
 * adapters are available.
 *
 * Idempotent: startIndexer() has an internal `_started` guard — safe if Next.js
 * calls register() more than once (e.g. during hot reload in dev).
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getDb } = await import("./lib/db");
  const { startIndexer } = await import("./lib/db/indexer");

  const db = await getDb();
  startIndexer(db);
}
