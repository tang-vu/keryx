/**
 * Next.js instrumentation hook — runs once on Node.js server boot.
 *
 * Starts the registry indexer so on-chain SourceRegistry events are projected
 * into the KeryxDB cache — near-instantly via its WebSocket subscription, with
 * a heartbeat poll as the safety net.
 *
 * Also sweeps session grants whose TTL lapsed while the process was down. Live grants
 * deliberately survive a restart — that is the point of persisting them — but a grant
 * nobody will ever resume should not sit in the table forever.
 *
 * The `process.env.NEXT_RUNTIME === 'nodejs'` guard ensures this only runs in the
 * Node.js runtime (not the Edge runtime), where `setInterval` and the SQLite/Supabase
 * adapters are available.
 *
 * Idempotent: startIndexer() has an internal `_started` guard — safe if Next.js
 * calls register() more than once (e.g. during hot reload in dev).
 */

let registration: Promise<void> | undefined;
let stopIndexer: (() => Promise<void>) | undefined;
let closing: Promise<boolean> | undefined;

export function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return Promise.resolve();
  if (registration) return registration;
  const previousClose = closing;
  closing = undefined;
  registration = (async () => {
    await previousClose;
    const { getDb } = await import("./lib/db");
    const { startIndexer } = await import("./lib/db/indexer");
    const { pruneExpiredGrants } = await import("./lib/payments/session-grants");

    const db = await getDb();
    stopIndexer = startIndexer(db);
    await pruneExpiredGrants().catch((err) =>
      console.warn("[boot] could not prune expired session grants:", err),
    );
  })();
  return registration;
}

/** Explicit programmatic-server shutdown; Next does not call this export itself. */
export function close(): Promise<boolean> {
  if (!closing) {
    const registered = registration;
    closing = (async () => {
      await registered;
      const stop = stopIndexer;
      await stop?.();
      if (stopIndexer === stop) stopIndexer = undefined;
      if (registration === registered) registration = undefined;
      return stop !== undefined;
    })();
  }
  return closing;
}
