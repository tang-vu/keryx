import { ECONOMIC_EVENTS, ECONOMIC_POLICY } from "./economic-checkpoint";
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items: unknown) => ({ type: "array", maxItems: 256, items });
const integer = (maximum: number) => ({ type: "integer", minimum: 0, maximum });
const operand = { type: "string", maxLength: 32, description: "Canonical observed finite Number operand; exact micros require genuine representability without repair." };
const micro = { type: "string", pattern: "^(0|[1-9][0-9]{0,15})$" };
const context = { sequence: integer(255), afterCheckpoint: integer(256), candidate: integer(10000), round: integer(8) };
const budget = object({ ...context, status: { const: "available" }, kind: { const: "query-budget" }, event: { enum: ECONOMIC_EVENTS },
  input: object({ operation: { enum: ["reserve", "release", "add", "remaining", "hold"] }, before: operand, operands: array(operand) }),
  outcome: object({ beforeMicros: micro, afterMicros: micro }) });
const allocation = object({ ...context, status: { const: "available" }, kind: { const: "citation-allocation" }, event: { const: "attribution" },
  input: object({ sourceTotal: operand, total: operand, groups: array(integer(10000)),
    proposals: array(object({ group: integer(10000), weight: { oneOf: [operand, { type: "null" }] } })), eligible: array({ type: "boolean" }) }),
  outcome: object({ weights: array(operand), grossMicros: array(micro), rewardsMicros: array(micro) }) });
const authors = object({ ...context, status: { const: "available" }, kind: { const: "author-split" }, event: { const: "authors" },
  input: object({ total: operand, weights: array(operand) }), outcome: object({ legMicros: array(micro) }) });
const refused = object({ ...context, status: { const: "unavailable" }, kind: { enum: ["query-budget", "citation-allocation", "author-split", "reward-authority"] },
  event: { enum: ECONOMIC_EVENTS }, reason: { enum: ["nonmicro-input", "invalid-input", "output-disagreement", "capture-failed", "bounds", "authority-not-captured"] } });
export function economicCaptureOpenApi(v3: { properties: Record<string, unknown> }) {
  const packet = v3.properties.packet as { properties: Record<string, unknown> };
  return { ...v3, properties: { ...v3.properties, packet: object({ ...packet.properties,
    schema: { const: 4 }, policy: { const: "ordinary-query-economics-v4" }, coverage: { const: "normalization-optimizer-query-economics-checkpoints" },
    economics: { oneOf: [object({ status: { const: "unavailable" }, reason: { enum: ["bounds", "capture-failed"] } }),
      object({ status: { const: "available" }, policy: { const: ECONOMIC_POLICY }, records: array({ oneOf: [budget, allocation, authors, refused] }) })] } }) } };
}
