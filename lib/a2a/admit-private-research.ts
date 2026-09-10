import type { KeryxDB } from "../db/keryx-db";
import { addressSchema } from "../buyer/protocol";
import { acceptPrivateQuote } from "../buyer/private-quote";
import { createPrivateQuote } from "./private-quote";
import { preparePrivateResearchIntent } from "./private-research-intent";

/** Authenticated backend admission, not an HTTP endpoint or payment submission.
 * The caller derives authenticatedPayer from a live session and quote options from
 * trusted operator pricing/provider configuration, never from the submitted body.
 * Repeated admission preserves the original intent and does not authorize a retry. */
export async function admitPrivateResearch(db: Pick<KeryxDB, "reservePrivateResearchIntent">,
  submission: unknown, authenticatedPayer: string, options: Parameters<typeof createPrivateQuote>[1]) {
  const owner = addressSchema.parse(authenticatedPayer).toLowerCase();
  const provider = { ...options.provider };
  const intent = await preparePrivateResearchIntent(submission, options.requirement, options.merchants);
  if (intent.submission.payment.authorization.from !== owner) throw new Error("Private admission owner mismatch");
  const signed = intent.submission.request;
  const quote = createPrivateQuote({ question: signed.question, budget: signed.budget,
    researchMode: signed.researchMode, packageVersion: signed.packageVersion, responseMode: signed.responseMode },
  { provider, requirement: intent.requirement, merchants: intent.merchants });
  acceptPrivateQuote(quote, signed, intent.merchants, { maxTotalMicros: "1000000", maxServiceFeeMicros: "1000000" });
  const stored = await db.reservePrivateResearchIntent(intent);
  return { id: stored.id, status: "reserved" as const };
}
