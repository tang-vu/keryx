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

const EXTERNAL = new Set<PaymentOrigin>(["web", "a2a", "mcp"]);

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
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
 * completed query_runs. Legacy NULL origins are deliberately internal until there is evidence
 * otherwise, so the external bucket can never be inflated by missing data.
 */
export function calculateDashboardMetrics(
  paymentRows: MetricPaymentRow[],
  runRows: MetricRunRow[],
  feedbackRows: MetricFeedbackRow[] = [],
): DashboardMetrics {
  const payments = paymentRows.filter((p) => p.settled);
  const creatorPayments = payments.filter((p) => p.kind !== "inbound");
  const volume = payments.reduce((sum, p) => sum + p.amountUsdc, 0);
  const creatorVolume = creatorPayments.reduce((sum, p) => sum + p.amountUsdc, 0);
  const payingQueryIds = new Set(creatorPayments.map((p) => p.queryId));

  const externalRuns = runRows.filter((r) => r.origin && EXTERNAL.has(r.origin));
  const externalIds = new Set(externalRuns.map((r) => r.id));
  const externalCreatorPayments = creatorPayments.filter((p) => externalIds.has(p.queryId));
  const externalCreatorVolume = externalCreatorPayments.reduce(
    (sum, p) => sum + p.amountUsdc,
    0,
  );
  const externalPayingIds = new Set(externalCreatorPayments.map((p) => p.queryId));
  const mcpChannels = new Map<
    McpClientChannel | "unknown",
    { queries: number; payingQueries: number }
  >();
  for (const run of externalRuns) {
    if (run.origin !== "mcp") continue;
    const channel = run.mcpClient ?? "unknown";
    const current = mcpChannels.get(channel) ?? { queries: 0, payingQueries: 0 };
    current.queries += 1;
    if (externalPayingIds.has(run.id)) current.payingQueries += 1;
    mcpChannels.set(channel, current);
  }

  const externalPayments = payments.filter(
    (p) => p.origin && EXTERNAL.has(p.origin),
  );
  const externalVolume = externalPayments.reduce((sum, p) => sum + p.amountUsdc, 0);

  // Stable actor = a server-verified SIWE/API-key wallet, or the payer of a settled inbound A2A call.
  // Anonymous web queries remain unattributed rather than being fingerprinted by IP/cookie.
  const inboundPayerByQuery = new Map<string, string>();
  for (const p of payments) {
    if (p.kind === "inbound" && p.payer) {
      inboundPayerByQuery.set(p.queryId, p.payer.toLowerCase());
    }
  }
  const queriesByActor = new Map<string, Set<string>>();
  for (const run of externalRuns) {
    const actor =
      run.origin === "a2a"
        ? inboundPayerByQuery.get(run.id)
        : run.asker?.toLowerCase();
    if (!actor) continue;
    const queries = queriesByActor.get(actor) ?? new Set<string>();
    queries.add(run.id);
    queriesByActor.set(actor, queries);
  }
  const returningActors = [...queriesByActor.values()].filter((q) => q.size >= 2).length;

  const durations = externalRuns
    .map((r) => r.durationMs)
    .filter((n): n is number => n != null)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const confidence = externalRuns
    .map((r) => r.confidenceLevel)
    .filter((level): level is "High" | "Moderate" | "Low" => Boolean(level));
  const externalFeedback = feedbackRows.filter((f) => externalIds.has(f.queryId));
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

  const settlementRuns = externalRuns.filter(
    (r) =>
      r.paymentMode === "real" &&
      Number.isFinite(Number(r.paymentAttempts)) &&
      Number(r.paymentAttempts) > 0,
  );
  const settlementAttempts = settlementRuns.reduce(
    (sum, r) => sum + Number(r.paymentAttempts),
    0,
  );
  const settledAttempts = settlementRuns.reduce(
    (sum, r) => sum + Number(r.settledPayments ?? 0),
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
    externalPayments: externalPayments.length,
    externalVolumeUsdc: round(externalVolume),
    enginePayments: payments.length - externalPayments.length,
    engineVolumeUsdc: round(volume - externalVolume),
    externalQueries: externalRuns.length,
    engineQueries: runRows.length - externalRuns.length,
    externalPayingQueries: externalPayingIds.size,
    externalReaderToPayerConversion: externalRuns.length
      ? round(externalPayingIds.size / externalRuns.length)
      : 0,
    externalCreatorPayoutsUsdc: round(externalCreatorVolume),
    externalAvgCostPerQueryUsdc: externalRuns.length
      ? round(externalCreatorVolume / externalRuns.length)
      : 0,
    identifiedExternalActors: queriesByActor.size,
    returningExternalActors: returningActors,
    returningExternalActorRate: queriesByActor.size
      ? round(returningActors / queriesByActor.size)
      : 0,
    externalDurationSamples: durations.length,
    externalAvgDurationMs: durations.length
      ? Math.round(durations.reduce((sum, n) => sum + n, 0) / durations.length)
      : 0,
    externalP95DurationMs: percentile95(durations),
    externalConfidenceSamples: confidence.length,
    externalHighConfidenceRate: confidence.length
      ? round(confidence.filter((level) => level === "High").length / confidence.length)
      : 0,
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
    externalFeedbackTotal: externalFeedback.length,
    externalSatisfactionRate: externalFeedback.length
      ? round(externalFeedback.filter((f) => f.rating === "up").length / externalFeedback.length)
      : 0,
    externalSettlementAttempts: settlementAttempts,
    externalSettledPayments: settledAttempts,
    externalSettlementSuccessRate: settlementAttempts
      ? round(settledAttempts / settlementAttempts)
      : 0,
    mcpClientQueries: [...mcpChannels.entries()]
      .map(([client, counts]) => ({ client, ...counts }))
      .sort((a, b) => b.queries - a.queries || a.client.localeCompare(b.client)),
  };
}
