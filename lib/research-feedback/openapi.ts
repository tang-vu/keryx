const observationProperties = {
  format: { type: "string", const: "keryx-recorded-job-observations-v1" },
  generationDurationMs: { type: ["integer", "null"], minimum: 0, description: "Recorded orchestrator completion duration; not time to first token or full client latency." },
  durationBasis: { type: "string", const: "recorded-orchestrator-completion" },
  modelCostUsd: { type: ["object", "null"], additionalProperties: false, required: ["lower", "upper"], properties: {
    lower: { type: "number", minimum: 0 }, upper: { type: "number", minimum: 0 },
  }, description: "Partial estimate from recorded usage and captured per-call pricing, or null. Bounds do not include missing/unpriced calls." },
  costBasis: { type: "string", const: "partial-captured-policy-estimate" },
  recordedCalls: { type: "integer", minimum: 0 }, failedCalls: { type: "integer", minimum: 0 }, pendingCalls: { type: "integer", minimum: 0 },
  missingUsageCalls: { type: "integer", minimum: 0 }, unpricedUsageRecords: { type: "integer", minimum: 0 }, usageRecords: { type: "integer", minimum: 0 },
  excluded: { type: "string", const: "search-infrastructure-gas-and-unrecorded-provider-charges" }, invoice: { type: "null" }, profit: { type: "null" },
};
const runId = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$", description: "Ordinary public completion; private prv_ and prepaid a2a_ originals excluded." };
const opinion = { type: "object", additionalProperties: false, required: ["choice"], properties: {
  choice: { type: "string", enum: ["useful", "revise", "reject"] },
  reason: { type: "string", maxLength: 1000, default: "", description: "Optional private well-formed UTF-16 text; bounded control characters. Never part of the public run/export." },
} };
export const requesterFeedbackOpenApiSecurityScheme = {
  type: "http", scheme: "bearer",
  description: "Private original-response capability, derived for this purpose and bound to deployment origin, network, independent store identity, run/content digest, observations and 30-day expiry. No API key/session/wallet substitution or public-ID recovery. Keep in original client memory; never put in URLs, storage, public exports or analytics.",
};
export const requesterFeedbackOpenApiSchemas = {
  RecordedJobObservations: { type: "object", additionalProperties: false, required: Object.keys(observationProperties), properties: observationProperties },
  PrivateRequesterObservations: { type: "object", additionalProperties: false, required: ["format", "runId", "observations", "feedback"], properties: {
    format: { type: "string", const: "keryx-private-requester-observation-v1" }, runId,
    observations: { $ref: "#/components/schemas/RecordedJobObservations" },
    feedback: { type: ["object", "null"], additionalProperties: false, required: ["token", "expiresAt", "endpoint"], properties: {
      token: { type: "string", minLength: 80, maxLength: 2048, readOnly: true }, expiresAt: { type: "string", format: "date-time" },
      endpoint: { type: "string", const: "/api/research-feedback" },
    }, description: "Null when optional private metadata/authentication is unavailable; observations remain usable. Original-response transport only." },
  } },
  RequesterFeedback: { ...opinion, required: ["format", "runId", "deliveredDigest", "choice", "reason", "submittedAt", "observations"], properties: {
    ...opinion.properties, format: { type: "string", const: "keryx-requester-feedback-v1" }, runId,
    deliveredDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, submittedAt: { type: "string", format: "date-time" },
    observations: { $ref: "#/components/schemas/RecordedJobObservations" },
  } },
  RequesterFeedbackResponse: { type: "object", additionalProperties: false, required: ["format", "runId", "deliveredDigest", "feedback", "execution"], properties: {
    format: { type: "string", const: "keryx-requester-feedback-response-v1" }, runId, deliveredDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    feedback: { oneOf: [{ type: "null" }, { $ref: "#/components/schemas/RequesterFeedback" }] }, execution: { type: "string", const: "none" },
  } },
};
export const privateRequesterOpenAiProperty = { keryx_private_requester: { $ref: "#/components/schemas/PrivateRequesterObservations" } };
export const requesterFeedbackOpenApiPaths = {
  "/api/research-feedback": { post: {
    operationId: "readOrSubmitRequesterFeedback", tags: ["Research"], summary: "Read or record one original caller's private usefulness opinion",
    security: [{ RequesterFeedbackCapability: [] }],
    description: "Bearer verified before body/store/run access. POST read records no opinion. First explicit choice is immutable; exact replay is idempotent, changed choice/reason conflicts. Current retained run must match the original content digest. Silence is null. This never executes research, revision, refund, payment or renewal. No ownership/human identity, general usefulness rate or profitability is inferred. Private no-store/no-referrer responses; no GET or public lookup.",
    requestBody: { required: true, content: { "application/json": { schema: { oneOf: [
      { type: "object", additionalProperties: false, required: ["operation"], properties: { operation: { type: "string", const: "read" } } },
      { ...opinion, required: ["operation", "choice"], properties: { operation: { type: "string", const: "submit" }, ...opinion.properties } },
    ] }, description: "At most4096 UTF-8 bytes;10-second body deadline." } } },
    responses: {
      "200": { description: "Exact matching run/digest, feedback row or null, execution:none. A confirmed row includes original observations and private reason; never a new paid execution.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/RequesterFeedbackResponse" } } } },
      "400": { description: "Closed bounded input refused." }, "401": { description: "Absent/invalid/expired or wrong store/deployment capability." },
      "409": { description: "Original changed/missing or a different opinion already recorded; read current state explicitly." },
      "503": { description: "Optional configured metadata journal or retained original unavailable; no fallback and no automatic retry." },
    },
  } },
};
