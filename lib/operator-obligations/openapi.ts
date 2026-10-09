import { obligationReasonSchema, obligationScopeSchema } from "./contracts";

const object = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const amount = { type: "string", pattern: "^(0|[1-9][0-9]{0,29})$", description: "Exact integer micro-USDC." };
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const address = { type: "string", pattern: "^0x[0-9a-f]{40}$" };
const scope = object({ custodyWallet: address, signer: address,
  custodyRole: { type: "string", enum: obligationScopeSchema.shape.custodyRole.options },
  storageIdentityDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, network: { type: "string", const: "eip155:5042" },
  asset: { type: "string", const: "0x3600000000000000000000000000000000000000" }, compartment: { type: "string", const: "gateway" } });
const projection = object({ version: { type: "integer", const: 1 }, scope, snapshotId: { type: "string", maxLength: 128 },
  observedAt: { type: "string", format: "date-time" }, source: { type: "string", const: "native-journal" }, status: { type: "string", const: "unknown" },
  advisoryOnly: { type: "boolean", const: true }, spendAuthority: { type: "boolean", const: false }, nativeComplete: { type: "boolean", const: false },
  reasons: { type: "array", maxItems: 32, items: { type: "string", enum: obligationReasonSchema.options } },
  ...Object.fromEntries(["protectedMicroUsdc", "dueNowMicroUsdc", "excludedNonLiquidMicroUsdc"].map(name => [name, amount])),
  ...Object.fromEntries(["liquidMicroUsdc", "dueWithinHorizonMicroUsdc", "reserveFloorMicroUsdc", "operatingBudgetMicroUsdc", "remainingOriginalCapacityMicroUsdc", "coverageShortfallMicroUsdc"].map(name => [name, nullable(amount)])),
  safeNewSpendMicroUsdc: { type: "string", const: "0" }, advisorySurplusMicroUsdc: { type: "string", const: "0" } });
export const operatorObligationOpenApiPath = { get: { operationId: "readOperatorObligations", summary: "Inspect delegated private Operator obligations",
  description: "Disabled without exact protected reader wallet and custody role. Requires BOTH verified operator:read bearer scope and that reader wallet. No cookie/public fallback or selectors. Existing auth metadata lookup precedes authorization; NEW inspection uses only selected read-only enrolled SQLite. Custody wallet is the sealed role-policy signer, not the reader. Partial native history/cash/inclusion/reserve policy always yields unknown and zero safe/advisory surplus. No payment, release, refund or scheduler authority.",
  security: [{ ApiKeyAuth: [] }], responses: {
    "200": { description: "Private no-store partial observation; unknown is not zero obligations or spending authority.", content: { "application/json": { schema: object({ version: { type: "integer", const: 1 }, readerWallet: address, projection }) } } },
    "401": { description: "Uniform unavailable for absent/invalid/revoked bearer, scope, reader or configuration." },
    "400": { description: "Caller selectors/body are not accepted." },
    "503": { description: "Native store, role policy or retained books unavailable; no fallback or complete-zero claim." },
  } } };
