const integer = (maximum: number) => ({ type: "integer", minimum: 0, maximum });
const operand = { type: "string", maxLength: 32, description: "Canonical actual finite Number operand; no rounded integer authority." };
const amount = { type: ["string", "null"], pattern: "^(0|[1-9][0-9]{0,15})$", description: "Representable input assertion; null propagates where monetary inputs are unavailable." };
const array = (items: unknown, maxItems: number) => ({ type: "array", items, maxItems });
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const refs = array(integer(10000), 48);
const optimizer = { oneOf: [object({ status: { const: "unavailable" }, reason: { enum: ["unsupported-input", "capture-bound", "source-policy-mismatch", "capture-failed"] } }),
  object({ status: { const: "available" }, policy: { const: "claim-coverage-replay-v1" }, sourcePolicy: { const: "claim-coverage-v1" }, facts: { const: "assertions" },
    input: object({ claimCount: integer(32), attentionLimit: integer(32), fetchBudget: operand, fetchBudgetMicros: amount,
      candidates: array(object({ candidate: integer(10000), documentGroup: integer(256), idRank: integer(255), action: { enum: ["BUY", "SKIP", "CACHE"] },
        price: operand, priceMicros: amount, expectedValue: operand, targets: array(integer(10000), 10000), public: { type: "boolean" } }), 256) }),
    ties: array(object({ left: refs, right: refs, comparison: { enum: [-1, 0, 1] } }), 1024),
    outcome: object({ selectionMethod: { enum: ["exhaustive", "bounded-heuristic"] }, evaluatedStates: integer(20000), eligibleCandidates: integer(256),
      attentionLimit: integer(32), selected: refs, cap: operand, reserved: operand, unused: operand, capMicros: amount, reservedMicros: amount, unusedMicros: amount,
      predictedCoveredClaims: integer(32), claims: array(object({ claimIndex: integer(31), selected: refs, coverage: operand }), 32) }) })] };
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function optimizerCaptureOpenApi(v2: { properties: Record<string, unknown> }) {
  const packet = v2.properties.packet; if (!record(packet) || !record(packet.properties)) throw Error("Invalid legacy capture grammar");
  return { ...v2, properties: { ...v2.properties, packet: object({ ...packet.properties,
    schema: { const: 3 }, policy: { const: "ordinary-read-optimizer-v3" }, coverage: { const: "normalization-optimizer-read-checkpoints" }, optimizer }) } };
}
