/**
 * GET /api/health — liveness + readiness probe.
 *
 * Two jobs: (1) the post-reload gate for the low-downtime redeploy
 * (scripts/redeploy-vps.sh) — a non-200 here triggers an automatic rollback to the
 * previous build; (2) a public uptime signal for the /status page and any external
 * monitor. Cheap by design: one aggregate DB read, no chain or LLM calls. Returns 200
 * when ready, 503 when the datastore is unreachable.
 */

import { getDb } from "@/lib/db";
import { config, llmProvider } from "@/lib/config";
import { PARITY_STATE_KEY, type ParitySummary } from "@/lib/registry/parity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Captured once at first module load — uptime is measured from process start.
const BOOT_MS = Date.now();

export async function GET() {
  // Settlement mode mirrors the gateway selector: real treasury settlement needs a
  // funder key and the offline flag off; otherwise runs settle as simulated.
  const forceOffline = process.env.KERYX_FORCE_OFFLINE === "1";
  const base = {
    name: "keryx",
    commit: process.env.KERYX_COMMIT ?? null,
    uptimeSeconds: Math.floor((Date.now() - BOOT_MS) / 1000),
    reasoning: llmProvider(),
    settles: !forceOffline && config.funderKey ? "real" : "offline",
    network: config.network,
    time: new Date().toISOString(),
  };

  try {
    const db = await getDb();
    const m = await db.metrics();

    // Registry section: served from sync_state only — the hourly parity watchdog
    // (scripts/check-registry.mts) does the chain reads; the probe stays chain-free.
    let registry: {
      address: string;
      lastSyncedBlock: string | null;
      parity: ParitySummary | null;
    } | null = null;
    if (config.registryReadAddress) {
      const [lastSyncedBlock, parityRaw] = await Promise.all([
        db.getSyncState("lastSyncedBlock"),
        db.getSyncState(PARITY_STATE_KEY),
      ]);
      let parity: ParitySummary | null = null;
      try {
        parity = parityRaw ? (JSON.parse(parityRaw) as ParitySummary) : null;
      } catch {
        /* a malformed summary hides the parity row, never the health probe */
      }
      registry = { address: config.registryReadAddress, lastSyncedBlock, parity };
    }

    return Response.json(
      {
        ok: true,
        db: "ok",
        ...base,
        registry,
        traction: {
          totalPayments: m.totalPayments,
          creatorPayoutsUsdc: Number(m.totalCreatorPayoutsUsdc.toFixed(6)),
          creatorsEarning: m.creatorsEarning,
          totalQueries: m.totalQueries,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        db: "unreachable",
        error: err instanceof Error ? err.message : String(err),
        ...base,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
