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
import {
  DISPATCH_HEALTH_STATE_KEY,
  type DispatchHealthSummary,
} from "@/lib/ops/dispatch-health";
import {
  SETTLEMENT_PARITY_STATE_KEY,
  type SettlementParitySummary,
} from "@/lib/gateway/settlement-parity";
import {
  PENDING_RECONCILIATION_STATE_KEY,
  type PendingReconciliationSummary,
} from "@/lib/gateway/x402-transfer-reconciliation";
import { classifyArcRpcProvider } from "@/lib/ops/public-proof";
import {
  assessPendingReconciliation,
  type PendingReconciliationAssessment,
} from "@/lib/gateway/pending-reconciliation-health";

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
    // Deliberately a coarse label: tokenized RPC URLs are server credentials and never public.
    rpcProvider: classifyArcRpcProvider(config.rpcUrl),
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

    // Dispatch section: the hourly outcome watchdog (scripts/check-dispatches.mts) writes the
    // verdict; the probe only reads it back, so /api/health stays one aggregate read plus two
    // key lookups. A missing or malformed row hides the section, never the probe.
    let dispatches: DispatchHealthSummary | null = null;
    try {
      const raw = await db.getSyncState(DISPATCH_HEALTH_STATE_KEY);
      dispatches = raw ? (JSON.parse(raw) as DispatchHealthSummary) : null;
    } catch {
      /* an unreadable summary must not take the health probe down with it */
    }

    // Settlement section: the hourly parity watchdog (scripts/check-settlement.mts) does the
    // Circle round-trip; the probe only reads its verdict back. Same failure rule as above — an
    // unreadable summary hides the section, never the probe.
    let settlement: SettlementParitySummary | null = null;
    try {
      const raw = await db.getSyncState(SETTLEMENT_PARITY_STATE_KEY);
      settlement = raw ? (JSON.parse(raw) as SettlementParitySummary) : null;
    } catch {
      /* a malformed summary must not take the health probe down with it */
    }

    // Per-authorization Circle reconciliation is separate from aggregate wallet parity: the first
    // proves an ambiguous nonce, while the second proves the creator balances backing settled rows.
    let reconciliation: (PendingReconciliationSummary & PendingReconciliationAssessment) | null =
      null;
    try {
      const raw = await db.getSyncState(PENDING_RECONCILIATION_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PendingReconciliationSummary;
        const normalized: PendingReconciliationSummary = {
          ...parsed,
          // Rolling deploy compatibility: older summaries lack these additive fields. Their
          // pending rows cannot be assigned an exact expiry or funding path from the summary.
          browserAwaiting: parsed.browserAwaiting ?? 0,
          treasuryAwaiting: parsed.treasuryAwaiting ?? 0,
          acknowledgedAwaiting: parsed.acknowledgedAwaiting ?? 0,
          unacknowledgedAwaiting:
            parsed.unacknowledgedAwaiting ?? parsed.awaiting ?? 0,
          expiredAwaiting: parsed.expiredAwaiting ?? 0,
          unknownExpiryAwaiting: parsed.unknownExpiryAwaiting ?? parsed.awaiting ?? 0,
          earliestAuthorizationExpiresAt: parsed.earliestAuthorizationExpiresAt ?? null,
          releasedReservations: parsed.releasedReservations ?? 0,
          oldestUnacknowledgedPendingAt:
            parsed.oldestUnacknowledgedPendingAt ?? parsed.oldestPendingAt ?? null,
        };
        reconciliation = {
          ...normalized,
          ...assessPendingReconciliation(normalized),
        };
      }
    } catch {
      /* operational evidence is additive; never turn malformed telemetry into downtime */
    }

    const operationalStatus = reconciliation?.degraded ? "degraded" : "operational";

    return Response.json(
      {
        ok: true,
        status: operationalStatus,
        db: "ok",
        ...base,
        registry,
        dispatches,
        settlement,
        reconciliation,
        traction: {
          totalPayments: m.totalPayments,
          creatorPayoutsUsdc: Number(m.totalCreatorPayoutsUsdc.toFixed(6)),
          creatorsEarning: m.creatorsEarning,
          totalQueries: m.totalQueries,
          externalPayments: m.externalPayments,
          externalCreatorPayoutsUsdc: Number(m.externalCreatorPayoutsUsdc.toFixed(6)),
          externalQueries: m.externalQueries,
          externalPayingQueries: m.externalPayingQueries,
          identifiedExternalActors: m.identifiedExternalActors,
          returningExternalActors: m.returningExternalActors,
          externalFeedbackTotal: m.externalFeedbackTotal,
          externalSatisfactionRate: m.externalSatisfactionRate,
          enginePayments: m.enginePayments,
          engineQueries: m.engineQueries,
          groundedClaimRate: m.groundedClaimRate,
          externalSettlementSuccessRate: m.externalSettlementSuccessRate,
          externalSettlementAttempts: m.externalSettlementAttempts,
          pendingPaymentConfirmations: m.pendingPaymentConfirmations,
          pendingPaymentVolumeUsdc: m.pendingPaymentVolumeUsdc,
          failedPaymentAttempts: m.failedPaymentAttempts,
          failedPaymentVolumeUsdc: m.failedPaymentVolumeUsdc,
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
