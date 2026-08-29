import type { Decision, PaymentRecord, QueryRun } from "../types";
import type { AgentEvalCase, EvalCaseResult, EvalMetrics, EvalRunObservation } from "./types";

const EPSILON = 1e-9;

function ratio(hit: number, total: number): number {
  return total === 0 ? 1 : hit / total;
}

function mean(values: number[]): number {
  return values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sourceDecision(decisions: Decision[], sourceId: string): Decision | undefined {
  return decisions.find((decision) => decision.sourceId === sourceId);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function gradeAgentRun(testCase: AgentEvalCase, observation: EvalRunObservation): EvalCaseResult {
  const { run, payments } = observation;
  const fetches = payments.filter((payment) => payment.kind === "fetch");
  const citedSourceIds = unique(run.citations.map((citation) => citation.sourceId));
  const readSourceIds = unique(fetches.map((payment) => payment.sourceId));
  const allowedCitations = new Set(testCase.expected.allowedCitationSourceIds);
  const requiredCitations = testCase.expected.requiredCitationSourceIds ?? [];
  const allowedReads = new Set(testCase.expected.allowedReadSourceIds ?? testCase.expected.allowedCitationSourceIds);
  const requiredReads = testCase.expected.requiredReadSourceIds ?? [];
  const forbiddenReads = new Set(testCase.expected.forbiddenReadSourceIds ?? []);
  const decisionEntries = Object.entries(testCase.expected.decisions ?? {});
  const grounded = (run.claimCoverage ?? []).filter((claim) => claim.coverage >= 0.4).length;
  const groundedClaimRate = ratio(grounded, run.subClaims.length);
  const qualifyingEvidenceSources = new Set(
    (run.evidence ?? []).filter((evidence) => evidence.qualifiesForReward).map((evidence) => evidence.sourceId),
  );

  const metrics: EvalMetrics = {
    citationPrecision: ratio(citedSourceIds.filter((id) => allowedCitations.has(id)).length, citedSourceIds.length),
    citationRecall: ratio(requiredCitations.filter((id) => citedSourceIds.includes(id)).length, requiredCitations.length),
    readPrecision: ratio(readSourceIds.filter((id) => allowedReads.has(id)).length, readSourceIds.length),
    readRecall: ratio(requiredReads.filter((id) => readSourceIds.includes(id)).length, requiredReads.length),
    decisionAccuracy: ratio(
      decisionEntries.filter(([id, action]) => sourceDecision(run.decisions, id)?.action === action).length,
      decisionEntries.length,
    ),
    groundedClaimRate,
    evidenceYield: ratio(qualifyingEvidenceSources.size, readSourceIds.length),
    spendEfficiency:
      run.totalSpent <= EPSILON
        ? readSourceIds.length === 0 ? 1 : 0
        : Math.min(1, qualifyingEvidenceSources.size / Math.max(1, readSourceIds.length)),
  };

  const hardFailures: string[] = [];
  if (run.paymentMode !== "offline") hardFailures.push(`payment mode was ${run.paymentMode ?? "unknown"}, expected offline`);
  if ((run.settledPayments ?? 0) !== 0) hardFailures.push("evaluation produced a settled payment");
  if ((run.pendingPayments ?? 0) !== 0) hardFailures.push("evaluation produced a pending authorization");
  if (payments.some((payment) => payment.settlementStatus !== "simulated" || payment.settled || payment.txHash)) {
    hardFailures.push("payment ledger contains non-simulated settlement evidence");
  }
  if (run.totalSpent > testCase.budget + EPSILON) hardFailures.push("run exceeded the user budget");
  if (Math.abs(run.totalSpent - run.totalToCreators) > EPSILON) {
    hardFailures.push("total spend and creator allocation diverged");
  }
  const recordedAmount = payments.reduce((sum, payment) => sum + payment.amountUsdc, 0);
  if (Math.abs(run.totalSpent - recordedAmount) > EPSILON) {
    hardFailures.push("run spend does not reconcile to the isolated payment ledger");
  }
  const maxSpent = testCase.expected.maxTotalSpentUsdc ?? testCase.budget;
  if (run.totalSpent > maxSpent + EPSILON) hardFailures.push(`run spent ${run.totalSpent}, expected at most ${maxSpent}`);
  for (const sourceId of readSourceIds) {
    if (forbiddenReads.has(sourceId)) hardFailures.push(`forbidden source ${sourceId} was read`);
  }
  for (const sourceId of citedSourceIds) {
    if (!allowedCitations.has(sourceId)) hardFailures.push(`unexpected source ${sourceId} was cited`);
  }
  if (groundedClaimRate + EPSILON < (testCase.expected.minGroundedClaimRate ?? 0)) {
    hardFailures.push(`grounded claim rate ${groundedClaimRate.toFixed(3)} was below the case floor`);
  }

  // Raw coverage is diagnostic, but abstaining on a deliberately unanswerable case is success.
  // Score the scenario goal rather than rewarding hallucinated coverage.
  const coverageGoal = (testCase.expected.minGroundedClaimRate ?? 0) <= 0 && requiredCitations.length === 0
    ? (citedSourceIds.length === 0 ? 1 : 0)
    : metrics.groundedClaimRate;
  const score = 100 * (
    0.2 * metrics.citationPrecision +
    0.15 * metrics.citationRecall +
    0.15 * metrics.readPrecision +
    0.1 * metrics.readRecall +
    0.15 * metrics.decisionAccuracy +
    0.15 * coverageGoal +
    0.05 * metrics.evidenceYield +
    0.05 * metrics.spendEfficiency
  );

  return {
    caseId: testCase.id,
    description: testCase.description,
    score: Math.round(score * 100) / 100,
    passed: hardFailures.length === 0,
    hardFailures,
    metrics,
    summary: {
      citedSourceIds,
      readSourceIds,
      totalSpentUsdc: run.totalSpent,
      durationMs: run.durationMs ?? 0,
      confidence: run.confidence,
    },
  };
}

export function aggregateMetrics(results: EvalCaseResult[]): EvalMetrics {
  const keys: Array<keyof EvalMetrics> = [
    "citationPrecision", "citationRecall", "readPrecision", "readRecall",
    "decisionAccuracy", "groundedClaimRate", "evidenceYield", "spendEfficiency",
  ];
  return Object.fromEntries(keys.map((key) => [key, mean(results.map((result) => result.metrics[key]))])) as unknown as EvalMetrics;
}

export function assertOnlySimulatedPayments(payments: PaymentRecord[]): void {
  if (payments.some((payment) => payment.settlementStatus !== "simulated" || payment.settled || payment.txHash)) {
    throw new Error("Agent evaluation safety violation: a payment was not an explicit offline simulation");
  }
}
