import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { paidJobEscalationSchema, type PaidJobEscalation } from "../a2a/overdue-types";
import { z } from "zod";

/** Read the existing accepted package registry; never invent or amend its terms. */
export function jobCompletionTarget(mode: "quick" | "deep", version: string) {
  if (mode !== "quick" && mode !== "deep") return null;
  const researchPackage = a2aResearchPackageForVersion(mode, version);
  return researchPackage ? { tier: mode, seconds: researchPackage.serviceLevel.targetCompletionMs / 1000,
    startsAt: researchPackage.serviceLevel.startsAt, kind: researchPackage.serviceLevel.kind,
    remedy: researchPackage.serviceLevel.remedy } : null;
}

/** Remaining time on a retained server observation plus monotonic elapsed time.
 * A local warning is about stale status, never a fresh assertion of job/payment state.
 * Wall-clock skew, repair timestamps and payment expiry cannot restart this clock. */
export function jobTargetWarningDelay(escalation: PaidJobEscalation | undefined, elapsedSinceObservationMs: number): number | null {
  const parsed = paidJobEscalationSchema.safeParse(escalation);
  if (!parsed.success || parsed.data.state !== "within_target" ||
    !Number.isSafeInteger(elapsedSinceObservationMs) || elapsedSinceObservationMs < 0) return null;
  const value = parsed.data;
  if (!value.acceptedAt || !value.observedAt || !value.targetCompletionAt || value.elapsedMs === null ||
    ![180_000, 300_000].includes(value.targetCompletionMs ?? 0)) return null;
  const accepted = Date.parse(value.acceptedAt), observed = Date.parse(value.observedAt), deadline = Date.parse(value.targetCompletionAt);
  if (![accepted, observed, deadline].every(Number.isSafeInteger) || observed < accepted || observed > deadline ||
    observed - accepted !== value.elapsedMs || deadline - accepted !== value.targetCompletionMs) return null;
  // Existing service receipts consider the exact deadline met. Warn on the first ms after it.
  const remaining = deadline - observed + 1 - elapsedSinceObservationMs;
  return Number.isSafeInteger(remaining) ? Math.max(0, remaining) : null;
}

/** Customer display state only. Completion, ops transport and human/customer receipt
 * are separate facts; a browser timeout cannot turn a retained snapshot into a new read. */
export function jobTargetCustomerState(escalation: PaidJobEscalation | undefined, localWarning = false) {
  if (escalation === undefined) return "not_observed";
  const parsed = paidJobEscalationSchema.safeParse(escalation);
  if (!parsed.success || parsed.data.state === "unavailable") return "unavailable";
  const value = parsed.data;
  if (!value.acceptedAt || !value.observedAt || !value.targetCompletionAt || value.elapsedMs === null ||
    ![180_000, 300_000].includes(value.targetCompletionMs ?? 0)) return "unavailable";
  const accepted = Date.parse(value.acceptedAt), observed = Date.parse(value.observedAt), deadline = Date.parse(value.targetCompletionAt);
  if (![accepted, observed, deadline].every(Number.isSafeInteger) || observed < accepted ||
    observed - accepted !== value.elapsedMs || deadline - accepted !== value.targetCompletionMs) return "unavailable";
  if (value.state === "completed") return "completed_on_observation";
  if (value.state === "overdue") return observed > deadline ? "overdue_on_observation" : "unavailable";
  if (observed > deadline) return "unavailable";
  return localWarning ? "target_elapsed_since_observation" : "within_target_on_observation";
}

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = count.nullable();
const latencySummary = z.object({ completed: count, timedSamples: count, p50Ms: duration, p95Ms: duration }).strict()
  .refine(value => value.timedSamples <= value.completed && (value.timedSamples === 0
    ? value.p50Ms === null && value.p95Ms === null
    : value.p50Ms !== null && value.p95Ms !== null && value.p50Ms <= value.p95Ms));
const completionSnapshot = z.object({
  completedLast24h: count,
  completionLatencyCohorts: z.object({ ordinary: latencySummary, recovered: latencySummary, unknown: latencySummary }).strict().nullable(),
}).refine(value => value.completionLatencyCohorts === null ||
  Object.values(value.completionLatencyCohorts).reduce((sum, cohort) => sum + cohort.completed, 0) === value.completedLast24h);

/** Adapter for the existing whole operations snapshot, never a recent-row sample.
 * Do not rename createdAt -> updatedAt as settlement -> delivery, or use creator
 * payment timestamps as the original customer's inbound settlement timestamp. */
export function jobCompletionMetrics(snapshot: unknown) {
  const parsed = completionSnapshot.safeParse(snapshot);
  // This cohort-qualified metric is unavailable without marker capability,
  // even when the unchanged producer/public packet knows an aggregate total.
  const measured = parsed.success && parsed.data.completionLatencyCohorts !== null ? parsed.data : null;
  const unavailableTiming = { timedSamples: null, p50Ms: null, p95Ms: null };
  return {
    recordedCompletion: {
      basis: "original_acceptance_to_recorded_completion_update" as const,
      window: "recorded_completion_update_in_last_24_hours" as const,
      completed: measured ? measured.completedLast24h : null,
      cohorts: measured ? measured.completionLatencyCohorts : null,
    },
    // Current public order/payment/status inputs do not record these endpoints.
    // A completed receipt, tx reference or supplied-corpus usage latency is insufficient.
    paymentToDeliveredOutput: { basis: "original_inbound_settlement_to_customer_output_delivery" as const, ...unavailableTiming },
    firstUserFirstAnswer: { basis: "verified_first_user_arrival_to_first_answer" as const, ...unavailableTiming },
  };
}

const alertObservation = z.object({
  status: z.enum(["disabled", "unbound", "observed", "unavailable"]),
  coverage: z.enum(["not-observed", "complete", "partial"]),
  overdue: count, acknowledged: count, suppressed: count, unknown: count, deferred: count,
}).strict().refine(value => {
  if (value.status !== "observed") return value.coverage === "not-observed" &&
    [value.overdue, value.acknowledged, value.suppressed, value.unknown, value.deferred].every(n => n === 0);
  // Each overdue original is suppressed, deferred, or newly attempted. Only a
  // suppressed reservation can overlap unknown; deferred originals cannot.
  const newUnknownAttempts = value.overdue - value.acknowledged - value.suppressed - value.deferred;
  return value.coverage !== "not-observed" && (value.deferred === 0 || value.coverage === "partial") &&
    [value.acknowledged, value.suppressed, value.unknown, value.deferred].every(n => n <= value.overdue) &&
    newUnknownAttempts >= 0 && value.unknown >= newUnknownAttempts &&
    value.unknown <= newUnknownAttempts + value.suppressed;
});

/** Aggregate observer evidence only: it cannot identify a particular original,
 * prove a person's receipt, or confirm customer delivery on an open/closed page.
 * Unobserved OFF/unbound/error counters are unavailable, rather than measured zeros. */
export function jobAlertDeliveryObservation(observation: unknown) {
  const parsed = alertObservation.safeParse(observation);
  const measured = parsed.success && parsed.data.status === "observed" ? parsed.data : null;
  return {
    status: parsed.success ? parsed.data.status : "unavailable" as const,
    coverage: measured ? measured.coverage : "not-observed" as const,
    overdue: measured ? measured.overdue : null,
    transportAcknowledged: measured ? measured.acknowledged : null,
    suppressed: measured ? measured.suppressed : null,
    transportUnknown: measured ? measured.unknown : null,
    deferred: measured ? measured.deferred : null,
    responderReceived: null,
    customerStateDelivered: null,
    targetWindowMet: null,
    automaticResend: "not_authorized" as const,
  };
}
