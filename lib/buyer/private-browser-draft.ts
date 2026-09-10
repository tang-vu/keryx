import { z } from "zod";
import { addressSchema, authorizationSchema, requirementSchema } from "./protocol";
import { privateRequestSchema, PRIVATE_RESEARCH_RESOURCE, matchesPrivateRequestCommitment } from "./private-request-commitment";
import { privateResearchIdSchema } from "../a2a/private-research-intent";
import { requirePrivateMerchant, type PrivateMerchantPolicy } from "./private-merchant-policy";
import { browserSha256 } from "../browser-receipt-integrity";
import type { PrivateBuyerIntent } from "./private-buyer-intent";

export const privateBrowserDraftSchema = z.object({
  id: privateResearchIdSchema, resource: z.literal(PRIVATE_RESEARCH_RESOURCE),
  request: privateRequestSchema.refine(request => "reasoning" in request),
  requirement: requirementSchema, salt: z.string().regex(/^0x[a-f0-9]{64}$/), authorization: authorizationSchema,
}).strict();
export type PrivateBrowserDraft = z.infer<typeof privateBrowserDraftSchema>;

/** Same identity preimage as server admission, before any wallet signature exists. */
export async function privateBrowserDraftId(requirement: PrivateBrowserDraft["requirement"], authorization: PrivateBrowserDraft["authorization"]) {
  const identity = ["keryx-private-order-v1", requirement.network, authorization.from.toLowerCase(),
    authorization.to.toLowerCase(), authorization.nonce].join("|");
  return `prv_${(await browserSha256(identity)).slice("sha256:".length)}`;
}

export async function validatePrivateBrowserDraft(value: unknown, payer: string, merchants: PrivateMerchantPolicy): Promise<PrivateBrowserDraft> {
  const draft = privateBrowserDraftSchema.parse(value);
  if (new TextEncoder().encode(JSON.stringify(draft)).length > 65536) throw new Error("Private draft is too large");
  const owner = addressSchema.parse(payer).toLowerCase();
  requirePrivateMerchant(draft.requirement, merchants);
  if (draft.authorization.from.toLowerCase() !== owner
    || !await matchesPrivateRequestCommitment(draft.request, draft.requirement, draft.authorization, draft.salt)
    || draft.id !== await privateBrowserDraftId(draft.requirement, draft.authorization)) throw new Error("Private draft does not match its signed terms");
  return { ...draft, authorization: { ...draft.authorization, from: owner, to: draft.authorization.to.toLowerCase() },
    requirement: { ...draft.requirement, payTo: draft.requirement.payTo.toLowerCase(), asset: draft.requirement.asset.toLowerCase(),
      extra: { ...draft.requirement.extra, verifyingContract: draft.requirement.extra.verifyingContract.toLowerCase() } } };
}

export function privateDraftFromIntent(intent: PrivateBuyerIntent): PrivateBrowserDraft {
  return privateBrowserDraftSchema.parse({ id: intent.id, resource: intent.resource, request: intent.submission.request, requirement: intent.requirement,
    salt: intent.submission.salt, authorization: intent.submission.payment.authorization });
}
