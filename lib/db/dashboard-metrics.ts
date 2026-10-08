import type {
  DashboardEvidenceQuality,
  DashboardMetrics,
  McpClientChannel,
  PaymentOrigin,
  PaymentRecord,
  QueryRun,
} from "../types";

export interface MetricPaymentRow {
  amountUsdc: number;
  sourceId: string;
  queryId: string;
  kind: PaymentRecord["kind"];
  origin?: PaymentOrigin | null;
  settled: boolean;
  settlementStatus?: import("../types").PaymentSettlementStatus | null;
  payer?: string | null;
  txHash?: string | null;
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

export const AGGREGATE_EVIDENCE_QUALITY: Readonly<DashboardEvidenceQuality> = Object.freeze({
  status: "unavailable",
  basis: "recorded-unreassessed",
  explanation: "Stored historical evidence counters have not been reassessed against current source provenance; aggregate factual grounding is unavailable.",
});

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
  // Planned creator rewards are distinct from public citations and settled payments.
  // Missing legacy amounts cannot establish either a positive reward or a fully withheld pool.
  const creatorCitations = Array.isArray(run.citations)
    ? run.citations.filter(citation => citation?.sourceKind !== "public-reference"
      && !(typeof citation?.sourceId === "string" && citation.sourceId.startsWith("public:")))
    : null;
  const knownRewards = creatorCitations?.every(citation => typeof citation?.reward === "number"
    && Number.isFinite(citation.reward) && citation.reward >= 0);
  return {
    evidenceClaimCount: run.claimCoverage.length,
    groundedClaimCount: run.claimCoverage.filter(
      (claim) => claim.coverage >= 0.4,
    ).length,
    rewardedCitationCount: creatorCitations && knownRewards
      ? creatorCitations.filter(citation => citation.reward > 0).length
      : null,
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
  const payments = paymentRows.filter((p) => p.settled &&
    (p.kind === "operating-fee"
      ? p.settlementStatus === "settled" && typeof p.txHash === "string" && p.txHash.trim().length > 0
      : p.settlementStatus == null || p.settlementStatus === "settled"));
  const creatorPayments = payments.filter((p) => p.kind === "fetch" || p.kind === "citation");
  const operatingPayments = payments.filter((p) => p.kind === "operating-fee" && p.settlementStatus === "settled");
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

  return {
    totalPayments: payments.length,
    totalVolumeUsdc: round(volume),
    totalCreatorPayoutsUsdc: round(creatorVolume),
    settledOperatingFeeUsdc: round(operatingPayments.reduce((sum, p) => sum + p.amountUsdc, 0)),
    settledOperatingFeePayments: operatingPayments.length,
    creatorsEarning: new Set(creatorPayments.map((p) => p.sourceId)).size,
    avgPaymentUsdc: payments.length ? round(volume / payments.length) : 0,
    totalQueries: runRows.length,
    guestQuestions: runRows.filter(run => run.origin === "web"
      && (run.asker == null || run.asker === "")).length,
    payingQueries: payingQueryIds.size,
    readerToPayerConversion: runRows.length ? round(payingQueryIds.size / runRows.length) : 0,
    evidenceRunSamples: evidenceRuns.length,
    evidenceClaimSamples,
    // Stored counters can include subsequently demoted synthetic evidence. Aggregate reads do
    // not establish current factual support; keep their sample counts without publishing a rate.
    groundedClaimRate: null,
    evidenceQuality: AGGREGATE_EVIDENCE_QUALITY,
    citationPoolWithheldRuns: evidenceRuns.filter(
      (run) =>
        Number(run.evidenceClaimCount ?? 0) > 0 &&
        run.rewardedCitationCount === 0,
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
