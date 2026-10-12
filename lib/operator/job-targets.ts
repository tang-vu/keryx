import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { paidJobEscalationSchema, type PaidJobEscalation } from "../a2a/overdue-types";

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
