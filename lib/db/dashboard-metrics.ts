import type {
  DashboardMetrics,
  McpClientChannel,
  PaymentOrigin,
  QueryRun,
} from "../types";

export interface MetricPaymentRow {
  amountUsdc: number;
  sourceId: string;
  queryId: string;
  kind: "fetch" | "citation" | "inbound";
  origin?: PaymentOrigin | null;
  settled: boolean;
  settlementStatus?: import("../types").PaymentSettlementStatus | null;
  payer?: string | null;
}

export interface MetricRunRow {
  id: string;
  origin?: PaymentOrigin | null;
  asker?: string | null;
  durationMs?: number | null;
  paymentMode?: "real" | "offline" | null;
  paymentAttempts?: number | null;
  settledPayments?: number | null;
  confidenceLevel?: "High" | "Moderate" | "Low" | null;
  mcpClient?: McpClientChannel | null;
  evidenceClaimCount?: number | null;
  groundedClaimCount?: number | null;
  rewardedCitationCount?: number | null;
}

export interface MetricFeedbackRow {
  queryId: string;
  rating: "up" | "down";
}

export interface MetricGapIntentRow {
  status: import("../types").GapIntentStatus;
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export interface RunEvidenceMetrics {
  evidenceClaimCount: number | null;
  groundedClaimCount: number | null;
  rewardedCitationCount: number | null;
}

/** Derive additive evidence telemetry from a completed QueryRun without backfilling history. */
export function runEvidenceMetrics(data: unknown): RunEvidenceMetrics {
  let run = data as Partial<QueryRun> | null;
  if (typeof data === "string") {
    try {
      run = JSON.parse(data) as Partial<QueryRun>;
    } catch {
      run = null;
    }
  }
  if (!run || !Array.isArray(run.claimCoverage)) {
    return {
      evidenceClaimCount: null,
      groundedClaimCount: null,
      rewardedCitationCount: null,
    };
  }
  return {
    evidenceClaimCount: run.claimCoverage.length,
    groundedClaimCount: run.claimCoverage.filter(
      (claim) => claim.coverage >= 0.4,
    ).length,
    rewardedCitationCount: Array.isArray(run.citations)
      ? run.citations.length
      : 0,
  };
}

/**
 * One definition shared by SQLite and Supabase. Payment money is settled-only; query metrics use
 * completed query_runs. Totals include every caller origin, including historical NULL origins.
 */
export function calculateDashboardMetrics(
  paymentRows: MetricPaymentRow[],
  runRows: MetricRunRow[],
  feedbackRows: MetricFeedbackRow[] = [],
  gapIntentRows: MetricGapIntentRow[] = [],
): DashboardMetrics {
  const pending = paymentRows.filter(
    (payment) => !payment.settled && payment.settlementStatus === "pending",
  );
  const failed = paymentRows.filter(
    (payment) => !payment.settled && payment.settlementStatus === "failed",
  );
  const payments = paymentRows.filter((p) => p.settled);
  const creatorPayments = payments.filter((p) => p.kind !== "inbound");
  const volume = payments.reduce((sum, p) => sum + p.amountUsdc, 0);
  const creatorVolume = creatorPayments.reduce((sum, p) => sum + p.amountUsdc, 0);
  const payingQueryIds = new Set(creatorPayments.map((p) => p.queryId));

  const mcpChannels = new Map<
    McpClientChannel | "unknown",
    { queries: number; payingQueries: number }
  >();
  for (const run of runRows) {
    if (run.origin !== "mcp") continue;
    const channel = run.mcpClient ?? "unknown";
    const current = mcpChannels.get(channel) ?? { queries: 0, payingQueries: 0 };
    current.queries += 1;
    if (payingQueryIds.has(run.id)) current.payingQueries += 1;
    mcpChannels.set(channel, current);
  }
  const evidenceRuns = runRows.filter(
    (run) => run.evidenceClaimCount != null,
  );
  const evidenceClaimSamples = evidenceRuns.reduce(
    (sum, run) => sum + Number(run.evidenceClaimCount ?? 0),
    0,
  );
  const groundedClaims = evidenceRuns.reduce(
    (sum, run) => sum + Number(run.groundedClaimCount ?? 0),
    0,
  );

  return {
    totalPayments: payments.length,
    totalVolumeUsdc: round(volume),
    totalCreatorPayoutsUsdc: round(creatorVolume),
    creatorsEarning: new Set(creatorPayments.map((p) => p.sourceId)).size,
    avgPaymentUsdc: payments.length ? round(volume / payments.length) : 0,
    totalQueries: runRows.length,
    payingQueries: payingQueryIds.size,
    readerToPayerConversion: runRows.length ? round(payingQueryIds.size / runRows.length) : 0,
    evidenceRunSamples: evidenceRuns.length,
    evidenceClaimSamples,
    groundedClaimRate: evidenceClaimSamples
      ? round(groundedClaims / evidenceClaimSamples)
      : 0,
    citationPoolWithheldRuns: evidenceRuns.filter(
      (run) =>
        Number(run.evidenceClaimCount ?? 0) > 0 &&
        Number(run.rewardedCitationCount ?? 0) === 0,
    ).length,
    gapIntentOffers: gapIntentRows.length,
    gapIntentFilled: gapIntentRows.filter((intent) => intent.status === "filled").length,
    gapIntentPending: gapIntentRows.filter(
      (intent) => intent.status === "pending" || intent.status === "running",
    ).length,
    gapIntentFillRate: gapIntentRows.length
      ? round(
          gapIntentRows.filter((intent) => intent.status === "filled").length /
            gapIntentRows.length,
        )
      : 0,
    feedbackTotal: feedbackRows.length,
    satisfactionRate: feedbackRows.length
      ? round(feedbackRows.filter((f) => f.rating === "up").length / feedbackRows.length)
      : 0,
    pendingPaymentConfirmations: pending.length,
    pendingPaymentVolumeUsdc: round(
      pending.reduce((sum, payment) => sum + payment.amountUsdc, 0),
    ),
    failedPaymentAttempts: failed.length,
    failedPaymentVolumeUsdc: round(
      failed.reduce((sum, payment) => sum + payment.amountUsdc, 0),
    ),
    mcpClientQueries: [...mcpChannels.entries()]
      .map(([client, counts]) => ({ client, ...counts }))
      .sort((a, b) => b.queries - a.queries || a.client.localeCompare(b.client)),
  };
}
