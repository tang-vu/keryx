/** Unwired private protocol verifier. Does not admit, settle, store or publish a job. */
import { verifyTypedData } from "viem";
import { z } from "zod";
import { authorizationSchema, buyerTypedData, requirementSchema } from "../buyer/protocol";
import { requirePrivateMerchant } from "../buyer/private-merchant-policy";
import { matchesPrivateRequestCommitment, privateRequestSchema } from "../buyer/private-request-commitment";

const submissionSchema = z.object({
  request: privateRequestSchema,
  salt: z.string().regex(/^0x[a-f0-9]{64}$/),
  payment: z.object({
    authorization: authorizationSchema,
    // This version supports the EOA TransferWithAuthorization signature only.
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  }).strict(),
}).strict();

/**
 * Verify signed request ownership against SERVER-selected terms and merchant policy.
 * Neither trusted argument may come from the submitted body, resource or accepted metadata.
 * No RPC is used: the signature is checked locally against the pinned Arc testnet domain.
 *
 * A result proves EOA ownership and commitment equality only. It does not prove balance,
 * validity at settlement time, unused nonce, payment, private storage or access entitlement.
 * In particular, do not expire a persisted paid job merely because its signature expired.
 * New admission still needs facilitator verification and durable replay/settlement handling.
 */
export async function verifyPrivateResearchSubmission(
  submissionValue: unknown,
  expectedRequirementValue: unknown,
  trustedMerchantPolicy: unknown,
) {
  try {
    const submission = submissionSchema.parse(submissionValue);
    const requirement = requirementSchema.parse(expectedRequirementValue);
    requirePrivateMerchant(requirement, trustedMerchantPolicy);
    const { authorization, signature } = submission.payment;
    if (!await matchesPrivateRequestCommitment(submission.request, requirement, authorization, submission.salt)) return null;
    const valid = await verifyTypedData({
      ...buyerTypedData(authorization),
      address: authorization.from as `0x${string}`,
      signature: signature as `0x${string}`,
    });
    if (!valid) return null;
    return { ...submission, payer: authorization.from.toLowerCase() };
  } catch {
    // Do not expose a question, salt, bearer authorization or parser/crypto error to logs.
    return null;
  }
}
