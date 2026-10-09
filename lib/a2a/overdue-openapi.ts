const nullableTime = { type: ["string", "null"], format: "date-time" };
export const paidJobEscalationOpenApiSchemas = {
  PaidJobEscalation: {
    type: "object", additionalProperties: false,
    description: "Read-only observation of the original accepted provisional target. No scheduler, delivery notification, staffed support or automatic remedy is implied. Unavailable provenance stays explicit. Completed retained responses and receipts do not gain this dynamic field.",
    required: ["state", "escalationNeeded", "observedAt", "acceptedAt", "targetCompletionAt", "targetCompletionMs", "elapsedMs", "lastRecordedStage", "failureCode", "creatorPaymentState", "evaluation", "objectiveKind", "remedy"],
    properties: {
      state: { type: "string", enum: ["within_target", "overdue", "completed", "unavailable"] },
      escalationNeeded: { type: ["boolean", "null"], description: "True only when overdue; null when target timing is unavailable." },
      observedAt: nullableTime, acceptedAt: nullableTime, targetCompletionAt: nullableTime,
      targetCompletionMs: { type: ["integer", "null"], minimum: 1 }, elapsedMs: { type: ["integer", "null"], minimum: 0 },
      lastRecordedStage: { type: "string", enum: ["queued", "research_started", "creator_payment_boundary", "result_save_boundary", "unknown"] },
      failureCode: { type: ["string", "null"], enum: ["research_failed", "invalid_order_data", "operator_reviewed_no_result", "unknown", null] },
      creatorPaymentState: { type: "string", enum: ["pending_recorded", "payment_boundary_crossed", "no_creator_call_recorded", "unknown"], description: "Pending does not become failed on expiry. Missing/definitive rows do not clear a crossed payment boundary." },
      evaluation: { type: "string", const: "on_observation" }, objectiveKind: { type: "string", const: "provisional_slo" }, remedy: { type: "string", const: "none" },
    },
  },
};
export const paidJobEscalationOpenApiProperty = { $ref: "#/components/schemas/PaidJobEscalation" };
