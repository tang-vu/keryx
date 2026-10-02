/**
 * GET /api/treasury → the agent settlement wallet's chain-abstracted Gateway
 * balance. Testnet uses Circle App Kit; mainnet reports selected-domain available
 * USDC for the sealed public policy, with unknown distinct from zero. Public and
 * read-only; this observation is not spending authority or payment readiness.
 */

import {
  getAgentUnifiedBalance,
  getMainnetTreasuryObservation,
  type UnifiedBalanceSummary,
} from "@/lib/gateway/unified-balance";
import { config } from "@/lib/config";
import { ARC_MAINNET_PROFILE } from "@/lib/arc-network-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Gateway balance moves per-settlement, not per-request — a short cache keeps
// the status page's polling from hammering Circle's Gateway API.
const TTL_MS = 60_000;
let cache: { at: number; data: UnifiedBalanceSummary | null } | null = null;

export async function GET() {
  if (config.profile === ARC_MAINNET_PROFILE) {
    // Always validate the current sealed public policy; never serve a stale/rotated treasury.
    try {
      const observation = await getMainnetTreasuryObservation();
      return Response.json({ available: observation.availableUsdc !== null, via: "circle-gateway-api",
        unifiedBalance: null, observation }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ available: false, via: "circle-gateway-api", unifiedBalance: null,
        observation: null, error: "Mainnet public treasury observation unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }
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
