/**
 * GET /api/treasury → the agent settlement wallet's chain-abstracted Gateway
 * balance, fetched via Circle App Kit (Unified Balance Kit). Public + read-only:
 * anyone can audit how much USDC currently backs citation payouts.
 */

import {
  getAgentUnifiedBalance,
  type UnifiedBalanceSummary,
} from "@/lib/gateway/unified-balance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Gateway balance moves per-settlement, not per-request — a short cache keeps
// the status page's polling from hammering Circle's Gateway API.
const TTL_MS = 60_000;
let cache: { at: number; data: UnifiedBalanceSummary | null } | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at >= TTL_MS) {
    try {
      cache = { at: Date.now(), data: await getAgentUnifiedBalance() };
    } catch (err) {
      // Keep serving the last good snapshot if Circle's API hiccups; only 503 cold.
      if (!cache) {
        const message = err instanceof Error ? err.message : "unified balance unavailable";
        return Response.json({ available: false, error: message }, { status: 503 });
      }
    }
  }
  return Response.json({
    available: cache.data !== null,
    via: "@circle-fin/unified-balance-kit",
    unifiedBalance: cache.data,
  });
}
