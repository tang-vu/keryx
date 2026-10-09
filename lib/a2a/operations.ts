import {
  A2A_QUEUE_SLA_MS,
  A2A_REVIEW_AFTER_MS,
  type A2aOrderStatus,
} from "./order";
import { completionLatencyCohorts, recordedCompletionCohort, type CompletionMarkers,
  type CompletionLatencyCohorts, type CompletionLatencyCohort } from "./completion-latency";

export interface A2aOperationsRow extends CompletionMarkers {
  status: A2aOrderStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
}

export interface A2aOperationsSnapshot {
  queued: number;
  processing: number;
  reviewRequired: number;
  completedLast24h: number;
  failedLast24h: number;
  completionRateLast24h: number | null;
  oldestQueuedAgeSeconds: number | null;
  oldestProcessingAgeSeconds: number | null;
  completionLatencyP50Ms: number | null;
  completionLatencyP95Ms: number | null;
  /** createdAt→updatedAt timing, including later bookkeeping. Old percentiles stay mixed; null means markers unavailable. */
  completionLatencyCohorts: CompletionLatencyCohorts | null;
  degraded: boolean;
}

function ageMs(then: string, nowMs: number): number | null {
  const parsed = Date.parse(then);
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

/** Builds the public, identifier-free A2A operations view from private order rows. */
export function summarizeA2aOperations(
  rows: A2aOperationsRow[],
  nowMs: number,
  completionMarkersAvailable = false,
): A2aOperationsSnapshot {
  const sinceMs = nowMs - 24 * 60 * 60_000;
  let queued = 0;
  let processing = 0;
  let reviewRequired = 0;
  let completedLast24h = 0;
  let failedLast24h = 0;
  let oldestQueuedMs: number | null = null;
  let oldestProcessingMs: number | null = null;
  const completionLatencies: number[] = [];
  const cohorts = completionMarkersAvailable ? completionLatencyCohorts() : null;
  const cohortLatencies: Record<CompletionLatencyCohort, number[]> = { ordinary: [], recovered: [], unknown: [] };

  for (const row of rows) {
    if (row.status === "running") {
      if (!row.startedAt) {
        queued += 1;
        const queuedAge = ageMs(row.createdAt, nowMs);
        if (queuedAge !== null) oldestQueuedMs = Math.max(oldestQueuedMs ?? 0, queuedAge);
        continue;
      }
      const processingAge = ageMs(row.startedAt, nowMs);
      if (processingAge === null || processingAge >= A2A_REVIEW_AFTER_MS) {
        reviewRequired += 1;
      } else {
        processing += 1;
      }
      if (processingAge !== null) {
        oldestProcessingMs = Math.max(oldestProcessingMs ?? 0, processingAge);
      }
      continue;
    }

    const updatedMs = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedMs) || updatedMs < sinceMs || updatedMs > nowMs) continue;
    if (row.status === "completed") {
      completedLast24h += 1;
      const cohort = cohorts ? recordedCompletionCohort(row) : null;
      if (cohort) cohorts![cohort].completed += 1;
      const createdMs = Date.parse(row.createdAt);
      if (Number.isFinite(createdMs) && updatedMs >= createdMs) {
        completionLatencies.push(updatedMs - createdMs);
        if (cohort) cohortLatencies[cohort].push(updatedMs - createdMs);
      }
    } else {
      failedLast24h += 1;
    }
  }

  const terminalLast24h = completedLast24h + failedLast24h;
  if (cohorts) for (const cohort of ["ordinary", "recovered", "unknown"] as const) {
    const samples = cohortLatencies[cohort];
    cohorts[cohort].timedSamples = samples.length;
    cohorts[cohort].p50Ms = percentile(samples, 0.5);
    cohorts[cohort].p95Ms = percentile(samples, 0.95);
  }
  return {
    queued,
    processing,
    reviewRequired,
    completedLast24h,
    failedLast24h,
    completionRateLast24h:
      terminalLast24h === 0
        ? null
        : Math.round((completedLast24h / terminalLast24h) * 10_000) / 10_000,
    oldestQueuedAgeSeconds:
      oldestQueuedMs === null ? null : Math.floor(oldestQueuedMs / 1_000),
    oldestProcessingAgeSeconds:
      oldestProcessingMs === null ? null : Math.floor(oldestProcessingMs / 1_000),
    completionLatencyP50Ms: percentile(completionLatencies, 0.5),
    completionLatencyP95Ms: percentile(completionLatencies, 0.95),
    completionLatencyCohorts: cohorts,
    degraded: reviewRequired > 0 || (oldestQueuedMs ?? 0) > A2A_QUEUE_SLA_MS,
  };
}
