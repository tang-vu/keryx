import type { Source } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";

/** Trusted per-dispatch funding restriction, never a replacement for registry payTo authority. */
export interface RecipientExclusion {
  deniedRecipient?: string;
}

export function recipientIsExcluded(recipient: string, deniedRecipient?: string): boolean {
  return deniedRecipient !== undefined && recipient.toLowerCase() === deniedRecipient.toLowerCase();
}

/** Evaluate the current authority snapshot rather than excluding stale database payees. */
export function sourceRecipientIsExcluded(source: Source, terms: SourceFetchTerms, deniedRecipient?: string): boolean {
  if (!deniedRecipient) return false;
  const citationWallets = terms.citationWallets ?? source.authors.map(author => author.walletAddress);
  return [terms.payTo, ...citationWallets].some(recipient => recipientIsExcluded(recipient, deniedRecipient));
}

/** Must run before signing, reservation/exposure or paid HTTP, never after settlement. */
export function assertRecipientAllowed(recipient: unknown, deniedRecipient?: string): void {
  if (deniedRecipient === undefined) return;
  if (typeof recipient !== "string" || recipientIsExcluded(recipient, deniedRecipient))
    throw new Error("Creator payment recipient is excluded for this run's funding owner");
}
