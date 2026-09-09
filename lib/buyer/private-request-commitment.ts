/** Protocol foundation only: no route, signer, submission or private-result feature is enabled. */
import { z } from "zod";
import { browserSha256 } from "../browser-receipt-integrity";
import { a2aPackageFingerprintInput, a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { addressSchema, authorizationSchema, authorizationWithNonce, buyerRequestSchema, requirementSchema } from "./protocol";

export const PRIVATE_RESEARCH_RESOURCE = "https://keryx.cc/api/agent/private-ask";
export const privateRequestSchema = buyerRequestSchema.extend({
  access: z.literal("payer-private-v1"),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/).nullable(),
}).strict();
const saltSchema = z.string().regex(/^0x[a-f0-9]{64}$/);
const timestamp = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(value => Number.isSafeInteger(Number(value)));
const termsSchema = authorizationSchema.omit({ nonce: true }).extend({ validAfter: timestamp, validBefore: timestamp }).strict();
export type PrivateResearchRequest = z.infer<typeof privateRequestSchema>;

/** Exact canonical preimage shared by browser, CLI and eventual server admission. */
export function privateRequestCommitmentInput(requestValue: unknown, requirementValue: unknown, termsValue: unknown, saltValue: unknown): string {
  const request = privateRequestSchema.parse(requestValue);
  const requirement = requirementSchema.parse(requirementValue);
  const terms = termsSchema.parse(termsValue);
  const salt = saltSchema.parse(saltValue);
  if (terms.to.toLowerCase() !== requirement.payTo.toLowerCase() || terms.value !== requirement.amount) throw new Error("Payment terms disagree with the quote");
  if (BigInt(terms.value) > BigInt(1_000_000) || BigInt(terms.value) <= BigInt(Math.round(request.budget * 1e6))) throw new Error("Private package amount is outside the buyer limits");
  if (Number(terms.validBefore) - Number(terms.validAfter) !== requirement.maxTimeoutSeconds + 600) throw new Error("Unexpected authorization validity window");
  const researchPackage = a2aResearchPackageForVersion(request.researchMode, request.packageVersion);
  if (!researchPackage) throw new Error("Unsupported private research package");
  return JSON.stringify({
    domain: "keryx-private-request-commitment-v1",
    resource: PRIVATE_RESEARCH_RESOURCE,
    network: requirement.network, asset: requirement.asset.toLowerCase(), scheme: requirement.scheme,
    verifyingContract: requirement.extra.verifyingContract.toLowerCase(),
    domainName: requirement.extra.name, domainVersion: requirement.extra.version,
    access: request.access, question: request.question, creatorBudgetMicros: String(Math.round(request.budget * 1e6)),
    researchMode: request.researchMode, packageVersion: request.packageVersion,
    packageContract: a2aPackageFingerprintInput(researchPackage), responseMode: request.responseMode, model: request.model,
    payer: terms.from.toLowerCase(), payee: terms.to.toLowerCase(), amountMicros: terms.value,
    validAfter: terms.validAfter, validBefore: terms.validBefore, salt,
  });
}

export async function privateRequestNonce(request: unknown, requirement: unknown, terms: unknown, salt: unknown) {
  const digest = await browserSha256(privateRequestCommitmentInput(request, requirement, terms, salt));
  return `0x${digest.slice("sha256:".length)}` as `0x${string}`;
}

/** Fresh intent only. Import/recovery must reuse saved salt and authorization, never call this. */
export async function createPrivateAuthorization(requestValue: unknown, requirementValue: unknown, payer: string, trustedPayee: string, now = Date.now()) {
  const request = privateRequestSchema.parse(requestValue), requirement = requirementSchema.parse(requirementValue);
  if (requirement.payTo.toLowerCase() !== addressSchema.parse(trustedPayee).toLowerCase()) throw new Error("Quote payee does not match the trusted merchant");
  const salt = `0x${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const placeholder = authorizationWithNonce(payer, requirement, `0x${"0".repeat(64)}`, now);
  const { nonce: _placeholder, ...terms } = placeholder;
  const nonce = await privateRequestNonce(request, requirement, terms, salt);
  return { request, salt, authorization: { ...terms, nonce } };
}

/** Commitment equality only: NOT signature verification, authentication or settlement evidence. */
export async function matchesPrivateRequestCommitment(request: unknown, requirement: unknown, authorizationValue: unknown, salt: unknown): Promise<boolean> {
  try {
    const { nonce, ...terms } = authorizationSchema.parse(authorizationValue);
    return nonce === await privateRequestNonce(request, requirement, terms, salt);
  } catch { return false; }
}
