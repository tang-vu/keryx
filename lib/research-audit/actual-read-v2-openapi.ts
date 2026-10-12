const integer = { type: "integer", minimum: 0, maximum: 10000 };
const operand = { type: "string", maxLength: 32, description: "Canonical finite actual Number operand; no rounded integer authority." };
const amount = { type: ["string", "null"], pattern: "^(0|[1-9][0-9]{0,15})$", description: "Exact representable assertion, otherwise unavailable." };
const bool = { type: "boolean" };
const action = { enum: ["BUY", "SKIP", "CACHE"] };
const array = (items: unknown, maxItems = 256) => ({ type: "array", maxItems, items });
const indices = array(integer, 10000);
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export function runtimeCaptureOpenApi(legacyRecords: unknown) {
  const mappings = array(object({ input: object({ candidate: integer, proposal: action, matched: bool, duplicate: bool, external: bool,
    public: bool, claimCount: integer, targets: indices }), outcome: object({ action: { enum: ["BUY", "SKIP", "CACHE", "DROP"] }, targets: indices }) }));
  const normalizations = array(object({ input: object({ candidate: integer, proposal: { enum: ["BUY", "SKIP", "CACHE", "UNKNOWN"] }, mapped: action,
    price: operand, expectedValue: operand, claimCount: integer, targets: indices, allowedTargets: indices,
    freshCache: bool, originalPage: bool, discussion: bool, attentionFloor: operand }),
    outcome: object({ action, targets: indices, priceMicros: amount, rule: { enum: ["unchanged", "discussion", "cache-expired", "preview", "attention"] } }) }));
  const portfolio = object({ policy: { const: "claim-coverage-v1" }, replay: { const: "unavailable" },
    input: object({ claimCount: integer, attentionLimit: { ...integer, maximum: 32 }, fetchBudget: operand,
      candidates: array(object({ candidate: integer, documentGroup: integer, action, price: operand, expectedValue: operand, targets: indices, public: bool })) }),
    outcome: object({ selected: indices, selectionMethod: { enum: ["exhaustive", "bounded-heuristic"] }, evaluatedStates: { ...integer, maximum: 20000 },
      cap: operand, reserved: operand, capMicros: amount, reservedMicros: amount }) });
  return object({ status: { const: "available" }, retainedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, packet: object({
    schema: { const: 2 }, policy: { const: "ordinary-read-capture-v2" }, coverage: { const: "normalization-and-read-checkpoints" },
    monetaryAuthority: { const: "qualified-assertions-only" }, records: { ...(legacyRecords as object), minItems: 0 }, mappings, normalizations,
    portfolio: { oneOf: [portfolio, { type: "null" }] }, stops: array(object({ afterCheckpoint: { ...integer, maximum: 256 },
      stage: { enum: ["discovery", "evidence"] }, count: { const: 0 }, action: { const: "STOP" } })),
    observations: object({ actions: array(object({ candidate: integer, action, price: operand, priceMicros: amount })),
      citations: array(object({ candidate: integer, reward: operand, rewardMicros: amount })),
      payments: array(object({ candidate: integer, kind: { enum: ["fetch", "citation", "inbound", "operating-fee"] }, amount: operand, amountMicros: amount,
        status: { enum: ["settled", "pending", "failed", "simulated", "unknown"] }, settled: bool })) }) }) });
}
