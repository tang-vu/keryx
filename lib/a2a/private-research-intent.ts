import { browserSha256 } from "../browser-receipt-integrity";
import { z } from "zod";
import { requirementSchema } from "../buyer/protocol";
import { privateMerchantPolicySchema } from "../buyer/private-merchant-policy";
import { verifyPrivateResearchSubmission } from "./private-request-verification";

/** Private storage only. A reservation is not a paid order or permission to execute. */
export async function preparePrivateResearchIntent(submission: unknown, expectedRequirement: unknown, trustedMerchants: unknown) {
  const requirement = requirementSchema.parse(expectedRequirement);
  const merchants = privateMerchantPolicySchema.parse(trustedMerchants);
  const verified = await verifyPrivateResearchSubmission(submission, requirement, merchants);
  if (!verified) throw new Error("Invalid private research intent");
  const authorization = { ...verified.payment.authorization, from: verified.payer, to: verified.payment.authorization.to.toLowerCase() };
  const identity = ["keryx-private-order-v1", requirement.network, authorization.from, authorization.to, authorization.nonce].join("|");
  return {
    id: `prv_${(await browserSha256(identity)).slice("sha256:".length)}`,
    submission: { request: verified.request, salt: verified.salt, payment: { authorization, signature: verified.payment.signature } },
    requirement: { ...requirement, payTo: requirement.payTo.toLowerCase(), asset: requirement.asset.toLowerCase(), extra: { ...requirement.extra, verifyingContract: requirement.extra.verifyingContract.toLowerCase() } },
    merchants: { privatePayee: merchants.privatePayee.toLowerCase(), publicResearchPayee: merchants.publicResearchPayee.toLowerCase() },
  };
}
export type PrivateResearchIntent = Awaited<ReturnType<typeof preparePrivateResearchIntent>>;
export const privateResearchIdSchema = z.string().regex(/^prv_[a-f0-9]{64}$/);

/** Revalidate durable data before returning it; never silently repair a corrupt identity. */
export async function validatePrivateResearchIntent(value: unknown): Promise<PrivateResearchIntent> {
  try {
    const envelope = z.object({ id: privateResearchIdSchema, submission: z.unknown(), requirement: z.unknown(), merchants: z.unknown() }).strict().parse(value);
    const validated = await preparePrivateResearchIntent(envelope.submission, envelope.requirement, envelope.merchants);
    if (validated.id !== envelope.id) throw new Error("Identity mismatch");
    return validated;
  } catch { throw new Error("Invalid stored private research intent"); }
}

/** Different valid signature bytes cannot replace the first saved authorization proof. */
export function samePrivateResearchIntent(first: PrivateResearchIntent, second: PrivateResearchIntent): boolean {
  const comparable = (value: PrivateResearchIntent) => ({ ...value, submission: {
    ...value.submission, payment: { authorization: value.submission.payment.authorization },
  } });
  return JSON.stringify(comparable(first)) === JSON.stringify(comparable(second));
}
