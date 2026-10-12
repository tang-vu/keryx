import { ACTUAL_READ_POLICY, READ_CHECK_SHAPES, READ_CHECK_RULES } from "./actual-read-policy";
import { MAX_READ_CHECKPOINTS, MAX_READ_PACKET_BYTES } from "./actual-read-record";
import { runtimeCaptureOpenApi } from "./actual-read-v2-openapi";
import { optimizerCaptureOpenApi } from "./optimizer-openapi";
const actions = ["BUY", "SKIP", "CACHE"];
const contextAction = { type: "string", enum: [...actions, "UNKNOWN"] };
const integer = { type: "integer", minimum: 0, maximum: 10000 };
const shapeTypes = {
  boolean: { type: "boolean" }, integer, plan: { type: "string", enum: actions },
  verdict: { type: "string", enum: ["admitted", "source-changed", "human-withheld"] },
  operand: { type: "string", maxLength: 32, description: "Canonical finite original Number operand, retaining the existing comparison and tolerance without rounding." },
};
const amount = { type: ["string", "null"], pattern: "^(0|[1-9][0-9]{0,15})$",
  description: "Integer micro-USDC assertion only when the existing exact converter accepts it; null means unavailable, never rounded." };
const legacySchemas = {
  ActualReadCheckpointCapture: {
    description: `Bounded ordinary-public post-portfolio assertion sidecar (at most ${MAX_READ_PACKET_BYTES} canonical bytes). Offline replay establishes integrity and deterministic checkpoint agreement only; no source authenticity, read/funding/payment/retry authority or issue291 anchoring. Expected digest must be retained separately from the submitted packet. Private, original, native, historical and failed capture remains unavailable.`,
    oneOf: [
      { type: "object", additionalProperties: false, required: ["status"], properties: { status: { const: "unavailable" } } },
      { type: "object", additionalProperties: false, required: ["status", "packet", "retainedDigest"], properties: {
        status: { const: "available" }, retainedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
        packet: { type: "object", additionalProperties: false,
          required: ["schema", "policy", "coverage", "monetaryAuthority", "records"], properties: {
            schema: { const: 1 }, policy: { const: ACTUAL_READ_POLICY }, coverage: { const: "post-portfolio-checkpoints" },
            monetaryAuthority: { const: "qualified-assertions-only" },
            records: { type: "array", minItems: 1, maxItems: MAX_READ_CHECKPOINTS, items: {
              type: "object", additionalProperties: false,
              required: ["sequence", "candidate", "round", "proposal", "plan", "facts", "check", "outcome", "amounts"], properties: {
                sequence: { type: "integer", minimum: 0, maximum: MAX_READ_CHECKPOINTS - 1 }, candidate: integer,
                round: { type: "integer", minimum: 0, maximum: 8 }, proposal: contextAction, plan: contextAction, facts: { const: "assertions" },
                check: { oneOf: Object.entries(READ_CHECK_SHAPES).map(([kind, shape]) => ({ type: "object", additionalProperties: false,
                  required: ["kind", ...Object.keys(shape)], properties: { kind: { const: kind },
                    ...Object.fromEntries(Object.entries(shape).map(([name, type]) => [name, shapeTypes[type]])) } })) },
                outcome: { type: "object", additionalProperties: false, required: ["action", "rule"], properties: {
                  action: { type: "string", enum: [...actions, "CONTINUE", "STOP", "ESCALATE", "FREE"] },
                  rule: { type: "string", enum: READ_CHECK_RULES } } },
                amounts: { type: "object", additionalProperties: false, required: ["priceMicros", "remainingMicros"], properties: { priceMicros: amount, remainingMicros: amount } },
              },
            } },
          } },
      } },
    ],
  },
};
const legacyAvailable = legacySchemas.ActualReadCheckpointCapture.oneOf[1] as {
  properties: { packet: { properties: { records: unknown } } };
};
const v2 = runtimeCaptureOpenApi(legacyAvailable.properties.packet.properties.records);
export const actualReadOpenApiSchemas = { ActualReadCheckpointCapture: {
  ...legacySchemas.ActualReadCheckpointCapture,
  description: "Bounded private-safe ordinary observations. V1 admission, v2 normalization and available v3 versioned optimizer replay remain distinct. Private collation/groups are asserted inputs; model/payment/funding authority is not replayed. Expected hash is separately retained; unsupported/private/original capture remains unavailable.",
  oneOf: [...legacySchemas.ActualReadCheckpointCapture.oneOf, v2, optimizerCaptureOpenApi(v2)],
} };
