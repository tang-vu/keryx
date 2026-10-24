import { z } from "zod";

export const feedbackChoiceSchema = z.enum(["useful", "revise", "reject"]);
export const feedbackInputSchema = z.object({
  choice: feedbackChoiceSchema,
  reason: z.string().max(1000).refine(value => value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).default(""),
}).strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export const feedbackRowSchema = feedbackInputSchema.extend({
  format: z.literal("keryx-requester-feedback-v1"),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !/^(prv_|a2a_)/.test(value)),
  deliveredDigest: z.string().regex(/^[a-f0-9]{64}$/), submittedAt: z.string().datetime(),
}).strict();
export type RequesterFeedback = z.infer<typeof feedbackRowSchema>;
export interface RequesterFeedbackStore {
  readonly storeId: string;
  assertAvailable(): void;
  read(id: string): Promise<RequesterFeedback | null>;
  /** First choice wins; an exact repeated submission returns its original timestamp. */
  submit(row: RequesterFeedback): Promise<RequesterFeedback>;
}
export class FeedbackError extends Error {
  constructor(readonly code: "feedback_unavailable" | "feedback_unauthenticated" | "feedback_conflict") { super(code); }
}

export const jobObservationsSchema = z.object({
  format: z.literal("keryx-recorded-job-observations-v1"),
  generationDurationMs: z.number().int().nonnegative().nullable(),
  durationBasis: z.literal("recorded-orchestrator-completion"),
  modelCostUsd: z.object({ lower: z.number().finite().nonnegative(), upper: z.number().finite().nonnegative() }).nullable(),
  costBasis: z.literal("partial-captured-policy-estimate"),
  recordedCalls: z.number().int().nonnegative(), failedCalls: z.number().int().nonnegative(),
  pendingCalls: z.number().int().nonnegative(), missingUsageCalls: z.number().int().nonnegative(),
  unpricedUsageRecords: z.number().int().nonnegative(), usageRecords: z.number().int().nonnegative(),
  excluded: z.literal("search-infrastructure-gas-and-unrecorded-provider-charges"),
  invoice: z.null(), profit: z.null(),
}).strict();
export type JobObservations = z.infer<typeof jobObservationsSchema>;
export const feedbackDeliverySchema = z.object({
  format: z.literal("keryx-private-requester-observation-v1"),
  runId: feedbackRowSchema.shape.runId,
  observations: jobObservationsSchema,
  feedback: z.object({ token: z.string().min(80).max(2048), expiresAt: z.string().datetime(),
    endpoint: z.literal("/api/research-feedback") }).strict().nullable(),
}).strict();
export type FeedbackDelivery = z.infer<typeof feedbackDeliverySchema>;
export const feedbackResponseSchema = z.object({
  format: z.literal("keryx-requester-feedback-response-v1"), runId: feedbackRowSchema.shape.runId,
  deliveredDigest: feedbackRowSchema.shape.deliveredDigest, feedback: feedbackRowSchema.nullable(), execution: z.literal("none"),
}).strict().refine(value => value.feedback === null || value.feedback.runId === value.runId && value.feedback.deliveredDigest === value.deliveredDigest);
export type FeedbackResponse = z.infer<typeof feedbackResponseSchema>;
