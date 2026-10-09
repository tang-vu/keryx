import { z } from "zod";

const timestamp = z.string().datetime({ offset: true }).nullable();
export const paidJobEscalationSchema = z.object({
  state: z.enum(["within_target", "overdue", "completed", "unavailable"]),
  escalationNeeded: z.boolean().nullable(),
  observedAt: timestamp,
  acceptedAt: timestamp,
  targetCompletionAt: timestamp,
  targetCompletionMs: z.number().int().positive().nullable(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  lastRecordedStage: z.enum(["queued", "research_started", "creator_payment_boundary", "result_save_boundary", "unknown"]),
  failureCode: z.enum(["research_failed", "invalid_order_data", "operator_reviewed_no_result", "unknown"]).nullable(),
  creatorPaymentState: z.enum(["pending_recorded", "payment_boundary_crossed", "no_creator_call_recorded", "unknown"]),
  evaluation: z.literal("on_observation"),
  objectiveKind: z.literal("provisional_slo"),
  remedy: z.literal("none"),
}).strict().refine(value => value.escalationNeeded === (value.state === "unavailable" ? null : value.state === "overdue"), {
  message: "Escalation state is inconsistent",
});
export type PaidJobEscalation = z.infer<typeof paidJobEscalationSchema>;

/** Owner-only original references, never part of public Operator aggregates or bearer job status. */
export const originalOrderPaymentSchema = z.object({
  kind: z.enum(["inbound_payment", "monthly_allocation"]),
  reference: z.string().max(256).nullable(),
  network: z.enum(["eip155:5042", "eip155:5042002"]).nullable(),
  asset: z.literal("USDC"),
  amountMicros: z.string().regex(/^(?:0|[1-9]\d*)$/).nullable(),
}).strict();
