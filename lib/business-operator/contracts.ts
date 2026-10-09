import { z } from "zod";

const microPattern = /^(0|[1-9][0-9]{0,15})$/;
const micro = z.string().regex(microPattern).refine(value => microPattern.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const completionLatencySummary = z.object({
  completed: count, timedSamples: count, p50Ms: count.nullable(), p95Ms: count.nullable(),
}).strict();
export const operatorInventorySchema = z.object({
  observedAt: z.string().datetime(), network: z.enum(["eip155:5042", "eip155:5042002"]),
  queuedJobs: count, processingJobs: count, reviewRequiredJobs: count, invalidJobs: count,
  queuedCreatorMicroUsdc: micro, unfinishedCreatorMicroUsdc: micro, prepaidCreatorMicroUsdc: micro,
  prepaidRequests: count, largestCreatorMicroUsdc: micro,
}).strict();
export type OperatorInventory = z.infer<typeof operatorInventorySchema>;

export const operatorDecisionSchema = z.object({
  action: z.enum(["idle", "run-next", "hold", "review"]),
  reason: z.enum(["no-orders", "liquidity-covered", "liquidity-unavailable", "liquidity-short",
    "policy-cap", "incomplete-inventory", "original-job-needs-review", "another-job-active", "acceptance-paused"]),
  liquidity: z.enum(["covered", "short", "unknown", "not-needed"]),
  observedAt: z.string().datetime(),
}).strict();
export type OperatorDecision = z.infer<typeof operatorDecisionSchema>;

/** Private observed capacity; a forecast is never payment/funding authority. */
export interface OperatorLiquidity {
  availableMicroUsdc: string; retainedMicroUsdc: string; confirmedMicroUsdc: string;
  lifetimeCapMicroUsdc: string; queryCapMicroUsdc: string;
}

/** Identifier-free public projection. Exact books, signer and audit files stay private. */
export const operatorBusinessStatusSchema = z.object({
  version: z.literal(1), network: z.enum(["eip155:5042", "eip155:5042002"]),
  operator: z.object({
    state: z.enum(["disabled", "idle", "working", "held", "review", "stale", "unavailable"]),
    observedAt: z.string().datetime().nullable(), decision: operatorDecisionSchema.nullable(),
    auditRecorded: z.boolean(),
  }).strict(),
  jobs: z.object({
    queued: count, processing: count, reviewRequired: count,
    completedLast24h: count, failedLast24h: count,
    completionRateLast24h: z.number().min(0).max(1).nullable(),
    oldestQueuedAgeSeconds: count.nullable(), oldestProcessingAgeSeconds: count.nullable(),
    completionLatencyP50Ms: count.nullable(), completionLatencyP95Ms: count.nullable(),
    // A rolling legacy SQL response has no marker capability, never zero ordinary latency.
    completionLatencyCohorts: z.object({ ordinary: completionLatencySummary,
      recovered: completionLatencySummary, unknown: completionLatencySummary }).strict().nullable().default(null),
    degraded: z.boolean(),
  }).strict().nullable(),
  creatorCatalog: z.object({ registered: count.nullable() }).strict(),
}).strict();
export type OperatorBusinessStatus = z.infer<typeof operatorBusinessStatusSchema>;
export const operatorPublicSnapshotSchema = operatorBusinessStatusSchema.pick({ jobs: true, creatorCatalog: true });
export type OperatorPublicSnapshot = z.infer<typeof operatorPublicSnapshotSchema>;

export const OPERATOR_REASON_TEXT: Record<OperatorDecision["reason"], string> = {
  "no-orders": "No prepaid research order is waiting.",
  "liquidity-covered": "Observed capacity covers unfinished creator budgets inside the original policy.",
  "liquidity-unavailable": "Original treasury capacity could not be verified. Orders remain queued.",
  "liquidity-short": "Unfinished creator obligations exceed observed capacity. Owner funding review is needed.",
  "policy-cap": "An accepted obligation exceeds the original treasury policy. Owner review is needed.",
  "incomplete-inventory": "The selected-network obligation inventory is unavailable or inconsistent.",
  "original-job-needs-review": "An original started job needs reconciliation. It will not be purchased again.",
  "another-job-active": "Another accepted job is active. This worker waits without claiming another order.",
  "acceptance-paused": "A finite acceptance policy is active. Paid originals stay queued.",
};
