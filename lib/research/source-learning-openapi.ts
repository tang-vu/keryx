const count = { type: "integer", minimum: 0, maximum: 300 };
const weight = { type: ["number", "null"], minimum: 0, maximum: 1 };
const micros = { type: "string", pattern: "^(0|[1-9][0-9]{0,29})$" };
const time = { type: ["string", "null"], format: "date-time" };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const sourceLearningOpenApiPath = { get: {
  operationId: "getSourceLearning", summary: "Read the public observational source/topic record", security: [],
  description: "Same bounded aggregate as the creator page and remote/stdio MCP. Only retained write-time independent outside actor/funding evidence qualifies. Source owners and known beneficiaries, private jobs, unknown/legacy/synthetic traffic and unavailable payout authority cannot improve the estimate. At most one source/topic/run and one attested actor per UTC day. Topics come only from the source's public tags, never arbitrary question vocabulary. This is recorded settlement evidence, not new Circle or chain verification. Descriptive citation/contribution estimates do not measure factual accuracy or causal value. Live learned selection and exploration remain withheld; allowance is zero. No research, source reads, spending, signing or policy activation.",
  parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", pattern: "^[a-zA-Z0-9_-]+$", minLength: 1, maxLength: 128 } }],
  responses: { "200": { description: "Bounded public source record; no-store.", content: { "application/json": { schema: object({
    schemaVersion: { const: "keryx-source-learning-v1" }, sourceId: { type: "string" }, network: { enum: ["eip155:5042", "eip155:5042002"] },
    status: { const: "observational-live-selection-withheld" }, counting: { const: "one-source-topic-run-and-one-attested-actor-per-utc-day" },
    settlementEvidence: { const: "recorded-only-not-revalidated" }, scanLimit: { const: 300 }, sampleLimit: { const: 60 },
    excludedObservations: count, historicalUnclassifiedRuns: count,
    records: { type: "array", maxItems: 12, items: object({ topic: { type: "string", pattern: "^[a-z0-9]{3,40}$" },
      offered: count, read: count, cached: count, bought: count, cited: count, smoothedCitationRate: weight, uncertainty: weight,
      averageContribution: weight, averagePriceMicros: object({ numerator: micros, denominator: count }), shiftFlag: { type: "boolean" },
      firstObservedAt: time, lastObservedAt: time }) },
    exploration: object({ liveFractionBps: { const: 0 }, liveAllowanceMicros: { const: "0" }, status: { const: "withheld-pending-policy-and-authority-acceptance" } }),
  }) } } }, "400": { description: "Invalid source ID or any query selector; no storage read" },
    "404": { description: "Source not found" }, "503": { description: "Source learning record unavailable; no private diagnostics or inferred zero" } },
} };
