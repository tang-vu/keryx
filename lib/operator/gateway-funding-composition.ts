/** Funding execution is staged source, not an enabled Operator action.
 * No environment flag, caller-supplied binding, key loader, or synthetic token
 * can authorize activation. A future reviewed issuer must establish enrolled
 * store authority and cutover evidence before dynamically importing execution
 * code or loading keys. That issuer is deliberately absent in this release.
 */
export const OPERATOR_GATEWAY_FUNDING_ACTIVATION = Object.freeze({
  state: "disabled" as const,
  reason: "reviewed-enrollment-and-cutover-required" as const,
});

export async function createOperatorGatewayFundingComposition(_request: unknown): Promise<never> {
  throw new Error("Operator funding disabled; reviewed enrollment and cutover required");
}
