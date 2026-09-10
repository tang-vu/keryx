import { z } from "zod";
import { addressSchema, requirementSchema } from "./protocol";
import { PRIVATE_RESEARCH_RESOURCE } from "./private-request-commitment";
import { privateResearchIdSchema, preparePrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";

const envelope = z.object({ schema: z.literal("keryx-private-buyer-intent-v1"), resource: z.literal(PRIVATE_RESEARCH_RESOURCE),
  id: privateResearchIdSchema, requirement: requirementSchema, submission: z.unknown() }).strict();

/** Shared browser/CLI validation. Neither a signature nor a saved intent proves payment. */
export async function validatePrivateBuyerIntent(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536) throw new Error("Private intent exceeds the recovery limit");
  const owner = addressSchema.parse(payer).toLowerCase();
  const parsed = envelope.parse(value);
  const intent = await preparePrivateResearchIntent(parsed.submission, parsed.requirement, merchants);
  if (intent.id !== parsed.id || intent.submission.payment.authorization.from !== owner || !("reasoning" in intent.submission.request))
    throw new Error("Private buyer journal does not match the owner or signed job");
  return { schema: parsed.schema, resource: parsed.resource, id: intent.id, requirement: intent.requirement, submission: intent.submission };
}

export type PrivateBuyerIntent = Awaited<ReturnType<typeof validatePrivateBuyerIntent>>;
