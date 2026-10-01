/** Descriptive installed-operation selector only. This pure parser neither
 * proves provenance nor grants owner/signing permission or backend access. */
export interface GatewayFundingOperationLocator {
  readonly format: "keryx-funding-operation-locator-v1";
  readonly storageManifestDigest: string;
  readonly identityDigest: string;
  readonly operationId: string;
  readonly installedPolicyDigest: string;
  readonly backendBindingDigest: string;
  readonly finalityPolicyDigest: string;
}
const KEYS = ["format", "storageManifestDigest", "identityDigest", "operationId", "installedPolicyDigest", "backendBindingDigest", "finalityPolicyDigest"];
const DIGEST = /^[0-9a-f]{64}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function refuse(): never { throw new Error("Funding operation locator unavailable"); }
export function validateGatewayFundingOperationLocator(input: unknown): Readonly<GatewayFundingOperationLocator> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length) refuse();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(fields).sort().join(",") !== [...KEYS].sort().join(",") || Object.values(fields).some(field => !("value" in field) || !field.enumerable)) refuse();
  const value = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  if (value.format !== "keryx-funding-operation-locator-v1" || typeof value.operationId !== "string" || !UUID.test(value.operationId)) refuse();
  for (const key of KEYS.filter(key => !["format", "operationId"].includes(key))) if (typeof value[key] !== "string" || !DIGEST.test(value[key])) refuse();
  return Object.freeze(value) as unknown as Readonly<GatewayFundingOperationLocator>;
}
