import { canonicalJson } from "../canonical-json";
import { buyerRequestSchema, authorizationSchema, decodeHeader } from "../buyer/protocol";
import { assertCanaryOriginalReserved, canaryExecutionPaused, configuredBusinessCanary, reserveCanaryInboundSettlement } from "./canary-policy";

export function canaryUnavailableResponse() {
  return Response.json({ error: "research_service_unavailable",
    message: "Paid admission is temporarily held. Preserve original payments and use their recovery links." },
  { status: 503, headers: { "Cache-Control": "no-store" } });
}
/** Runs before Circle verification/settlement. A public body cannot select or renew a policy. */
export function businessCanaryPaidAdmission(input: {
  body: unknown; signatureHeader: string | null; network: string; payee: string;
  amountMicroUsdc: string; creatorBudgetMicroUsdc: string; bot: boolean;
  /** Trusted seller callback only, never read from public JSON. */
  reserveSettlement?: boolean;
}): Response | null {
  try {
    const policy = configuredBusinessCanary();
    if (!policy) return canaryExecutionPaused() ? canaryUnavailableResponse() : null;
    const body = buyerRequestSchema.parse(input.body), expected = policy.original;
    if (input.bot || canonicalJson(body) !== canonicalJson(expected.request) ||
        input.network !== expected.requirement.network || input.payee.toLowerCase() !== expected.requirement.payTo.toLowerCase() ||
        input.amountMicroUsdc !== expected.requirement.amount || input.creatorBudgetMicroUsdc !== "10000") return canaryUnavailableResponse();
    if (input.signatureHeader) {
      const raw = decodeHeader(input.signatureHeader) as { payload?: unknown };
      const auth = authorizationSchema.parse(((raw.payload ?? raw) as { authorization?: unknown }).authorization);
      if (canonicalJson(auth) !== canonicalJson(expected.authorization)) return canaryUnavailableResponse();
      // The trusted buyer must have reserved this exact original before signature exposure.
      // Validate through the policy helper's protected read, rather than accepting caller metadata.
      assertCanaryOriginalReserved();
      if (input.reserveSettlement) reserveCanaryInboundSettlement();
    }
    return null;
  } catch { return canaryUnavailableResponse(); }
}
